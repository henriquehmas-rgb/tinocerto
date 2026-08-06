-- Achado de revisão adversarial da Task 4: recompute() precisa apagar
-- linhas obsoletas antes de reinserir (senão um grupo que caiu abaixo do
-- limiar mínimo, ou perdeu autodeclaração por revogação de consentimento,
-- fica preso no snapshot com valor calculado sobre dado que já não
-- existe). insights_0001 concedeu só SELECT/INSERT/UPDATE.
GRANT DELETE ON adverse_impact_snapshot TO app_runtime;
