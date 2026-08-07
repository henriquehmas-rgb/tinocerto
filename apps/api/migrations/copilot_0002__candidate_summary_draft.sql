-- apps/api/migrations/copilot_0002__candidate_summary_draft.sql
--
-- application_id (tenant-scoped), NUNCA person_id (global) como chave de
-- acesso -- mesmo limite já documentado em person.service.ts ("o tenant
-- nunca consulta Person diretamente"). aplicado_por/aplicado_em vivem
-- NESTA linha, nunca em person_profile.resumo: person_profile é GLOBAL
-- (talent_0001__person.sql), e gravar ali o resumo escrito pela IA de UM
-- tenant vazaria esse texto para qualquer outro tenant que depois acessar
-- o mesmo Person -- decisão 6 do design spec desta fase. "Aplicar" aqui
-- só marca qual rascunho é o vigente PARA ESTA candidatura.
CREATE TABLE candidate_summary_draft (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  application_id  uuid NOT NULL,
  frases          jsonb NOT NULL, -- [{texto, fonteId, secao, itemIndex, citacaoVerbatim}], cada uma já verificada
  criado_por      uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  aplicado_por    uuid,
  aplicado_em     timestamptz,
  CONSTRAINT fk_candidate_summary_draft_tenant_application FOREIGN KEY (tenant_id, application_id)
    REFERENCES application (tenant_id, id)
);

ALTER TABLE candidate_summary_draft ADD CONSTRAINT uq_candidate_summary_draft_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_candidate_summary_draft_tenant_application ON candidate_summary_draft (tenant_id, application_id);

GRANT SELECT, INSERT, UPDATE ON candidate_summary_draft TO app_runtime;

ALTER TABLE candidate_summary_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_summary_draft FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON candidate_summary_draft
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON candidate_summary_draft
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
