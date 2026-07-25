CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE org_unit (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  parent_id          uuid REFERENCES org_unit(id),
  tipo               text NOT NULL CHECK (tipo IN ('empresa', 'regiao', 'unidade', 'departamento')),
  nome               text NOT NULL,
  materialized_path  ltree NOT NULL,
  ativo              boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_unit_tenant ON org_unit (tenant_id);
CREATE INDEX idx_org_unit_path   ON org_unit USING gist (materialized_path);

GRANT SELECT, INSERT, UPDATE, DELETE ON org_unit TO app_runtime;

ALTER TABLE org_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_unit FORCE  ROW LEVEL SECURITY;

-- Base PERMISSIVE obrigatória — sem ela, a RESTRICTIVE abaixo nega tudo
-- (ver comentário equivalente na migration de user_account, Task 5).
CREATE POLICY allow_all_base ON org_unit
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON org_unit
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
