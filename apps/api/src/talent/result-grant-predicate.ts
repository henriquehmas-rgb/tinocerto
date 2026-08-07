// apps/api/src/talent/result-grant-predicate.ts
//
// Predicado de segurança compartilhado entre ReportService.gerar
// (Trilho A, sessão) e PsychReportService.obterIntegra (Fase 4d, API key).
// Extraído para UMA constante em vez de copiado -- é defesa em
// profundidade contra a conexão que ignora RLS (comentário original em
// report.service.ts explica o motivo completo de cada cláusula); duas
// cópias independentes divergem silenciosamente com o tempo, o mesmo
// risco que resource_laudo_psicologico.yaml já documentou e corrigiu para
// a checagem de tenant (consolidação em uma única regra DENY universal).
// Assume alias `r` para assessment_result no FROM do chamador.
export const RESULT_GRANT_LIVE_EXISTS = `EXISTS (
  SELECT 1
    FROM result_grant g
    JOIN consent c ON c.id = g.consent_id
   WHERE g.assessment_result_id = r.id
     AND g.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND g.revoked_at IS NULL
     AND (g.expires_at IS NULL OR g.expires_at > now())
     AND c.revoked_at IS NULL
     AND (c.ttl_meses IS NULL
          OR c.granted_at + (c.ttl_meses * interval '1 month') > now())
     AND (c.tenant_id IS NULL OR c.tenant_id = g.tenant_id)
)`;
