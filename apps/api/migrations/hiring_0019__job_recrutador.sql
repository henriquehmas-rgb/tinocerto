-- apps/api/migrations/hiring_0019__job_recrutador.sql
--
-- Relação N:N vaga<->recrutador (staff/user_account): quem pode ver/agir
-- sobre uma vaga além de admin_tenant/gestor_vaga. staff_id usa FK
-- composta (tenant_id, staff_id) -> user_account (tenant_id, id), no
-- mesmo padrão de fk_interview_evaluator_tenant_user em
-- interview_0005__interview_evaluator.sql, para impedir que um
-- staff_id de outro tenant seja gravado numa linha de job_recrutador --
-- a FK simples em user_account(id) sozinha não garante isolamento de
-- tenant. fk_job_recrutador_tenant_job garante o mesmo para job_id.
CREATE TABLE job_recrutador (
  job_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  staff_id uuid NOT NULL,
  atribuido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, staff_id),
  CONSTRAINT fk_job_recrutador_tenant_job FOREIGN KEY (job_id, tenant_id) REFERENCES job (id, tenant_id),
  CONSTRAINT fk_job_recrutador_tenant_staff FOREIGN KEY (tenant_id, staff_id) REFERENCES user_account (tenant_id, id)
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
