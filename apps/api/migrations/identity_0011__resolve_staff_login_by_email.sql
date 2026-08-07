-- StaffAccountService.login precisa achar a linha de user_account pelo
-- e-mail ANTES de saber a qual tenant o usuário pertence -- é exatamente
-- esse tenant_id que a policy RESTRICTIVE tenant_isolation
-- (identity_0003__user_account.sql) exige em current_setting('app.tenant_id')
-- para liberar leitura. Rodando como app_runtime sem app.tenant_id ainda
-- setado, `SELECT ... FROM user_account WHERE lower(email) = ...` sempre
-- bate na predicate `tenant_id = NULL`, sempre falsa -- trava circular
-- idêntica à já resolvida em public_0002 (resolve_tenant_id_by_slug) para
-- o mesmo problema em `tenant`.
--
-- Achado durante a implementação da Task 5 (StaffAccountService): a
-- analogia com CandidateAccountService.login não se sustenta --
-- candidate_account é uma tabela global sem RLS nenhuma, então o SELECT
-- direto que ela usa não tem nada pra contornar. user_account tem FORCE
-- ROW LEVEL SECURITY de verdade.
--
-- Resolvido com o mesmo padrão de resolve_tenant_id_by_slug: function
-- SECURITY DEFINER estreita, devolvendo só as colunas que o login
-- precisa (nunca a linha inteira -- mfa_secret_cifrado/
-- mfa_backup_codes_cifrados continuam inacessíveis por esta rota), dona
-- do role que roda a migration (superuser nesta fase de dev), portanto
-- bypassa FORCE ROW LEVEL SECURITY como operação administrativa. Não
-- vira uma policy PERMISSIVE adicional em user_account porque isso
-- liberaria SELECT de qualquer linha pra qualquer chamador com
-- app_runtime, não só a busca estreita por e-mail que o login precisa.
CREATE FUNCTION resolve_staff_login_by_email(p_email text)
RETURNS TABLE (id uuid, tenant_id uuid, senha_hash text, mfa_habilitado boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, tenant_id, senha_hash, mfa_habilitado
  FROM user_account
  WHERE lower(email) = lower(p_email);
$$;

REVOKE ALL ON FUNCTION resolve_staff_login_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_staff_login_by_email(text) TO app_runtime;
