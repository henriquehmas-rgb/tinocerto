-- apps/api/migrations/hiring_0019__job_recrutador.sql
--
-- Relação N:N vaga<->recrutador (staff/user_account): quem pode ver/agir
-- sobre uma vaga além de admin_tenant/gestor_vaga. staff_id referencia
-- user_account(id) direto (não composto com tenant_id) porque a tabela
-- não tem coluna própria de tenant_id redundante além da já modelada --
-- a FK composta fk_job_recrutador_tenant_job garante que job_id pertence
-- ao mesmo tenant_id desta linha, e user_account(id) já é PK global
-- única o suficiente para a integridade referencial pretendida aqui.
CREATE TABLE job_recrutador (
  job_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  staff_id uuid NOT NULL REFERENCES user_account(id),
  atribuido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, staff_id),
  CONSTRAINT fk_job_recrutador_tenant_job FOREIGN KEY (job_id, tenant_id) REFERENCES job (id, tenant_id)
);

CREATE INDEX idx_job_recrutador_tenant_staff ON job_recrutador (tenant_id, staff_id);

GRANT SELECT, INSERT, DELETE ON job_recrutador TO app_runtime;

ALTER TABLE job_recrutador ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_recrutador FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON job_recrutador
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON job_recrutador
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
