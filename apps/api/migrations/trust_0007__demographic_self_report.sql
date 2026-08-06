-- Autodeclaração demográfica: chave (tenant_id, person_id), reaproveitável
-- entre as várias candidaturas da mesma pessoa ao mesmo tenant -- não
-- redeclara a cada vaga nova. Todas as quatro colunas de categoria são
-- NULLABLE de propósito: autodeclaração precisa ser voluntária em CADA
-- dimensão ("prefiro não informar" é uma resposta legítima), não um
-- pacote tudo-ou-nada.
CREATE TABLE demographic_self_report (
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  person_id     uuid NOT NULL REFERENCES person(id),
  genero        text,
  raca_cor      text,
  faixa_etaria  text,
  pcd           boolean,
  consent_id    uuid NOT NULL REFERENCES consent(id),
  declarado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, person_id)
);

GRANT SELECT, INSERT, UPDATE ON demographic_self_report TO app_runtime;

ALTER TABLE demographic_self_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE demographic_self_report FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON demographic_self_report
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON demographic_self_report
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
