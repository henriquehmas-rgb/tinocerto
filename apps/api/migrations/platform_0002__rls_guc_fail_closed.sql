-- Endurecimento transversal de RLS: o cast de app.tenant_id passa a falhar
-- FECHADO em vez de estourar exceção.
--
-- PROBLEMA (raiz, reproduzido ao vivo):
-- Todas as 21 políticas `tenant_isolation` do schema comparavam
-- `current_setting('app.tenant_id', true)::uuid` direto. `TenantContext.run()`
-- seta esse GUC com `set_config(..., true)` (escopo de transação). Ao fim da
-- transação, o Postgres NÃO reverte um GUC customizado para NULL -- reverte
-- para o "reset value", que numa sessão que nunca teve valor de sessão é
-- STRING VAZIA. Comprovado:
--
--   BEGIN; SELECT set_config('app.tenant_id','<uuid>',true); COMMIT;
--   SELECT '[' || current_setting('app.tenant_id', true) || ']';  -->  []
--
-- Ou seja: numa conexão RECICLADA do pool (qualquer conexão que já serviu
-- um TenantContext.run antes -- o caso normal, é o mesmo pool compartilhado
-- por toda a aplicação), o predicado virava `''::uuid`, que estoura
-- 22P02 (invalid input syntax for type uuid: "") em vez de simplesmente não
-- casar nenhuma linha. Confirmado numa tabela real:
--
--   BEGIN; SELECT set_config('app.tenant_id','<uuid>',true); COMMIT;
--   SELECT count(*) FROM job;  -->  ERROR: invalid input syntax for type uuid: ""
--
-- Isso é uma falha FECHADA (nenhum dado vaza), então não é brecha de
-- segurança -- mas transformava "0 linhas" em exceção dura em 21 tabelas.
-- A consequência real já apareceu: os dois consumers de outbox da Fase 1b
-- (`resume/*.consumer.ts`) rodam um laço fire-and-forget via
-- `void this.consumeLoop()`, e a 22P02 subia como unhandled rejection e
-- DERRUBAVA O PROCESSO NODE INTEIRO -- servidor HTTP junto, não só a
-- requisição. Reproduzido por revisão independente 6 vezes, ~15-90s após o
-- primeiro TenantContext.run bem-sucedido em qualquer lugar da app.
--
-- O commit 5c0a257 tratou aquele sintoma nos dois call sites (function
-- SECURITY DEFINER `list_all_tenant_ids()` + try/catch no laço). Esta
-- migration trata a CAUSA: enquanto o predicado estourar em vez de falhar
-- fechado, cada novo trecho de código que tocar uma tabela com RLS fora de
-- `TenantContext.run()` numa conexão reciclada reintroduz a mesma classe de
-- bug -- 21 tabelas de superfície latente para as Fases 2+.
--
-- CORREÇÃO: `NULLIF(current_setting('app.tenant_id', true), '')::uuid`.
--   - GUC = ''        -> NULLIF devolve NULL -> `col = NULL` é NULL -> RLS
--                        trata como falso -> 0 linhas (falha fechada, sem
--                        exceção). Era exatamente o caso que estourava.
--   - GUC = NULL      -> idem (conexão nunca tocada por set_config).
--   - GUC = uuid ok   -> comportamento idêntico ao anterior, sem mudança.
--   - GUC = lixo não-uuid -> AINDA estoura 22P02, de propósito: um tenant_id
--                        malformado chegando em TenantContext.run é bug de
--                        chamador e deve aparecer alto, não sumir como
--                        "0 linhas".
--
-- Isolamento não muda em nada: continua RESTRICTIVE, continua só para
-- app_runtime, continua exigindo GUC válido para casar qualquer linha. A
-- única mudança é o modo de falha: 0 linhas em vez de exceção.

-- As 19 tabelas cujo predicado é exatamente `tenant_id = <cast>`.
-- Feito em laço (e não 19 blocos copiados) de propósito: garante que o
-- predicado é BYTE-A-BYTE idêntico nas 19, sem risco de uma divergir numa
-- cópia manual. A lista de tabelas fica explícita aqui para auditoria, e um
-- nome errado faria o DROP POLICY falhar alto -- nunca passar silencioso.
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'application',
    'application_custom_field_response',
    'audit_log_entry',
    'candidate_touchpoint',
    'decision',
    'job',
    'job_custom_field',
    'lia_document',
    'org_unit',
    'outbox_event',
    'pipeline_stage_transition',
    'psicologo_credencial',
    'requisition',
    'result_grant',
    'role_assignment',
    'service_account',
    'session',
    'tenant_quota_config',
    'user_account'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         AS RESTRICTIVE FOR ALL TO app_runtime
         USING      (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END
$$;

-- `tenant` é especial: a coluna de isolamento é a própria chave primária
-- `id`, não `tenant_id`.
DROP POLICY tenant_isolation ON tenant;
CREATE POLICY tenant_isolation ON tenant
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- `role` é especial: papéis de sistema são globais (tenant_id NULL) e
-- precisam ser visíveis a todos os tenants -- ver identity_0007__role_rls.sql.
DROP POLICY tenant_isolation ON role;
CREATE POLICY tenant_isolation ON role
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Migration que prova a si mesma: se sobrou QUALQUER política no schema
-- ainda fazendo o cast direto (sem NULLIF), aborta a migration inteira em
-- vez de deixar uma tabela para trás silenciosamente. Pega tanto uma tabela
-- esquecida da lista acima quanto uma política nova criada por outra
-- migration futura que copie o padrão antigo.
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename)
    INTO faltando
    FROM pg_policies
   WHERE (coalesce(qual, '') LIKE '%app.tenant_id%' OR coalesce(with_check, '') LIKE '%app.tenant_id%')
     AND NOT (coalesce(qual, '') LIKE '%NULLIF%' AND coalesce(with_check, '') LIKE '%NULLIF%');

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'RLS ainda tem cast fragil de app.tenant_id (sem NULLIF) em: %', faltando;
  END IF;
END
$$;
