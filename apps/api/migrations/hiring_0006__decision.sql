CREATE TABLE decision (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  application_id     uuid NOT NULL,
  tipo               text NOT NULL CHECK (tipo IN ('aprovacao', 'reprovacao', 'oferta')),
  motivo_codigo      text,
  decidido_por       uuid NOT NULL,
  revisao_solicitada boolean NOT NULL DEFAULT false,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_decision_tenant_application FOREIGN KEY (tenant_id, application_id)
    REFERENCES application (tenant_id, id),
  CONSTRAINT fk_decision_tenant_decidido_por FOREIGN KEY (tenant_id, decidido_por)
    REFERENCES user_account (tenant_id, id)
);

CREATE INDEX idx_decision_tenant_application ON decision (tenant_id, application_id);

GRANT SELECT, INSERT, UPDATE ON decision TO app_runtime;

ALTER TABLE decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON decision
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON decision
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
