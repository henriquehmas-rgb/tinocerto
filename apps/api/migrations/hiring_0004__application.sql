CREATE TABLE application (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  job_id        uuid NOT NULL,
  person_id     uuid NOT NULL REFERENCES person(id), -- FK simples: person é global, sem tenant_id
  etapa_funil   text NOT NULL DEFAULT 'triagem',
  touchpoint_id uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_application_tenant_job FOREIGN KEY (tenant_id, job_id)
    REFERENCES job (tenant_id, id),
  CONSTRAINT fk_application_tenant_touchpoint FOREIGN KEY (tenant_id, touchpoint_id)
    REFERENCES candidate_touchpoint (tenant_id, id)
);

ALTER TABLE application ADD CONSTRAINT uq_application_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_application_tenant_job    ON application (tenant_id, job_id);
CREATE INDEX idx_application_tenant_person ON application (tenant_id, person_id);
CREATE INDEX idx_application_tenant_stage  ON application (tenant_id, etapa_funil);

GRANT SELECT, INSERT, UPDATE ON application TO app_runtime;

ALTER TABLE application ENABLE ROW LEVEL SECURITY;
ALTER TABLE application FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON application
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON application
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
