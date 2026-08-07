-- apps/api/migrations/resume_0006__candidate_application_summary_tenant_id.sql
--
-- resume_0005 removeu tenant_id desta tabela porque, até a Fase 1b, nunca
-- era lido de volta (ver comentário histórico naquela migration). A Fase
-- 3d muda esse cálculo: "Como fomos avaliados"
-- (CandidateEvaluationViewService) precisa resolver o tenant_id de uma
-- application_id ANTES de poder ler decision/offer/pipeline_stage_transition
-- (todas tenant-scoped com RLS FORCE) num TenantContext.run(tenantId, ...)
-- -- e candidate_application_summary é a ÚNICA superfície de leitura já
-- desenhada para ser segura para um candidato consultar SEM tenant
-- conhecido a priori (filtra por person_id, não tem RLS porque não tem
-- tenant a isolar -- identidade global do candidato pode ter candidaturas
-- em N tenants). Reintroduzida aqui porque agora tem um consumidor real --
-- mesma disciplina que motivou a remoção original, aplicada ao inverso.
ALTER TABLE candidate_application_summary
  ADD COLUMN tenant_id uuid REFERENCES tenant(id);

-- Backfill determinístico via application (application_id é UNIQUE nesta
-- tabela, join 1:1).
UPDATE candidate_application_summary cas
   SET tenant_id = a.tenant_id
  FROM application a
 WHERE a.id = cas.application_id;

ALTER TABLE candidate_application_summary ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX idx_candidate_application_summary_tenant ON candidate_application_summary (tenant_id);
