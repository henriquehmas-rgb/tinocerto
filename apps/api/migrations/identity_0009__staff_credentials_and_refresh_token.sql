ALTER TABLE user_account
  ADD COLUMN senha_hash text,
  ADD COLUMN mfa_secret_cifrado jsonb,
  ADD COLUMN mfa_backup_codes_cifrados jsonb;

CREATE TABLE staff_refresh_token (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES user_account(id),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  token_hash      text NOT NULL,
  expira_em       timestamptz NOT NULL,
  revogado_em     timestamptz,
  substituido_por uuid REFERENCES staff_refresh_token(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON staff_refresh_token TO app_runtime;

ALTER TABLE staff_refresh_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_refresh_token FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON staff_refresh_token
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON staff_refresh_token
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Onboarding de tenant (Task 4) precisa inserir a PRÓPRIA linha de tenant
-- antes de qualquer outra coisa existir -- identity_0002 concedeu só
-- SELECT/UPDATE a app_runtime, deliberadamente, com uma nota explícita de
-- que criar tenant era "fora de escopo... decisão a tomar nesse momento,
-- não antes". Esse momento é agora: onboarding self-service de tenant é
-- escopo desta fatia. A policy RESTRICTIVE já existente em `tenant`
-- (tenant_isolation, comparando id = app.tenant_id) continua valendo para
-- o INSERT também (FOR ALL cobre INSERT) -- StaffOnboardingService (Task 4)
-- gera o UUID do tenant em código ANTES de abrir a transação e faz
-- set_config('app.tenant_id', <esse uuid>, true) antes do INSERT, para que
-- o WITH CHECK da policy bata.
GRANT INSERT ON tenant TO app_runtime;
