import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { DatabaseModule } from './database.module';
import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  it('executa uma query simples contra o Postgres real', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    const db = moduleRef.get(DatabaseService);
    const rows = await db.query<{ value: number }>('SELECT 1 as value');

    expect(rows).toEqual([{ value: 1 }]);
    await moduleRef.close();
  });

  // CRITICAL 1 da revisão final consolidada da Fase 0: DatabaseService
  // conectava com DATABASE_URL (role dono do schema, superuser nesta fase
  // de dev — rolsuper=t, rolbypassrls=t). Superuser SEMPRE bypassa RLS,
  // inclusive FORCE ROW LEVEL SECURITY, então toda a proteção construída
  // nas Tasks 5-8, 11, 13, 18 estava provada correta apenas nos testes
  // (que constroem manualmente um pool com credenciais app_runtime), nunca
  // no caminho de produção real. Este teste instancia DatabaseService
  // exatamente como o DI real instanciaria (via DatabaseModule, sem
  // reescrever a connection string à mão como os specs de RLS fazem) e
  // prova que o pool de PRODUÇÃO conecta como app_runtime — não
  // superuser, não bypassrls.
  it('conecta como app_runtime (não superuser, não bypassa RLS) — caminho de produção real via DI', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    const db = moduleRef.get(DatabaseService);
    const rows = await db.query<{ user: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT current_user AS user, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].user).toBe('app_runtime');
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);

    await moduleRef.close();
  });

  // Achado Important #1 da verificação adversarial dos fixes finais da
  // Fase 0 (Task 18 bis): o construtor de DatabaseService não validava que
  // APP_DATABASE_URL existe. Provado ao vivo: com APP_DATABASE_URL
  // ausente, `new Pool({ connectionString: undefined })` cai
  // silenciosamente no fallback de variáveis libpq (PGUSER/PGPASSWORD/
  // etc.), que nesta VPS resolve de volta para o role superuser
  // `tinocerto` — reintroduzindo o vazamento de RLS inteiro, sem nenhum
  // erro visível. Este teste instancia DatabaseService diretamente (sem
  // Nest DI — o construtor não tem dependências) com APP_DATABASE_URL
  // temporariamente removido de process.env, e confirma que ele lança
  // de imediato (fail-fast no boot) em vez de deixar a aplicação subir
  // com privilégio de superuser.
  it('lança no construtor se APP_DATABASE_URL estiver ausente (fail-fast, nunca cai no fallback libpq)', () => {
    const original = process.env.APP_DATABASE_URL;
    delete process.env.APP_DATABASE_URL;
    try {
      expect(() => new DatabaseService()).toThrow('APP_DATABASE_URL ausente');
    } finally {
      process.env.APP_DATABASE_URL = original;
    }
  });

  // Achado Important #2 da verificação adversarial dos fixes finais da
  // Fase 0: o comentário original em rls-two-tenant.spec.ts (linha ~225)
  // descrevia current_setting('app.tenant_id', true) retornando NULL como
  // se fosse o único comportamento possível sem set_config prévio. Isso só
  // vale para uma conexão NOVA. Numa conexão RECICLADA de um pool de longa
  // duração — exatamente o que este DatabaseService usa em produção —
  // depois que qualquer transação anterior já setou o GUC customizado
  // app.tenant_id localmente (via set_config(..., true), o padrão do
  // TenantContext.run()) e liberou a conexão de volta ao pool, o GUC
  // reverte para STRING VAZIA, não NULL.
  //
  // [platform_0002__rls_guc_fail_closed.sql] Antes daquela migration, esse
  // '' fazia `''::uuid` estourar 22P02 dentro da própria política RLS, e
  // este teste aceitava "0 linhas OU 22P02" como resultado válido. Aceitar
  // as duas formas escondia um problema real: a exceção derrubava o
  // processo Node inteiro quando o caminho de leitura era um laço
  // fire-and-forget sem try/catch (foi o que aconteceu com os dois
  // consumers de outbox da Fase 1b). Agora a política usa
  // `NULLIF(current_setting('app.tenant_id', true), '')::uuid`, então o
  // comportamento é DETERMINÍSTICO: sempre 0 linhas, nunca exceção.
  //
  // Este teste passou a exigir exatamente isso — 0 linhas E nenhum erro —
  // em vez de tolerar as duas formas. Se alguém reintroduzir o cast direto
  // numa política nova, o 22P02 volta e este teste falha alto, em vez de
  // aceitar silenciosamente a variante que derruba o processo.
  it('conexão reciclada do pool de produção falha fechado com 0 linhas e SEM exceção (nunca 22P02, nunca vaza dado)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();
    const db = moduleRef.get(DatabaseService);
    const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

    // Declarado FORA do try: a limpeza precisa acontecer no finally, não no
    // fim do caminho feliz. Antes, os DELETEs ficavam depois das asserções
    // dentro do try -- uma asserção falhando pulava a limpeza e DEIXAVA a
    // linha de tenant no banco, quebrando um arquivo de spec sem relação
    // nenhuma na próxima rodada (aconteceu de verdade: o CNPJ deste fixture
    // colidia com pipeline-stage-transition.service.spec.ts).
    let tenantId: string | undefined;

    try {
      const t = await adminPool.query<{ id: string }>(
        `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Reciclada', '00000000000045', 'test-tenant-00000000000045') RETURNING id`,
      );
      tenantId = t.rows[0].id;
      await adminPool.query(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'reciclada@teste.com')`,
        [tenantId],
      );

      // Marca a conexão física como "conhecendo" o GUC: seta
      // app.tenant_id localmente (mesmo padrão de TenantContext.run),
      // comita, libera de volta ao pool ainda quente.
      const client1 = await db.pool.connect();
      await client1.query('BEGIN');
      await client1.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await client1.query('COMMIT');
      client1.release();

      // Reusa a MESMA conexão reciclada (único client idle no pool -- o
      // próximo connect() a devolve em vez de abrir uma nova) sem nenhum
      // set_config novo.
      const client2 = await db.pool.connect();
      try {
        await client2.query('BEGIN');
        let caughtCode: string | undefined;
        let rowCount = -1;
        try {
          const result = await client2.query('SELECT * FROM user_account');
          rowCount = result.rows.length;
        } catch (err) {
          caughtCode = (err as { code?: string }).code;
        }
        try {
          await client2.query('ROLLBACK');
        } catch {
          // Já abortada (caso 22P02) -- nada a fazer.
        }

        // Determinístico agora: NENHUM erro, e exatamente 0 linhas.
        // (Antes de platform_0002 isto era "0 linhas OU 22P02".)
        expect(caughtCode).toBeUndefined();
        expect(rowCount).toBe(0);
      } finally {
        client2.release();
      }

    } finally {
      // Limpeza no finally: roda mesmo se uma asserção acima falhar, então
      // uma falha deste teste nunca mais vaza uma linha de tenant para os
      // outros arquivos de spec.
      if (tenantId !== undefined) {
        await adminPool.query('DELETE FROM user_account WHERE tenant_id = $1', [tenantId]);
        await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
      }
      await adminPool.end();
      await moduleRef.close();
    }
  });
});
