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

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant TO app_runtime;
