import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';

describe('assessment_application (ponte tenant) e item_response (silo)', () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'app_runtime';
  url.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: url.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  let tenantA: string;
  let tenantB: string;
  let aaDoA: string;
  let blocoDoA: string;
  let instrumentoDoTeste: string;
  let versaoDoTeste: string;
  let applicationDoA: string;
  let personDoA: string;

  beforeAll(async () => {
    const criarTenant = async (cnpj: string, nome: string) => {
      const t = await adminPool.query<{ id: string }>(
        `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ($1, $2, $3) RETURNING id`,
        [nome, cnpj, `test-tenant-${cnpj}`],
      );
      return t.rows[0].id;
    };
    tenantA = await criarTenant('00000000000049', 'Empresa Assess A');
    tenantB = await criarTenant('00000000000050', 'Empresa Assess B');

    const inst = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument (nome) VALUES ('Instrumento Silo Test') RETURNING id`,
    );
    instrumentoDoTeste = inst.rows[0].id;
    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true) RETURNING id`,
      [instrumentoDoTeste],
    );
    versaoDoTeste = ver.rows[0].id;
    const bloco = await adminPool.query<{ id: string }>(
      `INSERT INTO block (instrument_version_id, ordem) VALUES ($1, 1) RETURNING id`,
      [versaoDoTeste],
    );
    blocoDoA = bloco.rows[0].id;

    // Cadeia mínima de Hiring para o tenant A.
    const org = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1,'empresa','Matriz','matriz') RETURNING id`,
      [tenantA],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1,$2,'Req Assess','aprovada',now()) RETURNING id`,
      [tenantA, org.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug, canais) VALUES ($1,$2,'Vaga Assess','vaga-assess-silo','{}') RETURNING id`,
      [tenantA, req.rows[0].id],
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-assess-silo','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Assess Silo','silo@example.com')
       RETURNING id`,
    );
    personDoA = person.rows[0].id;
    const app = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantA, job.rows[0].id, personDoA],
    );
    applicationDoA = app.rows[0].id;
    const aa = await adminPool.query<{ id: string }>(
      `INSERT INTO assessment_application (tenant_id, application_id, person_id, instrument_version_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [tenantA, applicationDoA, personDoA, versaoDoTeste],
    );
    aaDoA = aa.rows[0].id;
  });

  afterAll(async () => {
    // TODA limpeza é ESCOPADA ao que este arquivo criou. `instrument`,
    // `instrument_version`, `block` e `item_response` são tabelas GLOBAIS
    // (sem tenant_id) e, a partir da Task 8, carregam DADO PERMANENTE: a
    // assessment_0005 semeia o instrumento de produção com 20 blocos e 40
    // block_item. Nenhuma dessas FKs é ON DELETE CASCADE, então um
    // `DELETE FROM block` sem WHERE estoura 23503 contra os block_item
    // semeados, ABORTA o afterAll no meio, e o `DELETE FROM tenant` do fim
    // nunca roda -- deixando os CNPJ 49 e 50 órfãos no banco e quebrando a
    // rodada seguinte em `duplicate key ... tenant_cnpj_key`. Essa classe de
    // bug já reincidiu seis vezes neste projeto; aqui a colisão nem seria
    // entre dois arquivos, seria com a linha órfã do próprio arquivo, então
    // a guarda de CNPJ não veria nada.
    //
    // O try/finally garante o fechamento dos pools mesmo se um DELETE falhar:
    // pool aberto vira open handle e trava a suíte inteira.
    try {
      await adminPool.query(
        `DELETE FROM item_response WHERE assessment_application_id IN (
           SELECT id FROM assessment_application WHERE tenant_id IN ($1,$2))`,
        [tenantA, tenantB],
      );
      await adminPool.query('DELETE FROM assessment_application WHERE tenant_id IN ($1,$2)', [
        tenantA,
        tenantB,
      ]);
      await adminPool.query('DELETE FROM application WHERE tenant_id IN ($1,$2)', [
        tenantA,
        tenantB,
      ]);
      await adminPool.query('DELETE FROM job WHERE tenant_id IN ($1,$2)', [tenantA, tenantB]);
      await adminPool.query('DELETE FROM requisition WHERE tenant_id IN ($1,$2)', [
        tenantA,
        tenantB,
      ]);
      await adminPool.query('DELETE FROM org_unit WHERE tenant_id IN ($1,$2)', [tenantA, tenantB]);
      await adminPool.query(`DELETE FROM person WHERE email_principal = 'silo@example.com'`);
      await adminPool.query(
        `DELETE FROM block WHERE instrument_version_id IN (
           SELECT id FROM instrument_version WHERE instrument_id = $1)`,
        [instrumentoDoTeste],
      );
      await adminPool.query('DELETE FROM instrument_version WHERE instrument_id = $1', [
        instrumentoDoTeste,
      ]);
      await adminPool.query('DELETE FROM instrument WHERE id = $1', [instrumentoDoTeste]);
      await adminPool.query('DELETE FROM tenant WHERE id IN ($1,$2)', [tenantA, tenantB]);
    } finally {
      await adminPool.end();
      await appPool.end();
    }
  });

  it('tenant B não enxerga o assessment_application do tenant A', async () => {
    const ctx = new TenantContext(appPool);

    const comoB = await ctx.run(tenantB, (client) =>
      client.query('SELECT * FROM assessment_application WHERE id = $1', [aaDoA]),
    );
    expect(comoB.rows).toHaveLength(0);

    const comoA = await ctx.run(tenantA, (client) =>
      client.query('SELECT * FROM assessment_application WHERE id = $1', [aaDoA]),
    );
    expect(comoA.rows).toHaveLength(1);
  });

  it('assessment_application nasce como convidado e no nível de integridade 0', async () => {
    const row = await adminPool.query<{ status: string; nivel_integridade: number }>(
      'SELECT status, nivel_integridade FROM assessment_application WHERE id = $1',
      [aaDoA],
    );
    expect(row.rows[0].status).toBe('convidado');
    // Webcam off por padrão = nível 0 por padrão.
    expect(row.rows[0].nivel_integridade).toBe(0);
  });

  it('rejeita nível de integridade fora da faixa 0-4', async () => {
    await expect(
      adminPool.query('UPDATE assessment_application SET nivel_integridade = 7 WHERE id = $1', [aaDoA]),
    ).rejects.toThrow();
  });

  it('rejeita multiplicador de tempo fora dos valores documentados', async () => {
    await expect(
      adminPool.query('UPDATE assessment_application SET multiplicador_tempo = 3.0 WHERE id = $1', [aaDoA]),
    ).rejects.toThrow();
  });

  it('aceita a faixa cheia de integridade e os três multiplicadores de acessibilidade', async () => {
    // O lado da REJEIÇÃO, sozinho, deixa passar uma CHECK estreitada demais:
    // `nivel_integridade = 0` e `multiplicador_tempo IN (1.0)` fariam os dois
    // testes acima continuarem verdes. E 1.5/2.0 não são detalhe -- são o
    // requisito de ACESSIBILIDADE documentado no comentário da própria
    // migration, que o fluxo da Task 9 vai gravar. Sem este caso, a falha só
    // apareceria lá, longe da causa.
    //
    // Roda numa linha PRÓPRIA, criada e apagada aqui: não há UNIQUE sobre
    // (tenant_id, application_id), então uma segunda ponte para a mesma
    // candidatura é legítima, e assim nenhum outro caso deste arquivo herda
    // estado mutado.
    let aaExtra: string | null = null;
    try {
      const criada = await adminPool.query<{ id: string }>(
        `INSERT INTO assessment_application
           (tenant_id, application_id, person_id, instrument_version_id, nivel_integridade, multiplicador_tempo)
         VALUES ($1,$2,$3,$4,4,1.5) RETURNING id`,
        [tenantA, applicationDoA, personDoA, versaoDoTeste],
      );
      aaExtra = criada.rows[0].id;

      const nascida = await adminPool.query<{
        nivel_integridade: number;
        multiplicador_tempo: string;
      }>(
        'SELECT nivel_integridade, multiplicador_tempo FROM assessment_application WHERE id = $1',
        [aaExtra],
      );
      expect(nascida.rows[0].nivel_integridade).toBe(4);
      expect(Number(nascida.rows[0].multiplicador_tempo)).toBe(1.5);

      for (const multiplicador of [1.0, 2.0]) {
        await adminPool.query(
          'UPDATE assessment_application SET multiplicador_tempo = $1 WHERE id = $2',
          [multiplicador, aaExtra],
        );
        const lido = await adminPool.query<{ multiplicador_tempo: string }>(
          'SELECT multiplicador_tempo FROM assessment_application WHERE id = $1',
          [aaExtra],
        );
        expect(Number(lido.rows[0].multiplicador_tempo)).toBe(multiplicador);
      }

      // NULL continua válido: é o "sem limite de tempo" da migration.
      await adminPool.query(
        'UPDATE assessment_application SET multiplicador_tempo = NULL WHERE id = $1',
        [aaExtra],
      );
    } finally {
      // No finally, nunca depois das asserções.
      if (aaExtra) {
        await adminPool.query('DELETE FROM assessment_application WHERE id = $1', [aaExtra]);
      }
    }
  });

  it('a FK composta impede pendurar a ponte do tenant B na candidatura do tenant A', async () => {
    // `fk_aa_tenant_application (tenant_id, application_id) REFERENCES
    // application (tenant_id, id)` existe porque uma FK SIMPLES sobre
    // application_id permitiria uma referência cross-tenant que a RLS não
    // visita -- a checagem de FK do Postgres roda com privilégio de sistema e
    // não enxerga policy. A defesa é o par composto: o tenant do lado filho
    // tem que bater com o tenant do lado pai.
    //
    // Roda pelo adminPool DE PROPÓSITO: superusuário contorna RLS, mas NÃO
    // contorna FK. Se este INSERT fosse aceito, a prova seria de que a defesa
    // real é só a RLS -- e a RLS não protege o caminho da FK.
    await expect(
      adminPool.query(
        `INSERT INTO assessment_application (tenant_id, application_id, person_id, instrument_version_id)
         VALUES ($1,$2,$3,$4)`,
        [tenantB, applicationDoA, personDoA, versaoDoTeste],
      ),
    ).rejects.toThrow(/fk_aa_tenant_application/);
  });

  it('item_response não concede DELETE a app_runtime (a resposta é o dado que calibra)', async () => {
    const grants = await adminPool.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'item_response' AND grantee = 'app_runtime'`,
    );
    const tipos = grants.rows.map((r) => r.privilege_type);
    expect(tipos).toContain('SELECT');
    expect(tipos).toContain('INSERT');
    expect(tipos).not.toContain('DELETE');
  });

  it('item_response é global — não tem tenant_id (é silo, não ponte)', async () => {
    const col = await adminPool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'item_response' AND column_name = 'tenant_id'`,
    );
    expect(col.rows).toHaveLength(0);
  });

  it('os índices desta task seguem as convenções que a fase já pagou duas migrations para fixar', async () => {
    // Sem esta guarda, nada no repositório percebe uma regressão de índice: a
    // assessment_0007 (FK precisa de índice com a coluna como LÍDER) e a
    // assessment_0008 (índice de coluna única que é prefixo à esquerda de um
    // UNIQUE é redundante) foram escritas e nenhum spec passou a consultar
    // pg_indexes. A assessment_0011 realinhou item_response e
    // assessment_application; este teste impede o desalinhamento de voltar.
    const indices = await adminPool.query<{ tablename: string; indexdef: string }>(
      `SELECT tablename, indexdef FROM pg_indexes
        WHERE tablename IN ('item_response', 'assessment_application')`,
    );
    const defsDe = (tabela: string) =>
      indices.rows.filter((r) => r.tablename === tabela).map((r) => r.indexdef);

    // Casa só índice de COLUNA ÚNICA: em "(a, b)" o caractere antes de `b` é
    // espaço, não abre-parêntese, então o composto não é confundido.
    const temIndiceDeColunaUnica = (defs: string[], coluna: string) =>
      defs.some((d) => new RegExp(`\\(${coluna}\\)$`).test(d));

    const itemResponse = defsDe('item_response');
    // (a) prefixo à esquerda de uq_item_response_bloco -- redundante.
    expect(temIndiceDeColunaUnica(itemResponse, 'assessment_application_id')).toBe(false);
    // (b) block_id é a SEGUNDA coluna do UNIQUE, então a FK para block(id)
    //     precisa do índice dedicado.
    expect(temIndiceDeColunaUnica(itemResponse, 'block_id')).toBe(true);

    // (c) mesma consulta e mesmo formato da irmã tenant-scoped `application`,
    //     que tem idx_application_tenant_person. tenant_id é a coluna líder
    //     porque a regra da fase exige isso de toda tabela com tenant_id.
    expect(defsDe('assessment_application').some((d) => /\(tenant_id, person_id\)$/.test(d))).toBe(
      true,
    );
  });

  it('o silo não tem defesa de tenant no banco — quem valida o vínculo é o serviço (Task 9)', async () => {
    // Caracterização deliberada de um BURACO CONHECIDO, não de um recurso.
    //
    // `item_response` é global por desenho: sem `tenant_id`, sem RLS, e a FK
    // para `assessment_application` é simples (não há coluna de tenant do lado
    // filho para compor o par `(tenant_id, id)` que o resto do schema usa). A
    // checagem de FK do Postgres roda com privilégio do sistema e NÃO enxerga
    // RLS -- ou seja, o banco aceita alegremente uma resposta pendurada na
    // ponte de OUTRO tenant, mesmo com `app.tenant_id` apontando para o
    // tenant errado. Este teste prova isso acontecendo.
    //
    // O registro importa porque desloca a fronteira de segurança: no resto do
    // sistema o banco é o backstop (RLS fecha mesmo se o serviço errar); aqui,
    // não existe backstop. Toda a garantia mora no `AssessmentService`, que
    // DEVE conferir que o `assessment_application_id` pertence ao tenant do
    // contexto ANTES de inserir no silo -- o banco não vai reclamar por ele.
    // Se um dia esta asserção virar vermelha porque o banco passou a barrar,
    // ótimo: apague o teste e comemore o backstop.
    const ctx = new TenantContext(appPool);
    let respostaIntrusa: string | null = null;
    try {
      const inserido = await ctx.run(tenantB, (client) =>
        client.query<{ id: string }>(
          `INSERT INTO item_response (assessment_application_id, block_id, resposta_criptografada)
           VALUES ($1, $2, $3) RETURNING id`,
          [
            aaDoA,
            blocoDoA,
            JSON.stringify({ ciphertext: 'x', iv: 'y', authTag: 'z', wrappedDek: 'w' }),
          ],
        ),
      );
      respostaIntrusa = inserido.rows[0].id;
      expect(respostaIntrusa).toBeTruthy();

      // E o mesmo contexto que acabou de escrever no silo continua sem
      // enxergar a ponte em que pendurou a resposta: prova de que o insert
      // passou apesar do isolamento, não por causa de alguma brecha na RLS
      // de `assessment_application`.
      const ponte = await ctx.run(tenantB, (client) =>
        client.query('SELECT id FROM assessment_application WHERE id = $1', [aaDoA]),
      );
      expect(ponte.rows).toHaveLength(0);
    } finally {
      // No finally, nunca depois das asserções: uma asserção falhando não
      // pode vazar linha de silo para o próximo arquivo de spec.
      if (respostaIntrusa) {
        await adminPool.query('DELETE FROM item_response WHERE id = $1', [respostaIntrusa]);
      }
    }
  });
});
