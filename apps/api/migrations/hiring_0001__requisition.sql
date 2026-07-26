-- org_unit (Fase 0, Task 6) foi criada só com PRIMARY KEY (id), sem
-- UNIQUE(tenant_id, id) -- na época não havia nenhuma tabela filha
-- referenciando org_unit por FK ainda. requisition é a primeira, e uma FK
-- simples aqui repetiria exatamente a classe de bug fechada em
-- psicologo_credencial na revisão final da Fase 0 (FK simples permite
-- referenciar org_unit de OUTRO tenant; a checagem de FK do Postgres só
-- verifica existência da linha, não verifica tenant -- RLS não entra
-- nessa checagem). Fechamos a lacuna agora, antes dela existir em
-- produção, em vez de depois.
ALTER TABLE org_unit ADD CONSTRAINT uq_org_unit_tenant_id UNIQUE (tenant_id, id);

CREATE TABLE requisition (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  org_unit_id  uuid NOT NULL,
  titulo       text NOT NULL,
  status       text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'aprovada', 'fechada')),
  opened_at    timestamptz NOT NULL DEFAULT now(),
  approved_at  timestamptz,
  closed_at    timestamptz,
  CONSTRAINT fk_requisition_tenant_org_unit FOREIGN KEY (tenant_id, org_unit_id)
    REFERENCES org_unit (tenant_id, id)
);

-- UNIQUE(tenant_id, id) habilita FK composta de tabelas filhas (job) --
-- mesmo padrão de user_account (Fase 0, Task 5).
ALTER TABLE requisition ADD CONSTRAINT uq_requisition_tenant_id UNIQUE (tenant_id, id);

CREATE INDEX idx_requisition_tenant_status ON requisition (tenant_id, status);
CREATE INDEX idx_requisition_tenant_org_unit ON requisition (tenant_id, org_unit_id);

GRANT SELECT, INSERT, UPDATE ON requisition TO app_runtime;

ALTER TABLE requisition ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisition FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON requisition
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON requisition
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
