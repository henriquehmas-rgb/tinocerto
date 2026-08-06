import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { CompetencyService } from '../competency.service';
import { InterviewGuideService } from '../interview-guide.service';

describe('InterviewGuideService', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const tenantContext = new TenantContext(appPool);
  const competencyService = new CompetencyService();
  const guideService = new InterviewGuideService(competencyService);

  let tenantId: string;
  let jobId: string;

  const COMPETENCIAS_5_ANCORAS = (nome: string) => ({
    nome,
    ancoras: [1, 2, 3, 4, 5].map((nivel) => ({ nivel, descricaoComportamental: `Nível ${nivel} de ${nome}` })),
  });

  beforeAll(async () => {
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Interview Guide Ltda','00000000000079','test-tenant-00000000000079') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const orgUnit = await adminPool.query<{ id: string }>(
      `INSERT INTO org_unit (tenant_id, tipo, nome, materialized_path) VALUES ($1, 'empresa', 'Matriz', 'matriz') RETURNING id`,
      [tenantId],
    );
    const req = await adminPool.query<{ id: string }>(
      `INSERT INTO requisition (tenant_id, org_unit_id, titulo, status, approved_at) VALUES ($1, $2, 'Req Guide', 'aprovada', now()) RETURNING id`,
      [tenantId, orgUnit.rows[0].id],
    );
    const job = await adminPool.query<{ id: string }>(
      `INSERT INTO job (tenant_id, requisition_id, titulo, seo_slug) VALUES ($1, $2, 'Vaga Guide', 'vaga-guide') RETURNING id`,
      [tenantId, req.rows[0].id],
    );
    jobId = job.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM interview_guide_version WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM interview_guide WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM competency WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM job WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM requisition WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM org_unit WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await adminPool.end();
    await appPool.end();
  });

  it('cria rascunho, publica versão 1, edita, publica versão 2 -- interview_schedule antigo continuaria na v1', async () => {
    const { id: guideId } = await tenantContext.run(tenantId, (client) =>
      guideService.criarRascunho(client, {
        tenantId,
        jobId,
        competencias: [COMPETENCIAS_5_ANCORAS('Comunicação')],
      }),
    );

    const v1 = await tenantContext.run(tenantId, (client) => guideService.publicar(client, tenantId, guideId));
    expect(v1.versao).toBe(1);

    await tenantContext.run(tenantId, (client) =>
      guideService.editarRascunho(client, tenantId, guideId, [
        COMPETENCIAS_5_ANCORAS('Comunicação'),
        COMPETENCIAS_5_ANCORAS('Resolução de problemas'),
      ]),
    );

    const v2 = await tenantContext.run(tenantId, (client) => guideService.publicar(client, tenantId, guideId));
    expect(v2.versao).toBe(2);
    expect(v2.id).not.toBe(v1.id);

    const v1Row = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT jsonb_array_length(competencias_snapshot) AS n FROM interview_guide_version WHERE id = $1`, [v1.id]),
    );
    expect(v1Row.rows[0].n).toBe(1);

    const v2Row = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT jsonb_array_length(competencias_snapshot) AS n FROM interview_guide_version WHERE id = $1`, [v2.id]),
    );
    expect(v2Row.rows[0].n).toBe(2);
  });

  it('reaproveita competency existente pelo nome em vez de duplicar', async () => {
    const { id: guideA } = await tenantContext.run(tenantId, (client) =>
      guideService.criarRascunho(client, { tenantId, jobId, competencias: [COMPETENCIAS_5_ANCORAS('Liderança')] }),
    );
    const { id: guideB } = await tenantContext.run(tenantId, (client) =>
      guideService.criarRascunho(client, { tenantId, jobId, competencias: [COMPETENCIAS_5_ANCORAS('Liderança')] }),
    );
    expect(guideA).not.toBe(guideB);

    const count = await tenantContext.run(tenantId, (client) =>
      client.query(`SELECT count(*) AS n FROM competency WHERE tenant_id = $1 AND nome = 'Liderança'`, [tenantId]),
    );
    expect(Number(count.rows[0].n)).toBe(1);
  });

  it('não publica um roteiro sem nenhuma competência', async () => {
    const { id: guideId } = await tenantContext.run(tenantId, (client) =>
      guideService.criarRascunho(client, { tenantId, jobId, competencias: [] }),
    );
    await expect(tenantContext.run(tenantId, (client) => guideService.publicar(client, tenantId, guideId))).rejects.toThrow();
  });
});
