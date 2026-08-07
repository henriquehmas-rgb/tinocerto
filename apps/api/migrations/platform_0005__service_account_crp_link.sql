-- apps/api/migrations/platform_0005__service_account_crp_link.sql
--
-- Empresta a credencial JA REGISTRADA de um humano -- nunca cria uma nova
-- verificação paralela para o service account (design spec, decisão 4/12).
-- fk_sacl_user_credencial é o que torna isso estrutural: só se pode
-- vincular um user_id que já tem linha em psicologo_credencial (mesmo que
-- crp_ativo ainda seja false -- registrado, não necessariamente verificado).
CREATE TABLE service_account_crp_link (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  service_account_id  uuid NOT NULL,
  user_id             uuid NOT NULL,
  vinculado_em        timestamptz NOT NULL DEFAULT now(),
  vinculado_por       uuid NOT NULL REFERENCES user_account(id),
  CONSTRAINT fk_sacl_tenant_service_account FOREIGN KEY (tenant_id, service_account_id)
    REFERENCES service_account (tenant_id, id),
  CONSTRAINT fk_sacl_tenant_user FOREIGN KEY (tenant_id, user_id)
    REFERENCES user_account (tenant_id, id),
  CONSTRAINT fk_sacl_user_credencial FOREIGN KEY (user_id) REFERENCES psicologo_credencial (user_id),
  -- Um service account empresta no máximo UM CRP humano por vez.
  CONSTRAINT uq_sacl_service_account UNIQUE (service_account_id)
);

CREATE INDEX idx_sacl_tenant_service_account ON service_account_crp_link (tenant_id, service_account_id);

GRANT SELECT, INSERT, DELETE ON service_account_crp_link TO app_runtime;

ALTER TABLE service_account_crp_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_account_crp_link FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON service_account_crp_link
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON service_account_crp_link
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
