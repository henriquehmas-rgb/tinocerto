// apps/api/src/staff-auth/__tests__/staff-onboarding.service.spec.ts
import { ConflictException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { PasswordService } from '../password.service';
import { StaffOnboardingService } from '../staff-onboarding.service';

describe('StaffOnboardingService.onboard', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const passwordService = new PasswordService();
  const service = new StaffOnboardingService(tenantContext, passwordService);

  let tenantIdCriado: string | undefined;
  let tenantIdCriadoConcorrencia: string | undefined;
  let tenantIdCriadoRequisicao: string | undefined;

  afterAll(async () => {
    for (const tenantId of [tenantIdCriado, tenantIdCriadoConcorrencia, tenantIdCriadoRequisicao]) {
      if (!tenantId) continue;
      // role_assignment referencia user_account via FK -- precisa ser
      // apagado antes, senão o DELETE em user_account viola a constraint
      // role_assignment_user_id_fkey (desvio do exemplo original do brief).
      await adminPool.query('DELETE FROM role_assignment WHERE tenant_id = $1', [tenantId]);
      await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
      // requisition referencia org_unit via FK composta
      // (fk_requisition_tenant_org_unit) -- precisa ser apagada antes do
      // org_unit (achado C3 da revisão de coerência: onboard() agora cria
      // os dois).
      await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
      await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    }
    await adminPool.end();
    await appPool.end();
  });

  it('cria um tenant novo e o primeiro user_account com role admin_tenant', async () => {
    const resultado = await service.onboard({
      nomeEmpresa: 'Empresa Onboarding Teste Ltda',
      cnpj: '00000000000210',
      emailAdmin: 'admin-onboarding-210@example.com',
      senhaAdmin: 'senha-forte-onboarding-123',
    });
    tenantIdCriado = resultado.tenantId;

    const tenantRow = await adminPool.query('SELECT razao_social, cnpj FROM tenant WHERE id = $1', [resultado.tenantId]);
    expect(tenantRow.rows[0]).toEqual({ razao_social: 'Empresa Onboarding Teste Ltda', cnpj: '00000000000210' });

    const userRow = await adminPool.query('SELECT email, senha_hash FROM user_account WHERE id = $1', [resultado.userId]);
    expect(userRow.rows[0].email).toBe('admin-onboarding-210@example.com');
    expect(userRow.rows[0].senha_hash).not.toBeNull();

    const roleRow = await adminPool.query(
      `SELECT r.nome FROM role_assignment ra JOIN role r ON r.id = ra.role_id WHERE ra.user_id = $1`,
      [resultado.userId],
    );
    expect(roleRow.rows[0].nome).toBe('admin_tenant');
  });

  // C3 da revisão de coerência do Painel do Recrutador: sem um org_unit +
  // requisition aprovada já existentes, um tenant recém-onboardado não
  // conseguia criar NENHUMA vaga pelo produto (JobService.create exige
  // requisition aprovada, requisition exige org_unit -- e não havia
  // nenhuma rota de API para criar nenhum dos dois).
  it('cria um org_unit raiz e uma requisition já aprovada, prontos para criar vaga', async () => {
    const resultado = await service.onboard({
      nomeEmpresa: 'Empresa Onboarding Requisicao Ltda',
      cnpj: '00000000000244',
      emailAdmin: 'admin-onboarding-244@example.com',
      senhaAdmin: 'senha-forte-onboarding-244',
    });
    tenantIdCriadoRequisicao = resultado.tenantId;

    const orgUnitRow = await adminPool.query(
      `SELECT id, tipo, nome, parent_id, materialized_path::text AS materialized_path FROM org_unit WHERE tenant_id = $1`,
      [resultado.tenantId],
    );
    expect(orgUnitRow.rows).toHaveLength(1);
    expect(orgUnitRow.rows[0]).toEqual({
      id: orgUnitRow.rows[0].id,
      tipo: 'empresa',
      nome: 'Empresa Onboarding Requisicao Ltda',
      parent_id: null,
      materialized_path: 'matriz',
    });

    const requisitionRow = await adminPool.query(
      `SELECT titulo, status, approved_at, org_unit_id FROM requisition WHERE tenant_id = $1`,
      [resultado.tenantId],
    );
    expect(requisitionRow.rows).toHaveLength(1);
    expect(requisitionRow.rows[0].titulo).toBe('Requisição inicial');
    expect(requisitionRow.rows[0].status).toBe('aprovada');
    expect(requisitionRow.rows[0].approved_at).not.toBeNull();
    expect(requisitionRow.rows[0].org_unit_id).toBe(orgUnitRow.rows[0].id);
  });

  it('rejeita CNPJ já cadastrado por outro tenant', async () => {
    await expect(
      service.onboard({
        nomeEmpresa: 'Empresa Duplicada Ltda',
        cnpj: '00000000000210',
        emailAdmin: 'outro-admin@example.com',
        senhaAdmin: 'outra-senha-forte-123',
      }),
    ).rejects.toThrow();
  });

  // Achado C3 da revisão final: `user_account` só tinha
  // `UNIQUE (tenant_id, email)` -- único POR TENANT, não globalmente. Sem
  // este teste, o mesmo e-mail podia virar admin_tenant de um SEGUNDO tenant
  // (CNPJ diferente, então o pre-check de CNPJ acima não pega este caso),
  // deixando `resolve_staff_login_by_email` (sem `LIMIT`/`ORDER BY`) devolver
  // uma linha arbitrária entre as duas contas -- login não-determinístico.
  it('rejeita e-mail já cadastrado em OUTRO tenant, mesmo com CNPJ novo (índice único global, identity_0014)', async () => {
    await expect(
      service.onboard({
        nomeEmpresa: 'Empresa Email Duplicado Ltda',
        cnpj: '00000000000228',
        emailAdmin: 'admin-onboarding-210@example.com',
        senhaAdmin: 'outra-senha-forte-123',
      }),
    ).rejects.toThrow(new ConflictException('Este e-mail já está cadastrado em outra conta'));

    // O tenant NÃO deve ter sido criado -- a violação do índice único de
    // e-mail acontece dentro da MESMA transação do onboarding, então o
    // ROLLBACK desfaz também o INSERT em `tenant` que já tinha rodado antes.
    const tenantRows = await adminPool.query('SELECT id FROM tenant WHERE cnpj = $1', ['00000000000228']);
    expect(tenantRows.rows).toHaveLength(0);
  });

  // Reproduz a corrida real (não o caminho do pre-check acima, que só pega o
  // caso sequencial): duas chamadas de onboard() com o MESMO CNPJ novo, com
  // sobreposição FORÇADA deterministicamente -- mesma técnica usada em
  // staff-token.service.spec.ts (interceptar client.query para pausar uma
  // lane logo após seu próprio passo de leitura e só liberá-la depois que a
  // outra lane já tiver commitado). Uma versão anterior deste teste disparava
  // as duas chamadas em paralelo via Promise.allSettled sem nenhum controle
  // de ordem e dependia do tempo incidental do bcrypt.hash() (que roda entre
  // o SELECT de pre-check e o INSERT) para abrir uma janela grande o
  // suficiente para a corrida acontecer -- na prática funcionava, mas sem
  // garantia nenhuma: bastaria as duas chamadas não se sobreporem de verdade
  // (uma terminando, commit incluído, antes da outra sequer começar) para o
  // teste passar sem ter exercitado a corrida nenhuma vez, silenciosamente.
  // Agora a sobreposição é forçada: a lane "lenta" (chamada A) é pausada logo
  // depois do seu SELECT de pre-check (que só verifica se o CNPJ já existe --
  // não decide mais nada sozinho) e só prossegue para o INSERT depois que a
  // lane "rápida" (chamada B) já tiver inserido e commitado por completo com
  // o MESMO CNPJ. Isso garante sobreposição genuína a cada execução -- não
  // depende mais de timing de I/O incidental.
  it('duas chamadas concorrentes com o MESMO CNPJ novo: exatamente uma cria o tenant, a outra recebe ConflictException (não o erro cru do pg)', async () => {
    const cnpjConcorrente = '00000000000236';

    let releaseSlowLane: () => void = () => {};
    const fastLaneCommitted = new Promise<void>((resolve) => {
      releaseSlowLane = resolve;
    });

    type ConnectFn = () => Promise<PoolClient>;
    const realConnect = appPool.connect.bind(appPool) as ConnectFn;
    (appPool as unknown as { connect: ConnectFn }).connect = (async () => {
      // Restaura o connect original já na primeira chamada (síncrona, antes
      // de qualquer await) -- graças à ordem de execução síncrona do JS até
      // o primeiro await, apenas a conexão da lane lenta (chamada A, cujo
      // onboard() é disparado primeiro logo abaixo) passa por este wrapper;
      // a lane rápida (chamada B, disparada em seguida) já pega o
      // pool.connect real, sem interceptação.
      (appPool as unknown as { connect: ConnectFn }).connect = realConnect;
      const client = await realConnect();
      const realQuery = client.query.bind(client);
      (client as unknown as { query: typeof client.query }).query = (async (...queryArgs: unknown[]) => {
        const first = queryArgs[0];
        const text = typeof first === 'string' ? first : (first as { text?: string })?.text;
        const result = await (realQuery as (...a: unknown[]) => Promise<unknown>)(...queryArgs);
        if (typeof text === 'string' && text.startsWith('SELECT 1 FROM tenant WHERE cnpj')) {
          // Restaura já na primeira (e única) pausa -- o restante das
          // queries desta transação (o INSERT etc.) segue sem interceptação.
          (client as unknown as { query: typeof client.query }).query = realQuery as typeof client.query;
          await fastLaneCommitted;
        }
        return result;
      }) as typeof client.query;
      return client;
    }) as ConnectFn;

    const slowLanePromise = service.onboard({
      nomeEmpresa: 'Empresa Corrida A Ltda',
      cnpj: cnpjConcorrente,
      emailAdmin: 'corrida-a@example.com',
      senhaAdmin: 'senha-forte-corrida-123',
    });

    const fastLanePromise = service.onboard({
      nomeEmpresa: 'Empresa Corrida B Ltda',
      cnpj: cnpjConcorrente,
      emailAdmin: 'corrida-b@example.com',
      senhaAdmin: 'senha-forte-corrida-456',
    });

    // Libera a lane lenta assim que a lane rápida tiver terminado (sucesso
    // ou falha) -- neste ponto a rápida já commitou (ou deu rollback) por
    // completo, então a lenta só continua depois disso.
    void fastLanePromise.finally(() => releaseSlowLane());

    const resultados = await Promise.allSettled([slowLanePromise, fastLanePromise]);

    const sucesso = resultados.filter(
      (r): r is PromiseFulfilledResult<{ tenantId: string; userId: string }> => r.status === 'fulfilled',
    );
    const falha = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(sucesso).toHaveLength(1);
    expect(falha).toHaveLength(1);

    // A rejeição precisa ser especificamente o ConflictException do
    // pre-check -- não o erro 23505 cru do pg vazando da transação.
    expect(falha[0].reason).toBeInstanceOf(ConflictException);
    expect((falha[0].reason as ConflictException).message).toBe('Este CNPJ já tem um tenant cadastrado');

    tenantIdCriadoConcorrencia = sucesso[0].value.tenantId;

    const tenantRows = await adminPool.query('SELECT id FROM tenant WHERE cnpj = $1', [cnpjConcorrente]);
    expect(tenantRows.rows).toHaveLength(1);
    expect(tenantRows.rows[0].id).toBe(tenantIdCriadoConcorrencia);
  });
});
