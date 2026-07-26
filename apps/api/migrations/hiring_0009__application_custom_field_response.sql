-- job_custom_field (Task 13) foi criada só com PRIMARY KEY (id), sem
-- UNIQUE(tenant_id, id) -- na época não havia nenhuma tabela filha
-- referenciando-a por FK composta. application_custom_field_response é a
-- primeira, então a constraint precisa existir antes da FK composta abaixo.
ALTER TABLE job_custom_field ADD CONSTRAINT uq_job_custom_field_tenant_id UNIQUE (tenant_id, id);

CREATE TABLE application_custom_field_response (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  application_id     uuid NOT NULL,
  job_custom_field_id uuid NOT NULL,
  valor_criptografado jsonb NOT NULL,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_acfr_tenant_application FOREIGN KEY (tenant_id, application_id)
    REFERENCES application (tenant_id, id),
  CONSTRAINT fk_acfr_tenant_field FOREIGN KEY (tenant_id, job_custom_field_id)
    REFERENCES job_custom_field (tenant_id, id),
  CONSTRAINT uq_acfr_application_field UNIQUE (application_id, job_custom_field_id)
);

CREATE INDEX idx_acfr_tenant_application ON application_custom_field_response (tenant_id, application_id);

GRANT SELECT, INSERT ON application_custom_field_response TO app_runtime;

ALTER TABLE application_custom_field_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_custom_field_response FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON application_custom_field_response
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON application_custom_field_response
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
