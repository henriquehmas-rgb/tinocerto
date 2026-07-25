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
--
-- NOTA: FORCE ROW LEVEL SECURITY nega acesso até para o dono da tabela,
-- exceto quando a conexão é literalmente um superuser do Postgres (que
-- sempre bypassa RLS, FORCE ou não). Os testes e o provisionamento de
-- tenant nesta fase dependem de DATABASE_URL conectar como superuser por
-- esse motivo. Se o role dono do banco for endurecido para não-superuser
-- no futuro, será preciso uma policy explícita de admin ou uma role de
-- provisionamento com BYPASSRLS dedicada — decisão a tomar nesse momento,
-- não antes.
--
-- GRANT column-wide de UPDATE incluiria plano e status, que são operação
-- administrativa (mudança de plano/status), fora de escopo da Fase 0 —
-- por isso o UPDATE é restrito às colunas que o app_runtime pode de fato
-- editar por conta própria.
GRANT SELECT ON tenant TO app_runtime;
GRANT UPDATE (razao_social, timezone, moeda) ON tenant TO app_runtime;

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
