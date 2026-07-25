CREATE TABLE role (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenant(id),
  nome          text NOT NULL,
  derived_from  uuid REFERENCES role(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_role_sistema_unico ON role (nome) WHERE tenant_id IS NULL;

CREATE TABLE role_assignment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES user_account(id),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  role_id     uuid NOT NULL REFERENCES role(id),
  scope_path  ltree NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_role_assignment_tenant ON role_assignment (tenant_id, user_id);

GRANT SELECT ON role TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON role_assignment TO app_runtime;

ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignment FORCE  ROW LEVEL SECURITY;

-- Base PERMISSIVE obrigatória — sem ela, a RESTRICTIVE abaixo nega tudo
-- (ver comentário equivalente na migration de user_account, Task 5).
CREATE POLICY allow_all_base ON role_assignment
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON role_assignment
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
