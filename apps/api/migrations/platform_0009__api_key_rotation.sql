-- apps/api/migrations/platform_0006__api_key_rotation.sql
--
-- "Rotação com overlap de 7 dias" (doc 04 §6, padrão Stripe) -- expira_em
-- só é preenchido quando uma chave é EXPLICITAMENTE rotacionada (nunca na
-- emissão original): a antiga ganha um prazo de graça, a nova nasce sem
-- expira_em. Mesmo padrão de expiração preguiçosa já usado em
-- idempotency_key.expira_em -- filtro na LEITURA, sem job de limpeza ativo
-- (design spec, decisão 8).
ALTER TABLE api_key ADD COLUMN expira_em timestamptz;
GRANT UPDATE (expira_em) ON api_key TO app_runtime;

-- Postgres não permite CREATE OR REPLACE mudar o RETURNS TABLE de uma
-- function existente -- precisa dropar e recriar (mesma function da 4a,
-- platform_0003, agora com uma coluna a mais no handshake).
DROP FUNCTION resolve_api_key_by_prefix(text);

CREATE FUNCTION resolve_api_key_by_prefix(p_prefixo text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  service_account_id uuid,
  hash text,
  escopos text[],
  revogado_em timestamptz,
  expira_em timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id, tenant_id, service_account_id, hash, escopos, revogado_em, expira_em
  FROM api_key WHERE prefixo = p_prefixo;
$$;

REVOKE ALL ON FUNCTION resolve_api_key_by_prefix(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_api_key_by_prefix(text) TO app_runtime;
