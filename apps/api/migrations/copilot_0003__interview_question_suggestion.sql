-- apps/api/migrations/copilot_0003__interview_question_suggestion.sql
--
-- Sem aplicado_por/aplicado_em de propósito: ao contrário das duas tabelas
-- acima, perguntas de entrevista não têm campo "vivo" para sobrescrever --
-- são material de referência para o entrevistador consultar, nunca
-- inseridas automaticamente em nenhum registro (scorecard, roteiro).
-- interview_guide_version_id é o rubric_id+versão do contrato da Fase 3a
-- -- gerar sem uma versão publicada real é estruturalmente impossível
-- (FK composta), não só uma checagem de aplicação.
CREATE TABLE interview_question_suggestion (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenant(id),
  interview_guide_version_id  uuid NOT NULL,
  itens                       jsonb NOT NULL, -- [{competencyId, nome, perguntas: string[]}], 1:1 com o snapshot
  criado_por                  uuid,
  criado_em                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_interview_question_suggestion_tenant_guide_version FOREIGN KEY (tenant_id, interview_guide_version_id)
    REFERENCES interview_guide_version (tenant_id, id)
);

ALTER TABLE interview_question_suggestion ADD CONSTRAINT uq_interview_question_suggestion_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_interview_question_suggestion_tenant_version ON interview_question_suggestion (tenant_id, interview_guide_version_id);

GRANT SELECT, INSERT ON interview_question_suggestion TO app_runtime;

ALTER TABLE interview_question_suggestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_question_suggestion FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON interview_question_suggestion
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON interview_question_suggestion
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
