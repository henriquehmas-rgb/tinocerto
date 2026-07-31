-- RLS em consent e retention_policy -- as duas últimas tabelas com tenant_id
-- que ainda liam através de tenants.
--
-- A trust_0003 deixou as duas fora do RLS e a fase-0-gate.spec.ts as
-- registrou em RLS_EXCEPTION_TABLES, com esta justificativa:
--
--   "tenant_id é nullable em consent/retention_policy (consentimento de
--    plataforma não pertence a um tenant) [...] isolamento aqui é por
--    person_id/query explícita na camada de aplicação"
--
-- A premissa é verdadeira e a conclusão não decorre dela. Que EXISTA linha de
-- escopo de plataforma (tenant_id NULL) justifica que linha NULL seja visível
-- a todos; não justifica que o tenant B leia a linha do tenant A. E "isolamento
-- por person_id" protege o lado do CANDIDATO (cada titular vê o próprio
-- consentimento) -- não faz nada pelo lado do TENANT: uma sessão de tenant que
-- desse `SELECT * FROM consent` recebia o consentimento LGPD de todo mundo.
--
-- O próprio repositório já tinha o contra-exemplo. `role` estava exatamente
-- nesta situação (tenant_id nullable, linhas de plataforma legítimas) e foi
-- resolvida com POLICY, não com exceção -- a identity_0007__role_rls.sql. O
-- comentário do gate inclusive registra que tratar `role` como exceção teria
-- sido "um falso-negativo vivo". Aqui vale a mesma coisa.
--
-- O predicado `tenant_id IS NULL OR tenant_id = <atual>` entrega tudo o que a
-- nota da trust_0003 queria: linha de plataforma continua visível a todos,
-- linha de tenant fica isolada. Nada do que a justificativa protegia se perde.
--
-- security_incident e data_subject_request continuam DE FORA, e agora por um
-- motivo separado do delas: não têm coluna tenant_id nenhuma, e a resposta a
-- incidente precisa mesmo consultar por titular/categoria atravessando tenants
-- (02-requisitos-e-compliance.md §3.6). A nota da trust_0003 juntava os dois
-- casos numa frase só; são distintos.
--
-- Custo zero agora: as duas tabelas estão VAZIAS e nenhum código de produção
-- as lê (só specs). Depois que a Fase 2b começar a gravar consentimento de
-- reaproveitamento_resultado, deixa de ser.

ALTER TABLE consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent FORCE ROW LEVEL SECURITY;

-- PERMISSIVE de base obrigatória: uma RESTRICTIVE sozinha nega tudo, porque
-- não existe PERMISSIVE para ela restringir. Mesmo par de todas as outras.
CREATE POLICY allow_all_base ON consent
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);

CREATE POLICY tenant_isolation ON consent
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

ALTER TABLE retention_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policy FORCE ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON retention_policy
  FOR ALL TO app_runtime USING (true) WITH CHECK (true);

CREATE POLICY tenant_isolation ON retention_policy
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

-- Guarda auto-verificável: depois desta migration, NENHUMA tabela com
-- tenant_id pode ficar sem FORCE RLS + policy RESTRICTIVE, com a única
-- exceção de candidate_application_summary -- que é índice GLOBAL por
-- desenho (o candidato consulta as próprias candidaturas ATRAVÉS de
-- tenants) e cuja coluna tenant_id, aliás, já foi removida do banco pela
-- resume_0005. Se alguém acrescentar tabela com tenant_id e esquecer o RLS,
-- a migration seguinte que rodar depois desta falha aqui.
DO $$
DECLARE
  desprotegidas text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO desprotegidas
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname <> 'candidate_application_summary'
     AND EXISTS (
       SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = n.nspname
          AND col.table_name = c.relname
          AND col.column_name = 'tenant_id'
     )
     AND NOT (
       c.relrowsecurity
       AND c.relforcerowsecurity
       AND EXISTS (
         SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public'
            AND p.tablename = c.relname
            AND p.permissive = 'RESTRICTIVE'
       )
     );

  IF desprotegidas IS NOT NULL THEN
    RAISE EXCEPTION 'tabela(s) com tenant_id sem RLS completo: %', desprotegidas;
  END IF;
END
$$;
