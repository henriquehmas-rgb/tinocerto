import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

// Diretório de migrations resolvido via __dirname, não via cwd do processo
// Jest. `pnpm test` roda com cwd = apps/api (rootDir do jest.config.js é
// 'src', mas isso não muda o cwd do processo node) — um caminho relativo
// tipo 'apps/api/migrations/*.sql' apontaria, na prática, para
// apps/api/apps/api/migrations, que não existe. Isso faria o passo abaixo
// falhar ao listar arquivos (ou devolver lista vazia) e o teste passaria
// vacuamente, iterando sobre zero migrations — a mesma classe de "asserção
// que não pode falhar" já achada e corrigida na Task 14. __dirname é
// estável independente de onde o Jest é invocado.
const MIGRATIONS_DIR = join(__dirname, '../../migrations');

// Exceção deliberada e documentada ao RLS obrigatório por tenant_id: as 4
// tabelas LGPD criadas em trust_0003__consent_incident_retention_dsr.sql
// (Task 14) — consent e retention_policy têm tenant_id NULLABLE
// (consentimento de plataforma não pertence a um tenant só) e
// security_incident/data_subject_request nem têm coluna tenant_id;
// isolamento nelas é por person_id/query explícita na camada de aplicação,
// não por RLS de tabela (ver comentário no fim daquela migration).
//
// audit_log_entry (Task 13, trust_0001__audit_log_entry.sql) NÃO entra
// nesta lista: ela TEM RLS completo (ENABLE + FORCE ROW LEVEL SECURITY e
// policy AS RESTRICTIVE com tenant_isolation) — não é uma exceção.
// Incluí-la aqui faria este teste pular silenciosamente a única tabela de
// trilha de auditoria imutável da plataforma, um buraco de cobertura, não
// um detalhe de regex.
const RLS_EXCEPTION_FILE_PATTERN =
  /consent|security_incident|retention_policy|data_subject_request/;

describe('Portão da Fase 0 — critérios de "pronto" consolidados', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await adminPool.end();
  });

  it('CI bloquearia merge de tabela tenant_id sem FORCE+RESTRICTIVE (checagem estática)', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

    // Guarda contra o próprio bug de path que este teste corrige: se o
    // diretório resolvido estivesse errado, files.length seria 0 e o for
    // abaixo passaria sem checar nada. As migrations reais do repositório
    // neste momento da Fase 0 são 11 — mas fixamos só ">0" aqui (em vez de
    // "===11") para não quebrar toda vez que uma migration nova legítima
    // for adicionada; o que importa é que a lista não esteja vazia por
    // engano de path.
    expect(files.length).toBeGreaterThan(0);

    let filesWithTenantIdChecked = 0;

    for (const file of files) {
      const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      const createsTableWithTenantId = /CREATE TABLE \w+ \(\s*[\s\S]*?tenant_id\s+uuid/i.test(
        content,
      );

      if (createsTableWithTenantId && !RLS_EXCEPTION_FILE_PATTERN.test(file)) {
        expect(content).toMatch(/FORCE\s+ROW LEVEL SECURITY/i);
        expect(content).toMatch(/AS RESTRICTIVE/i);
        filesWithTenantIdChecked += 1;
      }
    }

    // Confirma que a checagem acima rodou de fato contra casos reais
    // (identity_0003__user_account.sql, identity_0004__role_and_assignment.sql,
    // org_graph_0001__org_unit.sql, platform_0001__outbox_event.sql,
    // trust_0001__audit_log_entry.sql, entre outras) — não só que a pasta
    // não estava vazia, mas que o filtro por tenant_id encontrou e
    // verificou migrations de verdade.
    expect(filesWithTenantIdChecked).toBeGreaterThan(0);
  });

  it('app_runtime não é superuser nem tem bypassrls', async () => {
    const rows = await adminPool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_runtime'`,
    );

    // Precondição explícita antes de indexar rows.rows[0]: se a role
    // app_runtime não existisse (ambiente mal provisionado), o erro deve
    // apontar para "role ausente", não para um TypeError opaco de
    // "undefined.rolsuper".
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].rolsuper).toBe(false);
    expect(rows.rows[0].rolbypassrls).toBe(false);
  });

  it('todas as migrations do manifest foram aplicadas', async () => {
    const manifest = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'manifest.json'), 'utf-8')) as {
      migrations: string[];
    };
    expect(manifest.migrations.length).toBeGreaterThan(0);

    const applied = await adminPool.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const appliedSet = new Set(applied.rows.map((r) => r.filename));

    for (const filename of manifest.migrations) {
      expect(appliedSet.has(filename)).toBe(true);
    }
  });

  it('o manifest não referencia nenhum arquivo de migration inexistente no disco', () => {
    // Complementar ao teste acima: cobre o sentido inverso — um filename em
    // manifest.json sem .sql correspondente no diretório (typo, rename sem
    // atualizar o manifest). O teste anterior não pegaria isso sozinho se
    // o typo também nunca tivesse sido aplicado em schema_migrations.
    const manifest = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'manifest.json'), 'utf-8')) as {
      migrations: string[];
    };
    const filesOnDisk = new Set(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')));

    for (const filename of manifest.migrations) {
      expect(filesOnDisk.has(filename)).toBe(true);
    }
  });
});
