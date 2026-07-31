import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';

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

// Exceção deliberada e documentada ao RLS obrigatório por tenant_id, POR
// NOME DE TABELA (não por arquivo — ver correção do achado 1 da revisão
// adversarial da Task 18 abaixo). São as 2 tabelas de trust_0003
// (Task 14) cujo tenant_id é NULLABLE porque representam dado de escopo
// de PLATAFORMA, não de um tenant só (consentimento/política de retenção
// que não pertence a um tenant específico) — isolamento nelas é por
// person_id/query explícita na camada de aplicação, não por RLS de
// tabela (ver comentário no fim de trust_0003__consent_incident_retention_dsr.sql).
//
// security_incident e data_subject_request (também de trust_0003) NÃO
// entram aqui: não têm coluna tenant_id nenhuma, então nem a checagem
// estática nem a checagem de banco abaixo as encontram — não é omissão,
// é que a pergunta "tem tenant_id sem RLS?" não se aplica a elas.
//
// `role` (identity_0004, Task 5) e audit_log_entry (trust_0001, Task 13)
// NÃO entram aqui: ambas têm RLS completo — role desde
// identity_0007__role_rls.sql (achado 1 desta revisão: `role` tinha
// tenant_id e zero RLS, um falso-negativo vivo que a checagem antiga não
// pegava — corrigido com uma migration nova de RLS, não com uma exceção
// aqui). Incluir qualquer uma das duas nesta lista faria os testes abaixo
// pularem silenciosamente uma tabela que DEVE ter isolamento — um buraco
// de cobertura, não um detalhe de configuração.
//
// `candidate_application_summary` (resume_0003, Fase 1b Task 14) entra
// aqui por um motivo correlato mas não idêntico ao de consent/
// retention_policy acima: a tabela em si não é "dado de um tenant" -- é
// um índice GLOBAL, na mesma classe de person/resume_upload (ver nota no
// topo de resume_0003__candidate_application_summary.sql), que um
// candidato usa para ver TODAS as suas candidaturas espalhadas por
// múltiplos tenants numa única consulta. RLS por tenant_id seria não só
// desnecessário como contraproducente aqui: uma policy de tenant
// limitaria cada leitura a UM tenant por vez, exatamente o problema que
// este índice existe para evitar (ver nota de design em
// resume/candidate-application-summary.consumer.ts e
// candidate-auth/candidate-application.controller.ts). O isolamento que
// importa -- "só o próprio candidato vê sua própria linha" -- é garantido
// por WHERE person_id = <candidato autenticado> na camada de aplicação,
// mesmo princípio de consent/retention_policy acima.
//
// IMPORTANTE (achado [Low] da revisão do gate consolidado, Task 18, fix
// round 1): a tabela VIVA no banco não tem mais coluna tenant_id nenhuma
// -- resume_0005__candidate_application_summary_drop_tenant_id.sql
// (também Task 18) removeu a coluna NOT NULL que resume_0003 tinha
// criado por engano (mesma classe de "comentário mentiroso no schema"
// que aquela própria migration corrige: o comentário de resume_0003 já
// dizia "sem tenant_id", mas o DDL criava a coluna assim mesmo). Esta
// entrada no Set, porém, continua necessária: migrations aplicadas são
// imutáveis, então o texto de resume_0003__candidate_application_summary.sql
// ainda contém `tenant_id uuid NOT NULL` para sempre, e a checagem
// ESTÁTICA abaixo (`findCreateTableBlocks` + `tableHasTenantId`) lê o
// texto-fonte concatenado de todas as migrations, não o estado do banco
// -- sem a exceção aqui, ela continuaria exigindo FORCE ROW LEVEL
// SECURITY + policy RESTRICTIVE para uma tabela que hoje nem tem
// tenant_id para isolar. Já a checagem AUTORITATIVA (estado real do
// banco, mais abaixo) nem chega a precisar da exceção para esta tabela
// especificamente -- sua query filtra por `information_schema.columns
// ... column_name = 'tenant_id'`, e como a coluna não existe mais essa
// tabela simplesmente não aparece no resultado; a entrada no Set fica
// inerte ali, não incorreta.
// consent e retention_policy SAÍRAM desta lista na trust_0004. A exceção
// partia de uma premissa verdadeira ("tenant_id é nullable porque existe
// consentimento de escopo de plataforma") e tirava dela uma conclusão que não
// decorre: que EXISTA linha de plataforma justifica a linha NULL ser visível a
// todos, não que o tenant B leia a linha do tenant A. E "isolamento por
// person_id na camada de aplicação" cobre o lado do titular, não o lado do
// tenant -- `SELECT * FROM consent` numa sessão de tenant devolvia o
// consentimento LGPD de todos. O predicado `tenant_id IS NULL OR tenant_id =
// <atual>`, o mesmo que identity_0007 deu a `role` (que estava exatamente
// nesta situação e foi resolvida com policy, não com exceção), entrega o que a
// justificativa queria sem o vazamento.
const RLS_EXCEPTION_TABLES = new Set(['candidate_application_summary']);

// Reforço do portão pedido pela revisão final consolidada (achado
// CRITICAL 2): toda tabela com uma FK para user_account ou para tenant
// deveria ter sua PRÓPRIA coluna tenant_id — psicologo_credencial
// (identity_0006, Task 6) tinha FK para user_account (que é estritamente
// por-tenant) sem ter tenant_id nenhuma, e nem a checagem estática nem a
// autoritativa acima pegavam isso: as duas só olham tabelas que JÁ têm
// tenant_id, nunca tabelas que deveriam ter e não têm. Hoje, com
// identity_0008__psicologo_credencial_tenant_rls.sql aplicada, nenhuma
// tabela do schema está nesta situação — este Set existe para exceções
// FUTURAS legítimas e documentadas (nenhuma até o momento), não porque
// alguma tabela precise dele agora.
const STRUCTURAL_TENANT_ID_EXCEPTION_TABLES = new Set<string>([]);

// --- Helpers da checagem estática (por tabela, não por arquivo) ---------
//
// Corrige o achado [Important] "a checagem central do portão é por
// ARQUIVO, não por TABELA": a versão anterior fazia
// `/CREATE TABLE \w+ \(\s*[\s\S]*?tenant_id\s+uuid/i.test(content)` e, se
// desse match, exigia `FORCE ROW LEVEL SECURITY` e `AS RESTRICTIVE` EM
// QUALQUER LUGAR do arquivo inteiro — sem amarrar a cláusula à tabela que
// de fato tinha tenant_id. Num arquivo com duas tabelas (o caso real de
// identity_0004__role_and_assignment.sql: `role` sem RLS e
// `role_assignment` com RLS completo), bastava UMA delas ter RLS para o
// arquivo inteiro passar — `role` ficou com tenant_id e zero RLS, e o
// portão nunca acusou.
//
// Os helpers abaixo extraem cada `CREATE TABLE` como um bloco delimitado
// pelos próprios parênteses (contando profundidade e ignorando parênteses
// dentro de literais de string) e casam `ALTER TABLE ... FORCE ROW LEVEL
// SECURITY` / `CREATE POLICY ... ON <tabela> AS RESTRICTIVE` pelo NOME da
// tabela — nunca "existe em algum lugar do arquivo".

interface CreateTableBlock {
  name: string;
  body: string; // conteúdo entre os parênteses do CREATE TABLE, parênteses inclusos
}

// Acha o índice do parêntese de fechamento que casa com o parêntese de
// abertura em `openIndex`, contando profundidade e pulando conteúdo
// dentro de aspas simples (onde um `)` literal, ex. em um default de
// texto, não deve contar como fechamento de escopo SQL). `''` dentro de
// uma string é a forma padrão do Postgres de escapar uma aspas simples
// literal — consome o par sem sair do modo "dentro de string".
function findMatchingClose(sql: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          i += 1;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      continue;
    }
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Reconhece `CREATE TABLE nome (`, `CREATE TABLE IF NOT EXISTS nome (`,
// `CREATE TABLE schema.nome (` e identificadores entre aspas — as 3
// formas que a regex antiga (`/CREATE TABLE \w+ \(/`) não casava (achado
// [Important] "a regex não casa CREATE TABLE IF NOT EXISTS nem nomes
// qualificados por schema"). `apps/api/scripts/__fixtures__/migrations/
// 0001_test__create_foo.sql` já usa `CREATE TABLE IF NOT EXISTS` — não é
// uma forma hipotética, é a forma idiomática mais comum em migrations.
function findCreateTableBlocks(sql: string): CreateTableBlock[] {
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?\w+"?\.)?"?(\w+)"?\s*\(/gi;
  const blocks: CreateTableBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    const name = match[1];
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingClose(sql, openIndex);
    if (closeIndex === -1) {
      throw new Error(
        `findCreateTableBlocks: parêntese de CREATE TABLE ${name} nunca fechou (SQL malformado ou bug no parser).`,
      );
    }
    blocks.push({ name, body: sql.slice(openIndex, closeIndex + 1) });
  }
  return blocks;
}

function tableHasTenantId(block: CreateTableBlock): boolean {
  return /tenant_id\s+uuid/i.test(block.body);
}

// ALTER TABLE só referencia uma tabela por statement — casar pelo nome
// dela diretamente após ALTER TABLE não tem o risco de "vazar" para uma
// tabela vizinha.
function hasForceRls(sql: string, tableName: string): boolean {
  const re = new RegExp(
    `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:"?\\w+"?\\.)?"?${tableName}"?\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
    'i',
  );
  return re.test(sql);
}

// CREATE POLICY é onde a versão anterior do bug se escondia: uma regex
// "AS RESTRICTIVE existe em algum lugar do arquivo" casaria mesmo se a
// RESTRICTIVE pertencesse a OUTRA tabela. Aqui a captura amarra `ON
// <tabela>` diretamente ao `AS PERMISSIVE|RESTRICTIVE` da MESMA cláusula
// CREATE POLICY (sem `[\s\S]*?` atravessando para o próximo statement).
interface PolicyBlock {
  table: string;
  permissive: 'PERMISSIVE' | 'RESTRICTIVE';
}

function findPolicyBlocks(sql: string): PolicyBlock[] {
  const re =
    /CREATE\s+POLICY\s+\w+\s+ON\s+(?:"?\w+"?\.)?"?(\w+)"?\s+AS\s+(PERMISSIVE|RESTRICTIVE)\b/gi;
  const blocks: PolicyBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    blocks.push({ table: match[1], permissive: match[2].toUpperCase() as 'PERMISSIVE' | 'RESTRICTIVE' });
  }
  return blocks;
}

function hasRestrictivePolicy(sql: string, tableName: string): boolean {
  return findPolicyBlocks(sql).some((b) => b.table === tableName && b.permissive === 'RESTRICTIVE');
}

describe('Portão da Fase 0 — critérios de "pronto" consolidados', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await adminPool.end();
  });

  it(
    'checagem estática por tabela: nenhum CREATE TABLE com tenant_id fica sem ' +
      'FORCE+RESTRICTIVE amarrados ao MESMO nome de tabela (defesa em profundidade, PR-time)',
    () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

      // Guarda contra o próprio bug de path que este teste corrige: se o
      // diretório resolvido estivesse errado, files.length seria 0 e o
      // laço abaixo passaria sem checar nada.
      expect(files.length).toBeGreaterThan(0);

      // Concatenado (todas as migrations juntas) porque FORCE ROW LEVEL
      // SECURITY / CREATE POLICY de uma tabela podem estar numa migration
      // POSTERIOR à que criou a tabela — caso real: `role` nasce em
      // identity_0004__role_and_assignment.sql, seu RLS foi adicionado
      // depois em identity_0007__role_rls.sql (migrations aplicadas são
      // imutáveis, então retrofit de RLS numa tabela já existente sempre
      // vem como migration nova). Checar só o arquivo que criou a tabela
      // reintroduziria, para esse caso, o mesmo tipo de falso-negativo que
      // este teste corrige.
      const allContent = files
        .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'))
        .join('\n\n');

      const tableBlocks = findCreateTableBlocks(allContent);
      let tablesWithTenantIdChecked = 0;

      for (const block of tableBlocks) {
        if (!tableHasTenantId(block)) continue;
        if (RLS_EXCEPTION_TABLES.has(block.name)) continue;

        tablesWithTenantIdChecked += 1;

        expect(hasForceRls(allContent, block.name)).toBe(true);
        expect(hasRestrictivePolicy(allContent, block.name)).toBe(true);
      }

      // Confirma que a checagem acima rodou de fato contra casos reais
      // (tenant, user_account, role, role_assignment, org_unit,
      // outbox_event, audit_log_entry, session, service_account, entre
      // outras) — não só que a pasta não estava vazia.
      expect(tablesWithTenantIdChecked).toBeGreaterThan(0);
    },
  );

  it(
    'nenhuma tabela com tenant_id está sem FORCE ROW LEVEL SECURITY + policy ' +
      'RESTRICTIVE no ESTADO REAL do banco (checagem autoritativa)',
    async () => {
      // Corrige a raiz do achado [Important] "o portão verifica o
      // TEXTO-FONTE, nunca o estado real do banco": migrations aplicadas
      // são imutáveis, então arquivo e realidade podem divergir para
      // sempre com a checagem estática acima verde (um `ALTER TABLE x NO
      // FORCE ROW LEVEL SECURITY` aplicado à mão no banco, por exemplo,
      // nunca aparece em nenhum .sql). Esta consulta ao catálogo do
      // Postgres é a fonte de verdade: pega `role` sem depender de regex,
      // pega drift entre arquivo-fonte e banco, e pega qualquer tabela
      // futura — não só as que a checagem estática souber parsear.
      const { rows } = await adminPool.query<{ relname: string; rls_ok: boolean }>(`
        SELECT
          c.relname,
          (
            c.relrowsecurity
            AND c.relforcerowsecurity
            AND EXISTS (
              SELECT 1 FROM pg_policies p
              WHERE p.schemaname = 'public'
                AND p.tablename = c.relname
                AND p.permissive = 'RESTRICTIVE'
            )
          ) AS rls_ok
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND EXISTS (
            SELECT 1 FROM information_schema.columns col
            WHERE col.table_schema = n.nspname
              AND col.table_name = c.relname
              AND col.column_name = 'tenant_id'
          )
        ORDER BY c.relname
      `);

      // Mesma guarda de "asserção que não pode falhar" de sempre: se a
      // query acima devolvesse 0 linhas por um erro de nome de
      // schema/coluna, o filtro abaixo passaria vazio por acidente, não
      // porque toda tabela está protegida.
      expect(rows.length).toBeGreaterThan(0);

      const unexpected = rows
        .filter((r) => !r.rls_ok && !RLS_EXCEPTION_TABLES.has(r.relname))
        .map((r) => r.relname);

      expect(unexpected).toEqual([]);
    },
  );

  it(
    'nenhuma policy faz o cast direto de app.tenant_id — todas usam NULLIF, ' +
      'para falhar fechado em conexão reciclada em vez de estourar 22P02',
    async () => {
      // [platform_0002__rls_guc_fail_closed.sql] `set_config('app.tenant_id',
      // ..., true)` é escopado à transação, mas ao fim dela o Postgres NÃO
      // reverte um GUC customizado para NULL — reverte para STRING VAZIA. Numa
      // conexão RECICLADA do pool (o caso normal: é o mesmo pool compartilhado
      // por toda a app), `current_setting('app.tenant_id', true)` devolve '' e
      // o cast direto `''::uuid` ESTOURA 22P02 dentro da própria política, em
      // vez de simplesmente não casar linha nenhuma.
      //
      // Isso falha fechado (não vaza dado), mas transformar "0 linhas" em
      // exceção dura já derrubou o processo Node inteiro em produção: os dois
      // consumers de outbox da Fase 1b rodam `void this.consumeLoop()`
      // (fire-and-forget), a 22P02 virou unhandled rejection e levou o
      // servidor HTTP junto — reproduzido 6x por revisão independente.
      //
      // A correção é `NULLIF(current_setting('app.tenant_id', true), '')::uuid`:
      // '' e NULL viram NULL, a comparação vira NULL, a RLS trata como falso →
      // 0 linhas, sem exceção. Um tenant_id genuinamente malformado ainda
      // estoura, de propósito (é bug de chamador e deve aparecer alto).
      //
      // Este teste é o que impede a REINTRODUÇÃO da classe do bug: vale para
      // qualquer tabela, inclusive as que ainda não existem. Uma policy nova
      // de Fase 2+ que copie o padrão antigo falha aqui, não em produção.
      const { rows } = await adminPool.query<{ tablename: string; policyname: string }>(`
        SELECT tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (coalesce(qual, '') LIKE '%app.tenant_id%'
               OR coalesce(with_check, '') LIKE '%app.tenant_id%')
          AND NOT (coalesce(qual, '') LIKE '%NULLIF%'
                   AND coalesce(with_check, '') LIKE '%NULLIF%')
        ORDER BY tablename, policyname
      `);

      expect(rows.map((r) => `${r.tablename}.${r.policyname}`)).toEqual([]);
    },
  );

  it(
    'a checagem de NULLIF acima não é vácua — existe de fato um conjunto de ' +
      'policies usando app.tenant_id para ela vigiar',
    async () => {
      // Guarda de "asserção que não pode falhar": se um erro de nome de
      // schema/coluna fizesse a query anterior devolver 0 linhas sempre, ela
      // passaria verde por acidente e não porque as policies estão corretas.
      const { rows } = await adminPool.query<{ total: string }>(`
        SELECT count(*) AS total
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (coalesce(qual, '') LIKE '%app.tenant_id%'
               OR coalesce(with_check, '') LIKE '%app.tenant_id%')
      `);

      expect(Number(rows[0].total)).toBeGreaterThan(0);
    },
  );

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

  // CRITICAL 1 da revisão final consolidada: o teste acima confirma que a
  // ROLE app_runtime, em si, não é superuser nem bypassa RLS — mas nunca
  // confirma que a APLICAÇÃO de fato conecta como ela. Antes desta
  // correção, DatabaseService (o provider @Global que todo código de
  // produção futuro injeta) conectava com DATABASE_URL — o role DONO do
  // schema, superuser/BYPASSRLS nesta fase de dev — e só os arquivos de
  // TESTE construíam manualmente um pool com credenciais app_runtime.
  // Ou seja: toda a proteção de RLS da Fase 0 estava provada correta nos
  // testes, mas não protegeria nada se código de produção real fosse
  // escrito hoje contra DatabaseService. Este teste instancia
  // DatabaseService exatamente como o DI real instanciaria (via
  // DatabaseModule, sem reescrever a connection string à mão) — é a
  // mesma checagem de apps/api/src/database/database.service.spec.ts,
  // duplicada aqui de propósito para que o PORTÃO da Fase 0 não dependa
  // de outro arquivo de spec continuar existindo/passando para cobrir
  // este achado.
  it('o pool de PRODUÇÃO (DatabaseService via DI real) conecta como app_runtime — não como o role dono/superuser', async () => {
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

  // CRITICAL 2 da revisão final consolidada: as duas checagens de RLS
  // acima (estática e autoritativa) só examinam tabelas que JÁ têm
  // tenant_id — nenhuma delas pergunta "existe uma tabela que DEVERIA ter
  // tenant_id e não tem?". psicologo_credencial (identity_0006, Task 6)
  // tinha FK para user_account (estritamente por-tenant) sem nenhuma
  // coluna tenant_id própria, e passou pelas duas checagens acima sem
  // acusar nada — porque nenhuma delas nem chegava a olhar para ela. Esta
  // checagem estrutural varre pg_constraint por toda FK que aponte para
  // user_account ou tenant e confirma que a tabela que declara a FK tem
  // sua própria coluna tenant_id — é o teste que, se existisse antes,
  // teria pego psicologo_credencial no estado original.
  it(
    'toda tabela com FK para user_account ou tenant tem sua própria coluna ' +
      'tenant_id (checagem estrutural que teria pego psicologo_credencial no estado original)',
    async () => {
      const { rows } = await adminPool.query<{ referencing_table: string }>(`
        SELECT DISTINCT rel.relname AS referencing_table
        FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_class frel ON frel.oid = c.confrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        WHERE c.contype = 'f'
          AND n.nspname = 'public'
          AND frel.relname IN ('user_account', 'tenant')
        ORDER BY rel.relname
      `);

      // Mesma guarda de "asserção que não pode falhar" de sempre: se a
      // query acima devolvesse 0 linhas por um erro de nome de
      // tabela/schema, o laço abaixo passaria vazio por acidente — não
      // porque toda tabela com FK relevante tem tenant_id.
      expect(rows.length).toBeGreaterThan(0);

      const missing: string[] = [];
      for (const { referencing_table } of rows) {
        if (STRUCTURAL_TENANT_ID_EXCEPTION_TABLES.has(referencing_table)) continue;

        const col = await adminPool.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'tenant_id'`,
          [referencing_table],
        );
        if (col.rows.length === 0) missing.push(referencing_table);
      }

      expect(missing).toEqual([]);
    },
  );

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

// --- Auto-teste dos helpers de checagem estática ---------------------------
//
// Achado [Important] da revisão adversarial: "o portão passa a afirmar que a
// detecção funciona sem nunca provar isso" — os testes acima só rodam contra
// migrations reais, que já são (depois desta correção) todas compliant. Sem
// um caso negativo, um regresso nos helpers acima (ex.: alguém volta a regex
// para a forma antiga `/CREATE TABLE \w+ \(/`) passaria despercebido: as
// migrations reais continuariam com RLS de verdade, os testes do describe
// acima continuariam verdes, e a CAPACIDADE de detecção — o que esses testes
// deveriam estar garantindo — teria silenciosamente regredido.
//
// Os casos abaixo rodam os helpers contra SQL sintético em memória (nunca
// tocam o disco nem o banco) e prova três coisas que a suíte anterior só
// afirmava: (1) formas que a regex antiga não casava agora casam, (2) uma
// tabela com tenant_id e zero RLS é corretamente REPROVADA, e (3) a
// RESTRICTIVE de uma tabela vizinha não "vaza" para aprovar por engano uma
// tabela sem RLS própria — a reprodução em miniatura do achado 1 (`role`
// tinha RLS zero, mas `role_assignment`, no mesmo arquivo, tinha RLS
// completo, e a checagem antiga não distinguia as duas).
describe('auto-teste dos helpers de checagem estática (achado 2 da revisão adversarial)', () => {
  it('reconhece CREATE TABLE IF NOT EXISTS e CREATE TABLE schema.tabela', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS leaky_a (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL
      );
      CREATE TABLE public.leaky_b (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL
      );
    `;
    const blocks = findCreateTableBlocks(sql);
    const names = blocks.map((b) => b.name);

    expect(names).toContain('leaky_a');
    expect(names).toContain('leaky_b');
    expect(blocks.every((b) => tableHasTenantId(b))).toBe(true);
  });

  it('caso negativo: reprova uma tabela com tenant_id e ZERO RLS (o helper DEVE detectar isso)', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS leaky_c (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL
      );
      GRANT SELECT, INSERT ON leaky_c TO app_runtime;
    `;

    expect(hasForceRls(sql, 'leaky_c')).toBe(false);
    expect(hasRestrictivePolicy(sql, 'leaky_c')).toBe(false);
  });

  it(
    'caso negativo: a RESTRICTIVE de uma tabela vizinha, no mesmo arquivo, não aprova ' +
      'por engano uma tabela sem RLS própria (reprodução em miniatura do achado 1 — role/role_assignment)',
    () => {
      const sql = `
        CREATE TABLE table_a (id uuid PRIMARY KEY, tenant_id uuid);
        CREATE TABLE table_b (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);

        GRANT SELECT ON table_a TO app_runtime;
        GRANT SELECT, INSERT, UPDATE, DELETE ON table_b TO app_runtime;

        ALTER TABLE table_b ENABLE ROW LEVEL SECURITY;
        ALTER TABLE table_b FORCE  ROW LEVEL SECURITY;

        CREATE POLICY allow_all_base ON table_a
          AS PERMISSIVE FOR ALL TO app_runtime
          USING (true)
          WITH CHECK (true);

        CREATE POLICY allow_all_base ON table_b
          AS PERMISSIVE FOR ALL TO app_runtime
          USING (true)
          WITH CHECK (true);

        CREATE POLICY tenant_isolation ON table_b
          AS RESTRICTIVE FOR ALL TO app_runtime
          USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
          WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
      `;

      // table_a: só tem PERMISSIVE, nunca teve FORCE — deve reprovar.
      expect(hasForceRls(sql, 'table_a')).toBe(false);
      expect(hasRestrictivePolicy(sql, 'table_a')).toBe(false);

      // table_b: tem o par completo — deve aprovar.
      expect(hasForceRls(sql, 'table_b')).toBe(true);
      expect(hasRestrictivePolicy(sql, 'table_b')).toBe(true);
    },
  );

  it('caso positivo: reconhece FORCE+RESTRICTIVE mesmo quando vêm de uma migration diferente da CREATE TABLE', () => {
    // Reproduz o caso real de `role`: CREATE TABLE numa "migration" e o
    // RLS retrofit numa "migration" posterior — o teste do describe
    // principal concatena todos os arquivos antes de checar por esse
    // motivo exato.
    const migrationUm = `CREATE TABLE good_table (id uuid PRIMARY KEY, tenant_id uuid);`;
    const migrationDois = `
      ALTER TABLE good_table ENABLE ROW LEVEL SECURITY;
      ALTER TABLE good_table FORCE  ROW LEVEL SECURITY;
      CREATE POLICY allow_all_base ON good_table
        AS PERMISSIVE FOR ALL TO app_runtime USING (true) WITH CHECK (true);
      CREATE POLICY tenant_isolation ON good_table
        AS RESTRICTIVE FOR ALL TO app_runtime
        USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    `;
    const allContent = [migrationUm, migrationDois].join('\n\n');

    const blocks = findCreateTableBlocks(allContent);
    expect(blocks.some((b) => b.name === 'good_table' && tableHasTenantId(b))).toBe(true);
    expect(hasForceRls(allContent, 'good_table')).toBe(true);
    expect(hasRestrictivePolicy(allContent, 'good_table')).toBe(true);
  });
});
