-- Achado do gate consolidado da Fase 0 (fase-0-gate.spec.ts), pego ao
-- rodar a suite completa apos mergear as Tasks 3-6 da autenticacao de
-- staff: a policy tenant_isolation de staff_refresh_token (identity_0009)
-- comparava current_setting('app.tenant_id', true)::uuid direto, sem o
-- NULLIF que platform_0002__rls_guc_fail_closed.sql estabeleceu como
-- padrao obrigatorio do projeto para TODA policy tenant_isolation.
--
-- Raiz do problema (ja documentada em platform_0002, repetida aqui em
-- resumo): ao fim de uma transacao, o Postgres reverte o GUC customizado
-- app.tenant_id para o "reset value", que numa conexao reciclada do pool
-- (o caso normal) e string vazia, nao NULL. Sem o NULLIF, o predicado vira
-- ''::uuid, que estoura 22P02 (invalid input syntax) em vez de
-- simplesmente nao casar nenhuma linha -- falha fechada (nenhum dado
-- vaza), mas como excecao dura em vez de "0 linhas".
--
-- identity_0009 foi escrita citando o padrao de policy de tabelas mais
-- antigas (ex.: identity_0002__tenant.sql), lidas antes de
-- platform_0002 existir no repo local usado como referencia -- nao
-- reproduz o achado de platform_0002, que so corrigiu as 21 tabelas que
-- ja existiam no momento em que foi escrita. Corrigido aqui com o mesmo
-- DROP+CREATE (Postgres nao tem ALTER POLICY para trocar a expressao
-- USING/WITH CHECK).
DROP POLICY tenant_isolation ON staff_refresh_token;

CREATE POLICY tenant_isolation ON staff_refresh_token
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
