CREATE TABLE interview_evaluator (
  tenant_id              uuid NOT NULL REFERENCES tenant(id),
  interview_schedule_id  uuid NOT NULL,
  user_id                uuid NOT NULL,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, interview_schedule_id, user_id),
  CONSTRAINT fk_interview_evaluator_tenant_schedule FOREIGN KEY (tenant_id, interview_schedule_id)
    REFERENCES interview_schedule (tenant_id, id),
  CONSTRAINT fk_interview_evaluator_tenant_user FOREIGN KEY (tenant_id, user_id)
    REFERENCES user_account (tenant_id, id)
);

GRANT SELECT, INSERT, DELETE ON interview_evaluator TO app_runtime;

ALTER TABLE interview_evaluator ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_evaluator FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON interview_evaluator
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON interview_evaluator
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
