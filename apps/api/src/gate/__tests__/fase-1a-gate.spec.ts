import { Pool } from 'pg';

describe('Gate consolidado — Fase 1a (Talent + Hiring)', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  const TENANT_SCOPED_TABLES = [
    'requisition',
    'job',
    'job_custom_field',
    'candidate_touchpoint',
    'application',
    'pipeline_stage_transition',
    'decision',
    'application_custom_field_response',
    'tenant_quota_config',
    'lia_document',
    'result_grant',
  ];

  // Únicas exceções documentadas: identidade global do candidato (00-decisoes-base.md).
  const GLOBAL_EXEMPT_TABLES = ['person', 'person_profile', 'assessment_result'];

  afterAll(async () => {
    await adminPool.end();
  });

  it.each(TENANT_SCOPED_TABLES)('%s tem tenant_id NOT NULL', async (table) => {
    const result = await adminPool.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = 'tenant_id'`,
      [table],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].is_nullable).toBe('NO');
  });

  it.each(TENANT_SCOPED_TABLES)('%s tem RLS habilitada e forçada (pg_class)', async (table) => {
    const result = await adminPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
      [table],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].relrowsecurity).toBe(true);
    expect(result.rows[0].relforcerowsecurity).toBe(true);
  });

  it.each(TENANT_SCOPED_TABLES)('%s tem o par de políticas allow_all_base (PERMISSIVE) + tenant_isolation (RESTRICTIVE)', async (table) => {
    const result = await adminPool.query<{ policyname: string; permissive: string }>(
      `SELECT policyname, permissive FROM pg_policies WHERE tablename = $1`,
      [table],
    );
    const permissive = result.rows.find((r) => r.policyname === 'allow_all_base');
    const restrictive = result.rows.find((r) => r.policyname === 'tenant_isolation');
    expect(permissive?.permissive).toBe('PERMISSIVE');
    expect(restrictive?.permissive).toBe('RESTRICTIVE');
  });

  it.each(GLOBAL_EXEMPT_TABLES)('%s é global de propósito (sem tenant_id) — exceção documentada', async (table) => {
    const result = await adminPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'tenant_id'`,
      [table],
    );
    expect(result.rows).toHaveLength(0);
  });

  it('candidate_touchpoint e pipeline_stage_transition são append-only (sem UPDATE/DELETE para app_runtime)', async () => {
    for (const table of ['candidate_touchpoint', 'pipeline_stage_transition']) {
      const result = await adminPool.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name = $1 AND grantee = 'app_runtime'`,
        [table],
      );
      const privileges = result.rows.map((r) => r.privilege_type);
      expect(privileges).not.toContain('UPDATE');
      expect(privileges).not.toContain('DELETE');
    }
  });

  it('requisition, job, application, job_custom_field usam FK composta (tenant_id, id) para seus pais tenant-scoped', async () => {
    const result = await adminPool.query<{ conrelid: string; confrelid: string; conkey_count: number }>(
      `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent, array_length(conkey, 1) AS conkey_count
       FROM pg_constraint
       WHERE contype = 'f' AND conrelid::regclass::text IN ('requisition', 'job', 'application', 'job_custom_field', 'pipeline_stage_transition', 'decision', 'application_custom_field_response', 'lia_document')
       AND confrelid::regclass::text NOT IN ('tenant', 'person')`,
    );
    for (const row of result.rows) {
      expect(row.conkey_count).toBeGreaterThanOrEqual(2);
    }
  });

  it('org_unit tem UNIQUE(tenant_id, id) (habilita a FK composta de requisition, fechado retroativamente nesta fase)', async () => {
    const result = await adminPool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'org_unit'::regclass AND contype = 'u'`,
    );
    expect(result.rows.some((r) => r.conname === 'uq_org_unit_tenant_id')).toBe(true);
  });

  it('existe policy Cerbos para cada resource kind novo (requisition, job, application, decision)', async () => {
    // Este teste roda contra o diretório de policies versionado, não contra o servidor Cerbos --
    // valida que os 4 arquivos da Task 6 existem e usam o bloqueio universal EFFECT_DENY.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const policiesDir = path.resolve(__dirname, '../../../../../cerbos/policies');
    for (const resource of ['resource_requisition.yaml', 'resource_job.yaml', 'resource_application.yaml', 'resource_decision.yaml']) {
      const content = await fs.readFile(path.join(policiesDir, resource), 'utf-8');
      expect(content).toContain('effect: EFFECT_DENY');
      expect(content).toContain('roles: ["*"]');
    }
  });
});
