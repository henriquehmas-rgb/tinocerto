-- Tabela de LEITURA (03-arquitetura-e-modelo-de-dados.md §2.8), nunca de
-- escrita primária -- populada só pelo consumidor de outbox (Task 5) via
-- upsert incremental. PK composta é o alvo do ON CONFLICT do upsert.
CREATE TABLE adverse_impact_snapshot (
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  job_id            uuid NOT NULL,
  etapa             text NOT NULL,
  grupo_demografico text NOT NULL,
  taxa_selecao      numeric(6,4) NOT NULL,
  razao_4_5         numeric(6,4) NOT NULL,
  calculado_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id, etapa, grupo_demografico),
  CONSTRAINT fk_adverse_impact_snapshot_tenant_job FOREIGN KEY (tenant_id, job_id)
    REFERENCES job (tenant_id, id)
);

GRANT SELECT, INSERT, UPDATE ON adverse_impact_snapshot TO app_runtime;

ALTER TABLE adverse_impact_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE adverse_impact_snapshot FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON adverse_impact_snapshot
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON adverse_impact_snapshot
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
