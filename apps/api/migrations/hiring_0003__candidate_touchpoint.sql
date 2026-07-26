-- APPEND-ONLY de verdade -- REVOKE de UPDATE/DELETE mesmo do app_runtime,
-- mesmo padrao ja usado em audit_log_entry (Fase 0, Task 13). person_id
-- referencia a tabela GLOBAL person (Task 3) -- FK simples de proposito
-- (person nao tem tenant_id, entao FK composta nao se aplica aqui, igual
-- ao caso de consent_id em result_grant, Task 4).
CREATE TABLE candidate_touchpoint (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  person_id    uuid NOT NULL REFERENCES person(id),
  canal        text NOT NULL,
  campanha     text,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE candidate_touchpoint ADD CONSTRAINT uq_candidate_touchpoint_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_candidate_touchpoint_tenant_person ON candidate_touchpoint (tenant_id, person_id);

GRANT SELECT, INSERT ON candidate_touchpoint TO app_runtime;

ALTER TABLE candidate_touchpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_touchpoint FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON candidate_touchpoint
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON candidate_touchpoint
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Append-only de verdade: revoga UPDATE/DELETE mesmo do app_runtime.
REVOKE UPDATE, DELETE ON candidate_touchpoint FROM app_runtime;
