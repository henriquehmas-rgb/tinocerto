CREATE TABLE outbox_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  aggregate_type  text NOT NULL,
  aggregate_id    uuid NOT NULL,
  event_type      text NOT NULL,
  sequence        bigint NOT NULL,
  payload         jsonb NOT NULL,
  occurred_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  UNIQUE (tenant_id, aggregate_id, sequence)
);

CREATE INDEX idx_outbox_tenant_pending ON outbox_event (tenant_id, published_at) WHERE published_at IS NULL;

-- outbox_event é um log de eventos append-only: só published_at pode ser
-- atualizado (quando o publisher marca o evento como publicado). GRANT
-- column-wide de UPDATE permitiria reescrever payload/event_type/etc. de
-- eventos já gravados, o que contradiz a semântica de log (ver mesmo
-- padrão em identity_0002__tenant.sql, Task 5).
GRANT SELECT, INSERT ON outbox_event TO app_runtime;
GRANT UPDATE (published_at) ON outbox_event TO app_runtime;

ALTER TABLE outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_event FORCE  ROW LEVEL SECURITY;

-- Base PERMISSIVE obrigatória — sem ela, a RESTRICTIVE abaixo nega tudo
-- (ver comentário equivalente na migration de user_account, Task 5).
CREATE POLICY allow_all_base ON outbox_event
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON outbox_event
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
