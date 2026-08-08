-- Achado C1 da revisão final da feature de autenticação de staff/onboarding/
-- MFA: POST /v1/staff/auth/refresh não estava na lista de exclusão de
-- `TenantResolutionMiddleware` em `AppModule` -- exigia um access token
-- válido e NÃO EXPIRADO só para alcançar o controller, inutilizando o
-- próprio propósito de refresh (existe justamente para quando o access
-- token JÁ expirou).
--
-- Corrigido do lado do Nest adicionando a rota à lista de exclusão -- mas
-- isso cria o mesmo problema circular de RLS que `resolve_staff_login_by_email`
-- (identity_0011) resolveu para `login`: `POST /refresh` não sabe o tenant do
-- usuário até achar a linha de `staff_refresh_token` pelo hash do token
-- apresentado -- e a policy RESTRICTIVE `tenant_isolation` dessa tabela
-- (identity_0009, corrigida em identity_0012) exige `app.tenant_id` já
-- setado para liberar a leitura. `StaffAuthController.refresh` passa a abrir
-- a transação com o mesmo `PLACEHOLDER_TENANT` que `login`/`onboarding` já
-- usam, e `StaffTokenService.rotate` usa esta function SECURITY DEFINER
-- estreita para achar a linha pelo hash independente de tenant, e só então
-- faz `set_config('app.tenant_id', ...)` na mesma transação antes de
-- revogar/emitir -- mesmo padrão de `StaffAccountService.login`.
CREATE FUNCTION resolve_staff_refresh_token_by_hash(p_token_hash text)
RETURNS TABLE (id uuid, user_id uuid, tenant_id uuid, expira_em timestamptz, revogado_em timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, user_id, tenant_id, expira_em, revogado_em
  FROM staff_refresh_token
  WHERE token_hash = p_token_hash;
$$;

REVOKE ALL ON FUNCTION resolve_staff_refresh_token_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_staff_refresh_token_by_hash(text) TO app_runtime;
