CREATE TABLE lia_document (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  job_custom_field_id uuid NOT NULL,
  finalidade          text NOT NULL,
  teste_necessidade   text NOT NULL,
  teste_proporcionalidade text NOT NULL,
  salvaguardas        text NOT NULL,
  gerado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_lia_tenant_field FOREIGN KEY (tenant_id, job_custom_field_id)
    REFERENCES job_custom_field (tenant_id, id),
  CONSTRAINT uq_lia_tenant_field UNIQUE (tenant_id, job_custom_field_id)
);

GRANT SELECT, INSERT ON lia_document TO app_runtime;

ALTER TABLE lia_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE lia_document FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON lia_document
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON lia_document
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
