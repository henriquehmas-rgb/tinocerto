-- Corrige achado [Important] da revisão adversarial da Task 18 (portão
-- final da Fase 0): a tabela `role` (criada em
-- identity_0004__role_and_assignment.sql, Task 5) tem `tenant_id` uuid
-- NULLABLE — roles de SISTEMA (tenant_id IS NULL: admin_tenant,
-- recrutador, gestor_vaga, entrevistador, psicologo_responsavel,
-- cliente_agencia, candidato — ver identity_0005__seed_system_roles.sql)
-- coexistem com roles CUSTOMIZADAS por tenant (tenant_id preenchido) na
-- mesma tabela, mas a tabela nunca recebeu RLS. Confirmado ao vivo antes
-- desta migration: relrowsecurity = f, relforcerowsecurity = f, 0
-- policies em pg_policies para `role`. Com GRANT SELECT ON role TO
-- app_runtime e nenhuma policy, uma role customizada de um tenant seria
-- legível por qualquer outro tenant — diferente das 4 tabelas LGPD de
-- trust_0003, essa lacuna nunca foi documentada como exceção deliberada.
--
-- Não corrigido editando identity_0004__role_and_assignment.sql
-- diretamente: aquela migration já está aplicada (schema_migrations) e
-- migrations aplicadas são imutáveis — editar o arquivo-fonte não muda o
-- estado do banco já provisionado. Precisa de uma migration nova rodando
-- ALTER TABLE contra o schema existente.
--
-- Diferente do padrão-padrão das outras tabelas (USING tenant_id =
-- tenant da sessão), a policy de `role` também precisa admitir
-- tenant_id IS NULL — são as roles de sistema, compartilhadas por todos
-- os tenants por design (a própria idx_role_sistema_unico em
-- identity_0004 já assume isso: unicidade de `nome` só entre as linhas
-- com tenant_id IS NULL). Uma policy que exigisse igualdade estrita
-- esconderia as roles de sistema de todo mundo, quebrando
-- role-assignment.spec.ts e qualquer fluxo de atribuição de papel.
ALTER TABLE role ENABLE ROW LEVEL SECURITY;
ALTER TABLE role FORCE  ROW LEVEL SECURITY;

-- Base PERMISSIVE obrigatória — sem ela, a RESTRICTIVE abaixo nega tudo
-- (ver comentário equivalente na migration de user_account, Task 5).
CREATE POLICY allow_all_base ON role
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON role
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
