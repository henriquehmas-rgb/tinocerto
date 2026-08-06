-- apps/api/migrations/llm_router_0001__llm_call_log.sql
--
-- Tabela dedicada para telemetria de chamada de LLM (model_id, provider,
-- prompt_id+versao, custo, latencia) -- doc 05-ia-e-automacao.md §5.4 exige
-- esses campos, mas audit_log_entry (trust_0001) tem um schema GENÉRICO
-- (quem leu o quê, não "quanto custou/quanto demorou/qual prompt"), usado
-- por toda a plataforma. Conflacionar os dois deixaria audit_log_entry com
-- 6 colunas NULL em 99% das linhas não-LLM. Cada chamada grava aqui E uma
-- entrada correspondente em audit_log_entry (action='llm.complete',
-- resource_type='llm_call_log', resource_id=este id) -- a cadeia de hash
-- prova adulteração, este registro carrega o detalhe.
--
-- input_hash em vez de guardar o texto de entrada cru: o input de parsing
-- de currículo contém dado pessoal (LGPD art. 11 se currículo mencionar
-- religião/saúde/etc via texto livre). O texto bruto já é retido no
-- domínio Talent (raw_text do próprio currículo); duplicar aqui violaria
-- minimização de dados. O hash basta para provar, numa auditoria futura,
-- que um input específico foi ou não o que gerou uma saída específica.
CREATE TABLE llm_call_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  actor_id        uuid,
  actor_type      text NOT NULL,
  tier            text NOT NULL CHECK (tier IN ('tier2', 'tier3')),
  provider        text NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  model_id        text NOT NULL,
  prompt_id       text NOT NULL,
  prompt_version  text NOT NULL,
  input_hash      text NOT NULL,
  output_summary  jsonb NOT NULL,
  custo_usd       numeric(10,6) NOT NULL,
  latencia_ms     integer NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_llm_call_log_tenant_occurred ON llm_call_log (tenant_id, occurred_at);

GRANT SELECT, INSERT ON llm_call_log TO app_runtime;

ALTER TABLE llm_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_call_log FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON llm_call_log
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON llm_call_log
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
