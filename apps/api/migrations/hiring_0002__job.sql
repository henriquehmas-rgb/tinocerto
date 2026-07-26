CREATE TABLE job (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  requisition_id  uuid NOT NULL,
  titulo          text NOT NULL,
  descricao       text NOT NULL DEFAULT '',
  seo_slug        text NOT NULL,
  publicado_em    timestamptz,
  canais          text[] NOT NULL DEFAULT '{}',
  criado_em       timestamptz NOT NULL DEFAULT now(),
  -- FK composta: requisition_id precisa pertencer ao MESMO tenant desta
  -- vaga -- FK simples permitiria uma vaga referenciar a requisição de
  -- outro tenant (mesma classe de gap fechada em psicologo_credencial na
  -- Fase 0).
  CONSTRAINT fk_job_tenant_requisition FOREIGN KEY (tenant_id, requisition_id)
    REFERENCES requisition (tenant_id, id)
);

ALTER TABLE job ADD CONSTRAINT uq_job_tenant_id UNIQUE (tenant_id, id);
-- seo_slug único POR TENANT, não globalmente.
CREATE UNIQUE INDEX idx_job_tenant_slug ON job (tenant_id, seo_slug);
CREATE INDEX idx_job_tenant_requisition ON job (tenant_id, requisition_id);

GRANT SELECT, INSERT, UPDATE ON job TO app_runtime;

ALTER TABLE job ENABLE ROW LEVEL SECURITY;
ALTER TABLE job FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON job
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON job
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
