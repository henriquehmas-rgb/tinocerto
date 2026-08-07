-- apps/api/migrations/copilot_0001__job_description_suggestion.sql
--
-- Sugestão de reescrita fica separada de job.descricao (o campo "vivo")
-- até uma ação explícita de "aplicar" -- nunca substituição silenciosa
-- (05-ia-e-automacao.md §5.3, decisão 2 do design spec desta fase).
-- texto_original é gravado JUNTO com a sugestão (não só lido de job no
-- momento de aplicar) porque é o valor que a guarda de concorrência
-- otimista de aplicar() compara contra o job.descricao ATUAL -- se
-- divergirem, a descrição mudou manualmente nesse meio-tempo e a aplicação
-- é recusada em vez de sobrescrever em silêncio.
CREATE TABLE job_description_suggestion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  job_id          uuid NOT NULL,
  texto_original  text NOT NULL,
  texto_sugerido  text NOT NULL,
  criado_por      uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  aplicado_por    uuid,
  aplicado_em     timestamptz,
  CONSTRAINT fk_job_description_suggestion_tenant_job FOREIGN KEY (tenant_id, job_id)
    REFERENCES job (tenant_id, id)
);

ALTER TABLE job_description_suggestion ADD CONSTRAINT uq_job_description_suggestion_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_job_description_suggestion_tenant_job ON job_description_suggestion (tenant_id, job_id);

GRANT SELECT, INSERT, UPDATE ON job_description_suggestion TO app_runtime;

ALTER TABLE job_description_suggestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_description_suggestion FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON job_description_suggestion
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON job_description_suggestion
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
