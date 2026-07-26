-- application_custom_field_response.uq_acfr_application_field (criada em
-- hiring_0009__application_custom_field_response.sql) era UNIQUE
-- (application_id, job_custom_field_id) -- sem tenant_id como coluna
-- líder, violando a convenção da Fase 1a de que todo índice numa tabela
-- com tenant_id o tem como coluna líder (exceto a PK uuid). Não é uma
-- vulnerabilidade cross-tenant exploravel -- application_id já está
-- vinculado a exatamente um tenant pela FK composta
-- fk_acfr_tenant_application (tenant_id, application_id) REFERENCES
-- application (tenant_id, id) -- mas é drift de convenção e um formato
-- de índice sub-ótimo para consultas/escritas com filtro por tenant.
--
-- Troca a UNIQUE simples pela composta com tenant_id líder, mantendo a
-- mesma semântica de negócio (uma resposta por candidatura+campo).
ALTER TABLE application_custom_field_response DROP CONSTRAINT uq_acfr_application_field;

ALTER TABLE application_custom_field_response ADD CONSTRAINT uq_acfr_tenant_application_field
  UNIQUE (tenant_id, application_id, job_custom_field_id);
