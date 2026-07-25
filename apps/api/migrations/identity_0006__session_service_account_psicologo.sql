CREATE TABLE session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES user_account(id),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          inet,
  user_agent  text
);

CREATE INDEX idx_session_tenant_user ON session (tenant_id, user_id);

CREATE TABLE service_account (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  nome           text NOT NULL,
  scopes         text[] NOT NULL DEFAULT '{}',
  ip_allowlist   text[] NOT NULL DEFAULT '{}',
  owner_user_id  uuid NOT NULL REFERENCES user_account(id),
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_account_tenant ON service_account (tenant_id);

CREATE TABLE psicologo_credencial (
  user_id         uuid PRIMARY KEY REFERENCES user_account(id),
  crp_numero      text NOT NULL,
  crp_uf          text NOT NULL,
  crp_ativo       boolean NOT NULL DEFAULT false,
  verificado_em   timestamptz,
  verificado_por  uuid REFERENCES user_account(id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON session TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_account TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON psicologo_credencial TO app_runtime;

ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE session FORCE  ROW LEVEL SECURITY;
-- Base PERMISSIVE obrigatória — sem ela, a RESTRICTIVE abaixo nega tudo
-- (ver comentário equivalente na migration de user_account, Task 5).
CREATE POLICY allow_all_base ON session
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);
CREATE POLICY tenant_isolation ON session
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE service_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_account FORCE  ROW LEVEL SECURITY;
-- Base PERMISSIVE obrigatória — sem ela, a RESTRICTIVE abaixo nega tudo
-- (ver comentário equivalente na migration de user_account, Task 5).
CREATE POLICY allow_all_base ON service_account
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);
CREATE POLICY tenant_isolation ON service_account
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- psicologo_credencial não carrega tenant_id (a credencial CRP é do
-- profissional, não do tenant) — sem RLS por tenant aqui de propósito.
