-- Retenção de 24h já fixada no doc 03 §2.7. expira_em é aplicado por
-- filtro na LEITURA (WHERE expira_em > now()) -- uma linha expirada some
-- estruturalmente do resultado, tratada como "nova"; a limpeza física das
-- linhas (DELETE em lote) fica documentada como job futuro, mesmo padrão
-- já aceito para retention_policy do domínio Trust (existe no schema
-- antes de ter um executor automatizado). Não é bug de corretude, é
-- dívida de armazenamento que cresce devagar.
CREATE TABLE idempotency_key (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  chave               text NOT NULL,
  hash_da_requisicao  text NOT NULL,
  resposta_snapshot   jsonb NOT NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  expira_em           timestamptz NOT NULL,
  CONSTRAINT uq_idempotency_key_tenant_chave UNIQUE (tenant_id, chave)
);

CREATE INDEX idx_idempotency_key_expira ON idempotency_key (expira_em);

GRANT SELECT, INSERT ON idempotency_key TO app_runtime;
-- store() usa ON CONFLICT DO UPDATE (upsert) -- precisa de UPDATE também,
-- restrito às colunas que de fato mudam numa reconciliação de corrida.
GRANT UPDATE (hash_da_requisicao, resposta_snapshot, expira_em, criado_em) ON idempotency_key TO app_runtime;

ALTER TABLE idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_key FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON idempotency_key
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON idempotency_key
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
