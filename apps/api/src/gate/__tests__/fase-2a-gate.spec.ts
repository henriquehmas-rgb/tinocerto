import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { ReportService } from '../../assessment/report/report.service';
import { classificarTermosClinicos } from '../../assessment/report/clinical-vocabulary-linter';
import { ITENS_SEMEADOS, TODOS_OS_ITENS } from '../../assessment/__tests__/seed-scope';

describe('Gate consolidado — Fase 2a (Motor de Assessment)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Pool de RUNTIME (app_runtime): é o papel sujeito a RLS. O papel de admin
  // é rolbypassrls, então ler o relatório por ele derrotaria o gate.
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);

  const API_ROOT = path.resolve(__dirname, '../../..');
  const VERSION_ID = 'a55e55e0-0000-4000-8000-000000000002';

  afterAll(async () => {
    await adminPool.end();
    await appPool.end();
  });

  it('assessment_application tem RLS completa com o predicado NULLIF (nunca o cast direto)', async () => {
    const { rows } = await adminPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'assessment_application'`,
    );
    expect(rows[0].relrowsecurity).toBe(true);
    expect(rows[0].relforcerowsecurity).toBe(true);

    const pol = await adminPool.query<{ policyname: string; permissive: string; qual: string }>(
      `SELECT policyname, permissive, qual FROM pg_policies WHERE tablename = 'assessment_application'`,
    );
    const restritiva = pol.rows.find((r) => r.policyname === 'tenant_isolation');
    expect(restritiva?.permissive).toBe('RESTRICTIVE');
    expect(restritiva?.qual).toContain('NULLIF');
  });

  it.each(['item', 'item_parameter_version', 'block', 'instrument', 'instrument_version', 'item_response', 'calibration_run'])(
    '%s é global de propósito (sem tenant_id) — banco de itens e silo são ativos de plataforma',
    async (tabela) => {
      const { rows } = await adminPool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'tenant_id'`,
        [tabela],
      );
      expect(rows).toHaveLength(0);
    },
  );

  it('NENHUMA tabela do domínio expõe coluna de percentil', async () => {
    const { rows } = await adminPool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND (column_name ILIKE '%percentil%' OR column_name ILIKE '%percentile%')`,
    );
    expect(rows).toEqual([]);
  });

  it('nenhum arquivo do domínio Assessment menciona percentil no código', () => {
    const arquivos = [
      'src/assessment/assessment.service.ts',
      'src/assessment/report/report.service.ts',
      'src/assessment/assessment.controller.ts',
      'src/assessment/scoring/mfc-scoring.ts',
    ];
    for (const arquivo of arquivos) {
      const conteudo = readFileSync(path.join(API_ROOT, arquivo), 'utf-8').toLowerCase();
      expect(conteudo).not.toContain('percentile');
      expect(conteudo).not.toContain('percentil');
    }
  });

  it('o CAT continua travado enquanto houver parâmetro provisório', async () => {
    await expect(
      adminPool.query(`UPDATE instrument_version SET modo_administracao = 'cat' WHERE id = $1`, [VERSION_ID]),
    ).rejects.toThrow(/provisorio/i);
  });

  it('trilho B não pode ser ativado sem CRP ativo', async () => {
    const inst = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument (nome, tipo_instrumento)
       VALUES ('Gate Trilho B', 'teste_psicologico_satepsi') RETURNING id`,
    );
    try {
      await expect(
        adminPool.query(
          `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true)`,
          [inst.rows[0].id],
        ),
      ).rejects.toThrow(/crp_ativo/i);
    } finally {
      await adminPool.query('DELETE FROM instrument WHERE id = $1', [inst.rows[0].id]);
    }
  });

  it('item_response não concede DELETE (a resposta é o dado que calibra)', async () => {
    const { rows } = await adminPool.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'item_response' AND grantee = 'app_runtime'`,
    );
    expect(rows.map((r) => r.privilege_type)).not.toContain('DELETE');
  });

  // As duas metades deste gate têm escopos OPOSTOS e por isso são dois testes.
  // Importe os fragmentos de `src/assessment/__tests__/seed-scope.ts`; NÃO
  // escreva `WHERE banco_id = 'ipip_contextualizado'` (esse é o DEFAULT da
  // coluna, então pega fixture de teste, e desde a assessment_0013 nem pega
  // mais o seed, que vive em 'seed_ipip_v1').

  it('NENHUM item do banco usa vocabulário clínico -- escopo aberto', async () => {
    // Aberto de propósito: a Res. CFP 31/2022 fala de todo enunciado legível
    // por candidato, e a Task 10 acrescenta um segundo instrument_version
    // (modo CAT) cujos itens escapariam de um escopo por instrumento.
    // Fixture vazada aqui só gera falso POSITIVO, nunca falso negativo.
    const { rows } = await adminPool.query<{ enunciado: string }>(
      `WITH todos AS (${TODOS_OS_ITENS}) SELECT enunciado FROM todos`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(40);

    const ofensores = rows.filter((r) => classificarTermosClinicos(r.enunciado).length > 0);
    expect(ofensores.map((r) => r.enunciado)).toEqual([]);
  });

  it('todo item do SEED é contextualizado ao trabalho -- escopo fechado', async () => {
    // Fechado de propósito: "começa com 'No trabalho,'" é uma propriedade do
    // conteúdo semeado, não uma regra do banco inteiro. As fixtures da suíte
    // usam enunciados como 'x', que legitimamente não seguem essa convenção.
    const { rows } = await adminPool.query<{ enunciado: string }>(
      `WITH semeados AS (${ITENS_SEMEADOS}) SELECT enunciado FROM semeados`,
    );
    expect(rows).toHaveLength(40);

    const ofensores = rows.filter((r) => !r.enunciado.startsWith('No trabalho,'));
    expect(ofensores.map((r) => r.enunciado)).toEqual([]);
  });

  // CORRIGIDO depois da revisão da Task 11 -- a versão anterior deste caso NÃO
  // PODIA passar. Ela chamava `gerar(adminPool, id)` com um fixture de apenas
  // person + assessment_result: sem tenant, sem consent, sem result_grant e
  // sem app.tenant_id. Como a Task 11 fechou a leitura por result_grant sob
  // RLS, `NULLIF(current_setting('app.tenant_id', true), '')` resolve NULL, o
  // EXISTS nunca casa e a chamada estoura NotFoundException. Além disso a
  // assinatura passou a receber PoolClient, então `adminPool` (um Pool) nem
  // compila -- falha de build, que ao menos é barulhenta.
  //
  // O gate precisa montar a autorização INTEIRA e ler pelo pool de runtime,
  // como report.service.spec.ts faz. Ler por adminPool derrotaria o gate: o
  // superusuário tem BYPASSRLS, então o teste passaria sem provar que a
  // autorização funciona.
  it('o relatório gerado tem rodapé obrigatório, corpo sem termo clínico e nenhum percentil', async () => {
    const tenant = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug)
       VALUES ('Gate 2a Ltda','00000000000057','test-tenant-00000000000057') RETURNING id`,
    );
    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-gate-2a','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Gate 2a','gate2a@example.com')
       RETURNING id`,
    );
    const r = await adminPool.query<{ id: string }>(
      `INSERT INTO assessment_result
         (person_id, instrument_version_id, theta, se_theta, escore_bruto, protocolo_confianca, respondido_em, calibracao_versao)
       VALUES ($1,$2,$3,$4,$3,0.6,now(),'literatura_v1') RETURNING id`,
      [
        person.rows[0].id,
        VERSION_ID,
        JSON.stringify({ conscienciosidade: 1.0, extroversao: 0, amabilidade: -1.0, estabilidade: 0.2, abertura: 0.4 }),
        JSON.stringify({ conscienciosidade: 0.3, extroversao: 0.4, amabilidade: 0.35, estabilidade: 0.4, abertura: 0.4 }),
      ],
    );
    const consent = await adminPool.query<{ id: string }>(
      `INSERT INTO consent (person_id, tenant_id, finalidade, base_legal)
       VALUES ($1,$2,'reaproveitamento_resultado','consentimento') RETURNING id`,
      [person.rows[0].id, tenant.rows[0].id],
    );
    // `granted_at` (não `concedido_em`): é o nome real da coluna em
    // result_grant desde a talent_0002.
    await adminPool.query(
      `INSERT INTO result_grant (tenant_id, assessment_result_id, consent_id, granted_at)
       VALUES ($1,$2,$3,now())`,
      [tenant.rows[0].id, r.rows[0].id, consent.rows[0].id],
    );

    try {
      // Pelo pool de RUNTIME e dentro do TenantContext -- é o caminho de
      // produção, e o único em que a autorização é de fato exercitada.
      const relatorio = await tenantContext.run(tenant.rows[0].id, (client) =>
        new ReportService().gerar(client, r.rows[0].id),
      );
      expect(relatorio.rodape).toMatch(/não constitui avaliação psicológica/i);
      const corpo = relatorio.secoes.map((s) => `${s.titulo} ${s.texto}`).join(' ');
      expect(classificarTermosClinicos(corpo)).toEqual([]);
      expect(JSON.stringify(relatorio).toLowerCase()).not.toContain('percentil');
    } finally {
      // Ordem inversa da criação por causa das FKs.
      await adminPool.query('DELETE FROM result_grant WHERE assessment_result_id = $1', [r.rows[0].id]);
      await adminPool.query('DELETE FROM consent WHERE id = $1', [consent.rows[0].id]);
      await adminPool.query('DELETE FROM assessment_result WHERE id = $1', [r.rows[0].id]);
      await adminPool.query('DELETE FROM person WHERE id = $1', [person.rows[0].id]);
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenant.rows[0].id]);
    }
  });
});
