// apps/api/src/copilot/__tests__/job-description-copilot.service.spec.ts
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { AuditLogService } from '../../trust/audit-log.service';
import { ModelRouterService } from '../../llm-router/model-router.service';
import { ProviderAdapter } from '../../llm-router/model-router.types';
import { DatabaseService } from '../../database/database.service';
import {
  JobDescriptionCopilotService,
  JobNotFoundError,
  JobDescriptionSuggestionStaleError,
} from '../job-description-copilot.service';

class AdapterComTextoFixo implements ProviderAdapter {
  readonly name = 'anthropic' as const;
  constructor(private readonly texto: string) {}
  async complete<T>() {
    return { data: { textoReescrito: this.texto } as T, modelId: 'fake-claude', inputTokens: 100, outputTokens: 100 };
  }
}

describe('JobDescriptionCopilotService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);

  let tenantId: string;
  let jobId: string;

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Copilot Job Desc Ltda','00000000000100','test-tenant-00000000000100') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Copilot Job', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, descricao, seo_slug)
       VALUES ($1, $2, 'Analista de Operações', 'Buscamos um cara pra cuidar de operações.', 'analista-operacoes') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM job_description_suggestion WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM llm_call_log WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('gera uma sugestão, aplica, e confirma job.descricao atualizada com trilha de auditoria', async () => {
    const router = new ModelRouterService(
      new AuditLogService(),
      new AdapterComTextoFixo('Buscamos uma pessoa para cuidar de operações.'),
      new AdapterComTextoFixo('fallback não deveria ser chamado aqui'),
    );
    const service = new JobDescriptionCopilotService(router, new AuditLogService(), { pool: appPool } as DatabaseService);

    const suggestion = await service.sugerir({ tenantId, jobId });
    expect(suggestion.textoOriginal).toBe('Buscamos um cara pra cuidar de operações.');
    expect(suggestion.textoSugerido).toBe('Buscamos uma pessoa para cuidar de operações.');

    const applied = await service.aplicar({ tenantId, jobId, suggestionId: suggestion.id });
    expect(applied.descricao).toBe('Buscamos uma pessoa para cuidar de operações.');

    const jobRow = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT descricao FROM job WHERE tenant_id = $1 AND id = $2`, [tenantId, jobId]),
    );
    expect(jobRow.rows[0].descricao).toBe('Buscamos uma pessoa para cuidar de operações.');

    const auditRows = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT action FROM audit_log_entry WHERE tenant_id = $1 AND action = 'copilot.job_description.apply'`, [tenantId]),
    );
    expect(auditRows.rows).toHaveLength(1);
  });

  it('recusa aplicar se a descrição mudou manualmente entre gerar e aplicar', async () => {
    const router = new ModelRouterService(new AuditLogService(), new AdapterComTextoFixo('Sugestão nova.'), new AdapterComTextoFixo('fallback'));
    const service = new JobDescriptionCopilotService(router, new AuditLogService(), { pool: appPool } as DatabaseService);

    const suggestion = await service.sugerir({ tenantId, jobId });

    await tenantContext.run(tenantId, (client) =>
      client.query(`UPDATE job SET descricao = 'Editei isso na mão antes de aplicar a IA.' WHERE tenant_id = $1 AND id = $2`, [tenantId, jobId]),
    );

    await expect(service.aplicar({ tenantId, jobId, suggestionId: suggestion.id })).rejects.toBeInstanceOf(JobDescriptionSuggestionStaleError);

    const jobRow = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT descricao FROM job WHERE tenant_id = $1 AND id = $2`, [tenantId, jobId]),
    );
    expect(jobRow.rows[0].descricao).toBe('Editei isso na mão antes de aplicar a IA.');
  });

  it('rejeita gerar sugestão para vaga inexistente no tenant', async () => {
    const router = new ModelRouterService(new AuditLogService(), new AdapterComTextoFixo('x'), new AdapterComTextoFixo('y'));
    const service = new JobDescriptionCopilotService(router, new AuditLogService(), { pool: appPool } as DatabaseService);
    await expect(service.sugerir({ tenantId, jobId: '00000000-0000-0000-0000-000000000000' })).rejects.toBeInstanceOf(JobNotFoundError);
  });
});
