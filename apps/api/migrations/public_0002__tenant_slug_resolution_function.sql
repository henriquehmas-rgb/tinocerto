-- PublicTenantResolutionMiddleware precisa resolver tenant_id a partir de
-- tenantSlug ANTES de qualquer app.tenant_id existir na sessão -- é
-- exatamente esse dado que a policy RESTRICTIVE tenant_isolation
-- (identity_0002__tenant.sql) exige pra liberar leitura da tabela
-- tenant. Rodando como app_runtime (NOBYPASSRLS, sem app.tenant_id
-- setado ainda -- current_setting('app.tenant_id', true) volta NULL), a
-- query direta `SELECT id FROM tenant WHERE slug = $1` sempre bate na
-- predicate `id = NULL`, sempre falsa, e devolve 0 linhas pra QUALQUER
-- slug, inclusive o de um tenant real e ativo -- trava circular:
-- descobrir app.tenant_id é justamente o que essa query tentava fazer.
--
-- Achado pela revisão adversarial do fix round 1 da Task 7, reproduzido
-- ao vivo contra a app rodando via DI real (não contra o
-- adminPool/DATABASE_URL que o spec original do middleware usa, que
-- bypassa RLS e por isso nunca reproduziu o bug).
--
-- Resolvido com uma function SECURITY DEFINER, estreita (só devolve o
-- id, nunca as outras colunas de tenant -- razao_social/cnpj/plano/
-- status seguem inacessíveis a um visitante anônimo), dona do role que
-- roda a migration (superuser nesta fase de dev, mesmo raciocínio já
-- documentado em identity_0002__tenant.sql para o provisionamento de
-- tenant) -- portanto bypassa FORCE ROW LEVEL SECURITY como qualquer
-- outra operação administrativa desta fase. Não vira uma policy
-- PERMISSIVE adicional na tabela porque isso liberaria SELECT da linha
-- inteira (inclusive cnpj/status) pra qualquer request público, não só
-- o id.
CREATE FUNCTION resolve_tenant_id_by_slug(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM tenant WHERE slug = p_slug;
$$;

REVOKE ALL ON FUNCTION resolve_tenant_id_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_id_by_slug(text) TO app_runtime;
