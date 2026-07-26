-- Append-only: base do pass-through rate (03-arquitetura-e-modelo-de-
-- dados.md §2.4). REVOKE de UPDATE/DELETE mesmo do app_runtime.
CREATE TABLE pipeline_stage_transition (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  from_state    text,
  to_state      text NOT NULL,
  reason_code   text,
  actor_id      uuid NOT NULL,
  actor_type    text NOT NULL,
  on_behalf_of  uuid,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_pipeline_stage_transition_tenant_application FOREIGN KEY (tenant_id, application_id)
    REFERENCES application (tenant_id, id)
);

CREATE INDEX idx_pipeline_stage_transition_tenant_app ON pipeline_stage_transition (tenant_id, application_id);

GRANT SELECT, INSERT ON pipeline_stage_transition TO app_runtime;

ALTER TABLE pipeline_stage_transition ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stage_transition FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON pipeline_stage_transition
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON pipeline_stage_transition
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Append-only de verdade.
REVOKE UPDATE, DELETE ON pipeline_stage_transition FROM app_runtime;
