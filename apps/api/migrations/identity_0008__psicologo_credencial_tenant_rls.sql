-- Corrige achado CRITICAL 2 da revisão final consolidada da Fase 0:
-- psicologo_credencial (criada em
-- identity_0006__session_service_account_psicologo.sql, Task 6) nasceu
-- sem tenant_id e sem RLS, com o comentário "a credencial CRP é do
-- profissional, não do tenant" — errado: a PK é
-- user_id REFERENCES user_account(id), e user_account já é estritamente
-- por-tenant (cada psicólogo pertence a exatamente um tenant).
--
-- Reproduzido ao vivo pela revisão: conectado como app_runtime com
-- app.tenant_id de um tenant B, foi possível LER a credencial CRP de um
-- psicólogo do tenant A, ALTERAR crp_ativo dele para true, e APAGAR a
-- linha inteira — tudo sem nenhum erro de permissão (GRANT SELECT,
-- INSERT, UPDATE, DELETE completo para app_runtime, zero RLS).
--
-- Grave além do vazamento de dado: o guard central da Task 10
-- (`bloqueio-sem-crp-ativo` no Cerbos, que protege leitura de laudo
-- psicológico) depende inteiramente dos atributos
-- crp_ativo/crp_numero/crp_uf que, quando o sistema de fato ler
-- credenciais do banco (Fase 1+), virão desta tabela. Um tenant
-- conseguindo manipular a credencial de um psicólogo de OUTRO tenant é um
-- jeito de contornar indiretamente o guard de autorização mais sensível
-- de todo o sistema.
--
-- Não corrigido editando identity_0006 diretamente: já aplicada
-- (schema_migrations) e migrations aplicadas são imutáveis — precisa de
-- uma migration nova rodando ALTER TABLE contra o schema existente (mesmo
-- padrão de retrofit já usado em identity_0007__role_rls.sql para `role`).

ALTER TABLE psicologo_credencial ADD COLUMN tenant_id uuid REFERENCES tenant(id);

-- Backfill defensivo: a tabela está vazia hoje (nenhum código de produção
-- real escreve nela ainda, Fase 0), mas o UPDATE cobre corretamente
-- qualquer ambiente que já tenha linhas gravadas antes desta migration,
-- derivando o tenant a partir do dono da credencial em user_account.
UPDATE psicologo_credencial pc
   SET tenant_id = ua.tenant_id
  FROM user_account ua
 WHERE ua.id = pc.user_id
   AND pc.tenant_id IS NULL;

ALTER TABLE psicologo_credencial ALTER COLUMN tenant_id SET NOT NULL;

-- FK composta: fecha o vetor de FK simples que permitiria um tenant_id e
-- um user_id "válidos isoladamente" mas pertencentes a tenants
-- diferentes (parte do achado I4 da revisão sobre FKs simples permitindo
-- referência cross-tenant). user_account já expõe UNIQUE (tenant_id, id)
-- desde identity_0003__user_account.sql (Task 5) especificamente para
-- permitir esta FK composta em tabelas dependentes.
ALTER TABLE psicologo_credencial
  ADD CONSTRAINT fk_psicologo_credencial_tenant_user
  FOREIGN KEY (tenant_id, user_id) REFERENCES user_account (tenant_id, id);

-- tenant_id como coluna líder do índice — regra global do plano.
CREATE INDEX idx_psicologo_credencial_tenant ON psicologo_credencial (tenant_id);

-- RLS completo seguindo o padrão estabelecido em toda a Fase 0 (ver
-- session/service_account no mesmo identity_0006__..., ou o retrofit
-- equivalente em identity_0007__role_rls.sql).
ALTER TABLE psicologo_credencial ENABLE ROW LEVEL SECURITY;
ALTER TABLE psicologo_credencial FORCE  ROW LEVEL SECURITY;

-- Base PERMISSIVE obrigatória — sem ela, a RESTRICTIVE abaixo nega tudo
-- (ver comentário equivalente na migration de user_account, Task 5).
CREATE POLICY allow_all_base ON psicologo_credencial
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON psicologo_credencial
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
