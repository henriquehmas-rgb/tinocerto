import { Pool } from 'pg';

describe('schema de adverse_impact_snapshot', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await adminPool.end();
  });

  it('tem RLS FORCE+RESTRICTIVE com predicado NULLIF', async () => {
    const rel = await adminPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'adverse_impact_snapshot'`,
    );
    expect(rel.rows[0].relrowsecurity).toBe(true);
    expect(rel.rows[0].relforcerowsecurity).toBe(true);

    const pol = await adminPool.query<{ policyname: string; permissive: string; qual: string }>(
      `SELECT policyname, permissive, qual FROM pg_policies WHERE tablename = 'adverse_impact_snapshot'`,
    );
    const restritiva = pol.rows.find((r) => r.policyname === 'tenant_isolation');
    expect(restritiva?.permissive).toBe('RESTRICTIVE');
    expect(restritiva?.qual).toContain('NULLIF');
  });

  it('a PK composta é exatamente (tenant_id, job_id, etapa, grupo_demografico)', async () => {
    const { rows } = await adminPool.query<{ column_name: string }>(
      `SELECT a.attname AS column_name
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'adverse_impact_snapshot'::regclass AND i.indisprimary`,
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(
      ['etapa', 'grupo_demografico', 'job_id', 'tenant_id'].sort(),
    );
  });
});
