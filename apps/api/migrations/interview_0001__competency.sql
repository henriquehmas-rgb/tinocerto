CREATE TABLE competency (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  nome       text NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_competency_tenant_nome UNIQUE (tenant_id, nome)
);

ALTER TABLE competency ADD CONSTRAINT uq_competency_tenant_id UNIQUE (tenant_id, id);

GRANT SELECT, INSERT, UPDATE ON competency TO app_runtime;

ALTER TABLE competency ENABLE ROW LEVEL SECURITY;
ALTER TABLE competency FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON competency
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON competency
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
