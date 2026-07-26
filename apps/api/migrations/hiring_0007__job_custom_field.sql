CREATE TABLE job_custom_field (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  job_id             uuid NOT NULL,
  label              text NOT NULL,
  tipo_campo         text NOT NULL DEFAULT 'texto_livre',
  fase_coleta        text NOT NULL DEFAULT 'inscricao' CHECK (fase_coleta IN ('inscricao', 'admissao')),
  categoria_bloqueada text, -- populada pela Task 14 (bloqueio duro antidiscriminação)
  base_legal         text,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_job_custom_field_tenant_job FOREIGN KEY (tenant_id, job_id)
    REFERENCES job (tenant_id, id)
);

CREATE INDEX idx_job_custom_field_tenant_job ON job_custom_field (tenant_id, job_id);

GRANT SELECT, INSERT, UPDATE ON job_custom_field TO app_runtime;

ALTER TABLE job_custom_field ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_custom_field FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON job_custom_field
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON job_custom_field
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
