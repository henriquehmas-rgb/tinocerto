-- GET /v1/applications pagina por cursor com predicado de keyset
-- (criado_em, id) > (cursor.sortValue, cursor.id) ORDER BY criado_em, id.
-- Sem este índice composto, o plano recorreria a sort completo da tabela
-- por tenant a cada página -- o SLO de p95 < 300ms de GET /v1/* (doc 03
-- §6) depende de um index scan aqui, não de um sequential scan + sort.
CREATE INDEX idx_application_tenant_criado_id ON application (tenant_id, criado_em, id);
