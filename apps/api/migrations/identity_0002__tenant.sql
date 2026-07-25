CREATE TABLE tenant (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social  text NOT NULL,
  cnpj          text NOT NULL UNIQUE,
  plano         text NOT NULL DEFAULT 'entrada',
  timezone      text NOT NULL DEFAULT 'America/Sao_Paulo',
  moeda         text NOT NULL DEFAULT 'BRL',
  status        text NOT NULL DEFAULT 'ativo',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- app_runtime só lê e atualiza o próprio tenant — nunca cria nem apaga.
-- Provisionar tenant novo é operação administrativa (conecta como o role
-- dono do banco, que é superuser nesta fase de dev — bypassa RLS
-- independente de FORCE), fora do papel de runtime da aplicação.
GRANT SELECT, UPDATE ON tenant TO app_runtime;

-- RLS aqui NÃO é circular: a política só compara a própria coluna `id`
-- ao app.tenant_id da sessão, sem referenciar nenhuma outra tabela.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON tenant
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON tenant
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);
