-- [Fix round 1, achado #2 do revisor independente da Task 17] Tanto
-- ResumeParsingConsumer quanto CandidateApplicationSummaryConsumer
-- (apps/api/src/resume/) precisam descobrir a lista de tenant_id
-- conhecidos a cada volta do laço de consumo, ANTES/INDEPENDENTE de
-- qualquer app.tenant_id de sessão -- é a MESMA armadilha circular que
-- resolve_tenant_id_by_slug (public_0002__tenant_slug_resolution_function.sql)
-- já existe para resolver: rodando como app_runtime (NOBYPASSRLS), a
-- política RESTRICTIVE tenant_isolation em `tenant`
-- (identity_0002__tenant.sql) exige
-- `id = current_setting('app.tenant_id', true)::uuid`.
--
-- O antigo `SELECT id FROM tenant` direto (listTenantIds(), nos dois
-- consumers) tinha DOIS problemas, não um:
--
--   1. Numa conexão do pool NUNCA tocada por TenantContext.run,
--      current_setting('app.tenant_id', true) volta NULL --
--      `id = NULL` nunca é true, a query devolve 0 linhas SEMPRE,
--      silenciosamente -- nenhum tenant jamais seria descoberto por
--      estes consumers enquanto nenhuma outra parte da app tivesse
--      rodado uma transação tenant-scoped na mesma conexão física.
--
--   2. Numa conexão RECICLADA que já rodou qualquer TenantContext.run
--      antes (comum -- é o mesmo pool de DatabaseService, compartilhado
--      com toda a aplicação), o GUC placeholder reverte para STRING
--      VAZIA ao fim da transação que o setou (comportamento documentado
--      e já testado em database.service.spec.ts, "conexão reciclada do
--      pool de produção falha fechado"). `''::uuid` estoura 22P02
--      (invalid input syntax for type uuid) antes mesmo da comparação
--      rodar.
--
-- O problema (2) sozinho já seria "só" uma falha fechada aceitável (é
-- exatamente o que aquele teste prova e aceita) -- mas
-- CandidateApplicationSummaryConsumer.consumeLoop() e
-- ResumeParsingConsumer.consumeLoop() rodam via `void this.consumeLoop()`
-- (fire-and-forget, onModuleInit) SEM nenhum try/catch ao redor do laço
-- inteiro. A exceção 22P02 sobe sem ser capturada, vira unhandled
-- rejection e derruba o processo Node inteiro -- reproduzido ao vivo
-- (mesmo stack trace do achado do revisor: seis restarts, cada um
-- crashando entre 15-90s depois do primeiro TenantContext.run bem
-- sucedido em qualquer lugar da app).
--
-- Corrigido com o mesmo padrão de resolve_tenant_id_by_slug: uma function
-- SECURITY DEFINER estreita, que só devolve os ids (nunca razao_social/
-- cnpj/plano/status), dona do role que roda a migration (bypassa FORCE
-- ROW LEVEL SECURITY como qualquer outra operação administrativa desta
-- fase) -- os consumers passam a chamar `SELECT id FROM list_all_tenant_ids()`
-- em vez de `SELECT id FROM tenant`, eliminando por completo a
-- dependência do estado (imprevisível) de app.tenant_id na conexão para
-- esta leitura específica. O fix de resiliência complementar (try/catch
-- ao redor do corpo de consumeLoop(), para que nenhuma falha futura de
-- infra volte a derrubar o processo inteiro) vive no código TypeScript
-- dos dois consumers, não nesta migration.
CREATE FUNCTION list_all_tenant_ids()
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM tenant ORDER BY created_at;
$$;

REVOKE ALL ON FUNCTION list_all_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_all_tenant_ids() TO app_runtime;
