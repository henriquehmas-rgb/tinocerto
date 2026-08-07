-- DESVIO DO PLANO (encontrado ao rodar `pnpm run migrate` -- ver Task 1,
-- Step 1 do plano de execução): service_account (identity_0006) foi criada
-- só com PRIMARY KEY (id), sem UNIQUE (tenant_id, id) -- na época
-- (identity_0006) não havia nenhuma tabela filha referenciando
-- service_account por FK composta ainda. api_key é a primeira. Mesma
-- classe de gap já fechada para org_unit em hiring_0001__requisition.sql
-- (comentário idêntico lá: "FK simples permite referenciar org_unit de
-- OUTRO tenant -- RLS não entra nessa checagem"). Fechamos aqui, no mesmo
-- padrão, antes de criar a FK composta que depende dela.
ALTER TABLE service_account ADD CONSTRAINT uq_service_account_tenant_id UNIQUE (tenant_id, id);

-- tenant_id é uma denormalização deliberada em relação ao schema
-- minimalista do doc 03 §2.7 (que lista só service_account_id) -- toda
-- tabela nova do projeto com relação a um tenant carrega tenant_id local
-- porque RLS não atravessa JOIN implícito. FK composta contra
-- service_account garante que o tenant_id aqui NUNCA diverge do tenant
-- dono do service_account referenciado.
CREATE TABLE api_key (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  service_account_id  uuid NOT NULL,
  prefixo             text NOT NULL UNIQUE,
  hash                text NOT NULL,
  escopos             text[] NOT NULL DEFAULT '{}',
  criado_em           timestamptz NOT NULL DEFAULT now(),
  revogado_em         timestamptz,
  CONSTRAINT fk_api_key_tenant_service_account FOREIGN KEY (tenant_id, service_account_id)
    REFERENCES service_account (tenant_id, id)
);

ALTER TABLE api_key ADD CONSTRAINT uq_api_key_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_api_key_tenant_service_account ON api_key (tenant_id, service_account_id);

-- revogado_em é a única coluna que app_runtime pode atualizar depois de
-- emitida -- prefixo/hash/escopos são imutáveis pós-emissão (rotação =
-- revogar + emitir de novo, nunca UPDATE de hash).
GRANT SELECT, INSERT ON api_key TO app_runtime;
GRANT UPDATE (revogado_em) ON api_key TO app_runtime;

ALTER TABLE api_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON api_key
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON api_key
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Bootstrap: autenticar por chave de API precisa resolver tenant_id ANTES
-- de app.tenant_id existir na sessão -- mesma armadilha circular já
-- resolvida por resolve_tenant_id_by_slug (public_0002) e
-- list_all_tenant_ids (resume_0004). Function SECURITY DEFINER estreita:
-- devolve só as 6 colunas do handshake de autenticação, nunca a linha
-- inteira nem nenhuma outra tabela.
CREATE FUNCTION resolve_api_key_by_prefix(p_prefixo text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  service_account_id uuid,
  hash text,
  escopos text[],
  revogado_em timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id, tenant_id, service_account_id, hash, escopos, revogado_em
  FROM api_key WHERE prefixo = p_prefixo;
$$;

REVOKE ALL ON FUNCTION resolve_api_key_by_prefix(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_api_key_by_prefix(text) TO app_runtime;
