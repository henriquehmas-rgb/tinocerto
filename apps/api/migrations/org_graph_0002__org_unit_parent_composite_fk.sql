-- org_unit.parent_id (auto-referência de hierarquia, criada em
-- org_graph_0001__org_unit.sql, Fase 0 -- predata a Fase 1a inteira)
-- ainda usava FK simples para org_unit(id): a mesma classe de bug
-- fechada em psicologo_credencial (revisão final da Fase 0) e, na
-- Task 7, entre requisition e org_unit. FK simples permite que um
-- org_unit aponte parent_id para a linha de OUTRO tenant, porque a
-- checagem de FK do Postgres verifica apenas existência da linha --
-- não passa pela RLS. UNIQUE(tenant_id, id) já existe desde
-- hiring_0001__requisition.sql; aqui trocamos a FK simples pela
-- composta na própria auto-referência de org_unit, fechando a lacuna
-- antes que ela vire um vazamento real (relatórios, tooling admin,
-- workers em background ou qualquer leitura com privilégio elevado
-- que passe por cima da RLS).
ALTER TABLE org_unit DROP CONSTRAINT org_unit_parent_id_fkey;

ALTER TABLE org_unit ADD CONSTRAINT fk_org_unit_tenant_parent
  FOREIGN KEY (tenant_id, parent_id) REFERENCES org_unit (tenant_id, id);

-- Índice de suporte para a FK composta e para travessia de hierarquia
-- por parent_id, no mesmo padrão usado em idx_requisition_tenant_org_unit
-- (Task 7): tenant_id sempre como coluna líder.
CREATE INDEX idx_org_unit_tenant_parent ON org_unit (tenant_id, parent_id);
