--
-- competencias_rascunho carrega o MESMO formato do snapshot publicado
-- ([{competencyId, nome, ancoras:[{nivel, descricaoComportamental}]}]) --
-- é a área de trabalho editável enquanto o recrutador ajusta o roteiro,
-- sempre mutável independente de status (mesmo depois de já ter
-- publicado a versão 1, editar aqui e publicar de novo cria a versão 2).
-- status só registra SE o guia já tem alguma versão publicada -- não
-- trava edição nenhuma.
CREATE TABLE interview_guide (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenant(id),
  job_id                 uuid NOT NULL,
  status                 text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'publicado')),
  competencias_rascunho  jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_por             uuid,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_interview_guide_tenant_job FOREIGN KEY (tenant_id, job_id)
    REFERENCES job (tenant_id, id)
);

ALTER TABLE interview_guide ADD CONSTRAINT uq_interview_guide_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_interview_guide_tenant_job ON interview_guide (tenant_id, job_id);

GRANT SELECT, INSERT, UPDATE ON interview_guide TO app_runtime;

ALTER TABLE interview_guide ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_guide FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON interview_guide
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON interview_guide
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
