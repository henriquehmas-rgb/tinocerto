DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime_dev_only';
  END IF;
END
$$;

-- Reforçado INCONDICIONALMENTE — nunca depende de a role ter acabado de
-- ser criada. Se a role já existisse (provisionada manualmente, por um
-- DBA, ou por uma execução anterior com atributos diferentes), esta linha
-- garante que NOSUPERUSER/NOBYPASSRLS valem de qualquer forma.
ALTER ROLE app_runtime NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;

GRANT CONNECT ON DATABASE tinocerto TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
-- Deliberadamente SEM ALTER DEFAULT PRIVILEGES: cada tabela concede seu
-- próprio GRANT explícito, na própria migration que a cria. Um GRANT
-- automático em toda tabela futura tornaria "esqueci de habilitar RLS"
-- um vazamento silencioso em vez de um erro imediato e óbvio.

-- Revoga explicitamente qualquer ALTER DEFAULT PRIVILEGES residual de uma
-- versão anterior desta migration (idempotente — não faz nada se não
-- houver nenhum default privilege concedido).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM app_runtime;
