-- Corrige achado Important da revisão da Task 1 (Fase 3a): staff_refresh_token
-- (criada em identity_0009__staff_credentials_and_refresh_token.sql) nasceu com
-- FK simples user_id REFERENCES user_account(id) e sem índice com tenant_id
-- líder -- não seguindo a convenção estabelecida deliberadamente em
-- identity_0008__psicologo_credencial_tenant_rls.sql para fechar o vetor de
-- integridade cross-tenant: uma FK simples permite user_id e tenant_id
-- "válidos isoladamente" mas pertencentes a tenants diferentes, o que a RLS
-- de sessão sozinha não pega (a RLS restringe SELECT/INSERT/UPDATE/DELETE
-- pela sessão atual, não valida a integridade referencial entre colunas de
-- uma mesma linha).
--
-- Não corrigido editando identity_0009 diretamente: já aplicada
-- (schema_migrations) e migrations aplicadas são imutáveis -- mesmo padrão
-- de retrofit já usado em identity_0008 para psicologo_credencial e em
-- identity_0007__role_rls.sql para `role`.

-- Remove a FK simples.
ALTER TABLE staff_refresh_token DROP CONSTRAINT staff_refresh_token_user_id_fkey;

-- FK composta: user_account já expõe UNIQUE (tenant_id, id) desde
-- identity_0003__user_account.sql (Task 5) especificamente para permitir
-- esta FK composta em tabelas dependentes.
ALTER TABLE staff_refresh_token
  ADD CONSTRAINT fk_staff_refresh_token_tenant_user
  FOREIGN KEY (tenant_id, user_id) REFERENCES user_account (tenant_id, id);

-- tenant_id como coluna líder do índice -- regra global do plano.
CREATE INDEX idx_staff_refresh_token_tenant ON staff_refresh_token (tenant_id, user_id);
