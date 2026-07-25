CREATE TABLE user_account (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  email           text NOT NULL,
  status          text NOT NULL DEFAULT 'ativo',
  mfa_habilitado  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE INDEX idx_user_account_tenant ON user_account (tenant_id, email);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_account TO app_runtime;

ALTER TABLE user_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_account FORCE  ROW LEVEL SECURITY;

-- Postgres nega tudo se só existir política RESTRICTIVE (regra oficial:
-- "if no permissive policies are found, then access is denied" — uma
-- RESTRICTIVE nunca concede nada sozinha, só combina via AND com uma
-- PERMISSIVE). Esta base PERMISSIVE ("true") não concede nada além do que
-- a RESTRICTIVE abaixo deixar passar — é o padrão correto para "RESTRICTIVE
-- é a única regra de negócio que importa aqui".
CREATE POLICY allow_all_base ON user_account
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON user_account
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
