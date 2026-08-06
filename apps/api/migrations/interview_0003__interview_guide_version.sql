--
-- Append-only por natureza: uma versão publicada nunca muda -- é o que
-- garante que interview_schedule/scorecard/perguntas do Copiloto (fase
-- futura) referenciando esta versão nunca vejam a régua da entrevista
-- mudar debaixo deles. Mesmo padrão de instrument_version.itens_snapshot
-- (Fase 2a).
CREATE TABLE interview_guide_version (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenant(id),
  interview_guide_id     uuid NOT NULL,
  versao                 integer NOT NULL,
  competencias_snapshot  jsonb NOT NULL,
  publicado_por          uuid,
  publicado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_interview_guide_version_tenant_guide FOREIGN KEY (tenant_id, interview_guide_id)
    REFERENCES interview_guide (tenant_id, id),
  CONSTRAINT uq_interview_guide_version UNIQUE (tenant_id, interview_guide_id, versao)
);

ALTER TABLE interview_guide_version ADD CONSTRAINT uq_interview_guide_version_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_interview_guide_version_tenant_guide ON interview_guide_version (tenant_id, interview_guide_id);

GRANT SELECT, INSERT ON interview_guide_version TO app_runtime;

ALTER TABLE interview_guide_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_guide_version FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON interview_guide_version
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON interview_guide_version
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
