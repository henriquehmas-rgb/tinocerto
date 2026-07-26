CREATE TABLE audit_log_entry (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  actor_id       uuid,
  actor_type     text NOT NULL,
  on_behalf_of   uuid,
  action         text NOT NULL,
  resource_type  text NOT NULL,
  resource_id    uuid,
  fields_read    text[],
  ip             inet,
  user_agent     text,
  request_id     text,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  prev_hash      text,
  hash           text NOT NULL
);

CREATE INDEX idx_audit_log_tenant_occurred ON audit_log_entry (tenant_id, occurred_at);

GRANT SELECT, INSERT ON audit_log_entry TO app_runtime;

ALTER TABLE audit_log_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_entry FORCE  ROW LEVEL SECURITY;

-- Base PERMISSIVE obrigatória — sem ela, a RESTRICTIVE abaixo nega tudo
-- (ver comentário equivalente na migration de user_account, Task 5).
CREATE POLICY allow_all_base ON audit_log_entry
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON audit_log_entry
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Append-only de verdade: revoga UPDATE/DELETE mesmo do app_runtime.
REVOKE UPDATE, DELETE ON audit_log_entry FROM app_runtime;
