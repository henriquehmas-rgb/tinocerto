CREATE TABLE tenant_quota_config (
  tenant_id       uuid PRIMARY KEY REFERENCES tenant(id),
  total_empregados integer NOT NULL DEFAULT 0,
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON tenant_quota_config TO app_runtime;

ALTER TABLE tenant_quota_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_quota_config FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON tenant_quota_config
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON tenant_quota_config
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
