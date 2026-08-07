-- resolve_tenant_id_by_slug (public_0002) resolvia o id de QUALQUER
-- tenant com o slug informado, inclusive um tenant com status <> 'ativo'
-- (ex.: suspenso/inativo administrativamente). Isso mantinha a página de
-- carreiras e o fluxo de candidatura pública 100% funcionais para um
-- tenant inativo -- violando a promessa da spec da Fase 1b ("Tratamento
-- de erro"): slug de tenant inexistente e slug de tenant inativo devem
-- devolver a mesma resposta (404), sem vazar se o tenant existe mas está
-- inativo vs. nunca existiu.
--
-- Achado pela revisão de código consolidada. Corrigido com
-- CREATE OR REPLACE (mesma assinatura, mesmo motivo de SECURITY DEFINER
-- documentado em public_0002 -- a policy RESTRICTIVE tenant_isolation em
-- `tenant` exige app.tenant_id já setado, que é justamente o que esta
-- function existe para descobrir antes de qualquer isolamento por
-- tenant estar em vigor), agora filtrando status = 'ativo'.
CREATE OR REPLACE FUNCTION resolve_tenant_id_by_slug(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM tenant WHERE slug = p_slug AND status = 'ativo';
$$;
