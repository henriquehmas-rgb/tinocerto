--
-- data_hora é só um campo gravado manualmente nesta fase -- sem
-- integração de calendário (Google Calendar/MS Graph fica para uma fase
-- futura).
CREATE TABLE interview_schedule (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenant(id),
  application_id              uuid NOT NULL,
  interview_guide_version_id  uuid NOT NULL,
  data_hora                   timestamptz NOT NULL,
  status                      text NOT NULL DEFAULT 'agendada' CHECK (status IN ('agendada', 'realizada', 'cancelada')),
  criado_em                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_interview_schedule_tenant_application FOREIGN KEY (tenant_id, application_id)
    REFERENCES application (tenant_id, id),
  CONSTRAINT fk_interview_schedule_tenant_guide_version FOREIGN KEY (tenant_id, interview_guide_version_id)
    REFERENCES interview_guide_version (tenant_id, id)
);

ALTER TABLE interview_schedule ADD CONSTRAINT uq_interview_schedule_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_interview_schedule_tenant_application ON interview_schedule (tenant_id, application_id);

GRANT SELECT, INSERT, UPDATE ON interview_schedule TO app_runtime;

ALTER TABLE interview_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_schedule FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON interview_schedule
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON interview_schedule
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
