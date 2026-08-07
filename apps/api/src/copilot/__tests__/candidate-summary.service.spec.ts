// apps/api/src/copilot/__tests__/candidate-summary.service.spec.ts
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService } from '../../trust/audit-log.service';
import { ModelRouterService } from '../../llm-router/model-router.service';
import { ProviderAdapter } from '../../llm-router/model-router.types';
import { DatabaseService } from '../../database/database.service';
import { CandidateSummaryService, ApplicationNotFoundError, CandidateSummaryInsufficientDataError } from '../candidate-summary.service';
import { CitacaoNaoVerificavelError } from '../verify-candidate-summary-citations';

class AdapterComFrasesFixas implements ProviderAdapter {
  readonly name = 'anthropic' as const;
  constructor(private readonly frases: { texto: string; fonteId: string; citacaoVerbatim: string }[]) {}
  async complete<T>() {
    return { data: { frases: this.frases } as T, modelId: 'fake-claude', inputTokens: 100, outputTokens: 100 };
  }
}

describe('CandidateSummaryService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);

  let tenantId: string;
  let jobId: string;
  let applicationId: string;
  let personId: string;

  const CITACAO_REAL = 'Analista Pleno na Empresa Exemplo Ltda, de janeiro de 2020 a março de 2023';

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Copilot Candidate Summary Ltda','00000000000101','test-tenant-00000000000101') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Copilot Summary', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Copilot Summary', 'vaga-copilot-summary') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;

    const person = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-copilot-summary','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Copilot','candidato-copilot@example.com') RETURNING id`,
    );
    personId = person.rows[0].id;

    await adminPool.query(
      `INSERT INTO person_profile (person_id, experiencias, formacao, habilidades) VALUES ($1, $2, '[]'::jsonb, '[]'::jsonb)`,
      [
        personId,
        JSON.stringify([
          { cargo: 'Analista Pleno', empresa: 'Empresa Exemplo Ltda', periodo: '2020-2023', descricao: '', citacaoVerbatim: CITACAO_REAL, offsetInicio: 42, offsetFim: 42 + CITACAO_REAL.length },
        ]),
      ],
    );

    const application = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, jobId, personId],
    );
    applicationId = application.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM candidate_summary_draft WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM llm_call_log WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM application WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM person_profile WHERE person_id = $1', [personId]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('gera e persiste um resumo quando toda citação é verificável', async () => {
    const router = new ModelRouterService(
      new AuditLogService(),
      new AdapterComFrasesFixas([{ texto: 'Foi Analista Pleno na Empresa Exemplo.', fonteId: 'experiencia:0', citacaoVerbatim: 'Analista Pleno na Empresa Exemplo Ltda' }]),
      new AdapterComFrasesFixas([]),
    );
    const service = new CandidateSummaryService(router, new AuditLogService(), { pool: appPool } as DatabaseService);

    const draft = await service.gerar({ tenantId, applicationId });
    expect(draft.frases).toHaveLength(1);
    expect(draft.frases[0].secao).toBe('experiencia');

    const rows = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT id FROM candidate_summary_draft WHERE tenant_id = $1 AND application_id = $2`, [tenantId, applicationId]),
    );
    expect(rows.rows).toHaveLength(1);

    const applied = await service.aplicar({ tenantId, applicationId, draftId: draft.id });
    expect(applied.id).toBe(draft.id);
    const atual = await tenantContext.run(tenantId, (client) => service.obterAtual(client, tenantId, applicationId));
    expect(atual?.id).toBe(draft.id);
  });

  // Prova de mutação central da fase: fonteId válido, mas citacaoVerbatim
  // FABRICADA (não é substring do trecho real do currículo) -- precisa
  // rejeitar o resumo inteiro, não persistir nada, e mesmo assim deixar a
  // tentativa auditável em llm_call_log.
  it('rejeita o resumo inteiro quando uma frase cita um trecho fabricado, e mesmo assim audita a tentativa', async () => {
    const router = new ModelRouterService(
      new AuditLogService(),
      new AdapterComFrasesFixas([{ texto: 'Foi Diretor Executivo global.', fonteId: 'experiencia:0', citacaoVerbatim: 'Diretor Executivo global de operações mundiais' }]),
      new AdapterComFrasesFixas([]),
    );
    const service = new CandidateSummaryService(router, new AuditLogService(), { pool: appPool } as DatabaseService);

    const logAntes = await tenantContext.run(tenantId, (client) =>
      client.query<{ count: string }>(`SELECT count(*) FROM llm_call_log WHERE tenant_id = $1 AND prompt_id = 'candidate-summary'`, [tenantId]),
    );

    await expect(service.gerar({ tenantId, applicationId })).rejects.toBeInstanceOf(CitacaoNaoVerificavelError);

    const drafts = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT id FROM candidate_summary_draft WHERE tenant_id = $1 AND application_id = $2`, [tenantId, applicationId]),
    );
    // Só o rascunho do teste anterior (caminho feliz) deveria existir --
    // nenhum novo aqui.
    expect(drafts.rows).toHaveLength(1);

    const logDepois = await tenantContext.run(tenantId, (client) =>
      client.query<{ count: string }>(`SELECT count(*) FROM llm_call_log WHERE tenant_id = $1 AND prompt_id = 'candidate-summary'`, [tenantId]),
    );
    expect(Number(logDepois.rows[0].count)).toBe(Number(logAntes.rows[0].count) + 1);
  });

  it('recusa candidatura de outro tenant -- não vaza person_profile cross-tenant', async () => {
    const outroTenant = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Copilot Summary Outro Tenant','00000000000102','test-tenant-00000000000102') RETURNING id`,
    );
    const router = new ModelRouterService(new AuditLogService(), new AdapterComFrasesFixas([]), new AdapterComFrasesFixas([]));
    const service = new CandidateSummaryService(router, new AuditLogService(), { pool: appPool } as DatabaseService);

    await expect(service.gerar({ tenantId: outroTenant.rows[0].id, applicationId })).rejects.toBeInstanceOf(ApplicationNotFoundError);

    await adminPool.query('DELETE FROM tenant WHERE id = $1', [outroTenant.rows[0].id]);
  });

  it('recusa gerar quando o candidato não tem nenhum item com citação verificada, sem gastar chamada de LLM', async () => {
    const personSemOffset = await adminPool.query<{ id: string }>(
      `INSERT INTO person (cpf_hash, cpf_encriptado, nome, email_principal)
       VALUES ('hash-copilot-sem-offset','{"ciphertext":"x","iv":"y","authTag":"z","wrappedDek":"w"}','Candidato Sem Offset','sem-offset@example.com') RETURNING id`,
    );
    await adminPool.query(
      `INSERT INTO person_profile (person_id, experiencias, formacao, habilidades) VALUES ($1, $2, '[]'::jsonb, '[]'::jsonb)`,
      [personSemOffset.rows[0].id, JSON.stringify([{ cargo: 'x', empresa: 'y', periodo: 'z', descricao: '', citacaoVerbatim: 'não localizável', offsetInicio: null, offsetFim: null }])],
    );
    const applicationSemOffset = await adminPool.query<{ id: string }>(
      `INSERT INTO application (tenant_id, job_id, person_id) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, jobId, personSemOffset.rows[0].id],
    );

    const router = new ModelRouterService(new AuditLogService(), new AdapterComFrasesFixas([]), new AdapterComFrasesFixas([]));
    const service = new CandidateSummaryService(router, new AuditLogService(), { pool: appPool } as DatabaseService);

    const logAntes = await tenantContext.run(tenantId, (client) =>
      client.query<{ count: string }>(`SELECT count(*) FROM llm_call_log WHERE tenant_id = $1 AND prompt_id = 'candidate-summary'`, [tenantId]),
    );

    await expect(service.gerar({ tenantId, applicationId: applicationSemOffset.rows[0].id })).rejects.toBeInstanceOf(CandidateSummaryInsufficientDataError);

    const logDepois = await tenantContext.run(tenantId, (client) =>
      client.query<{ count: string }>(`SELECT count(*) FROM llm_call_log WHERE tenant_id = $1 AND prompt_id = 'candidate-summary'`, [tenantId]),
    );
    expect(logDepois.rows[0].count).toBe(logAntes.rows[0].count); // nenhuma chamada nova -- falha antes do custo de LLM

    await adminPool.query('DELETE FROM application WHERE id = $1', [applicationSemOffset.rows[0].id]);
    await adminPool.query('DELETE FROM person_profile WHERE person_id = $1', [personSemOffset.rows[0].id]);
    await adminPool.query('DELETE FROM person WHERE id = $1', [personSemOffset.rows[0].id]);
  });
});
