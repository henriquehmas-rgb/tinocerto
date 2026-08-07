-- apps/api/migrations/interview_0007__google_calendar_connection.sql
--
-- Conexão OAuth do Google Calendar é POR USUÁRIO, não por tenant (spec
-- 2026-08-07-fase-3b-agendamento-design.md, decisão 4): cada user_account
-- que quiser que o próprio calendário organize convites de entrevista
-- conecta uma vez. PRIMARY KEY composta (tenant_id, user_id) em vez de um
-- id uuid separado -- é uma relação 1:1 por natureza (um usuário tem no
-- máximo uma conexão Google ativa nesta fase), mesmo estilo de tabela de
-- junção já usado em interview_evaluator.
--
-- refresh_token_encriptado usa o MESMO EnvelopeEncryptionService já em
-- produção para person.cpf_encriptado (src/talent/envelope-encryption.
-- service.ts, decisão 5 da spec) -- reaproveita a KEK mestra existente
-- (ENVELOPE_ENCRYPTION_KEK), nenhum esquema de cifra novo.
--
-- Nome da tabela é GOOGLE_calendar_connection, não calendar_connection
-- genérico, e sem coluna "provider": esta fase suporta só Google Calendar
-- (decisão 1 -- MS Graph fica para fase futura). Uma coluna "provider"
-- especulativa hoje seria desenho para um segundo provedor que ainda nem
-- está decidido (decisão 11 da spec).
CREATE TABLE google_calendar_connection (
  tenant_id                uuid NOT NULL REFERENCES tenant(id),
  user_id                  uuid NOT NULL,
  google_email             text NOT NULL,
  refresh_token_encriptado jsonb NOT NULL,
  conectado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT fk_google_calendar_connection_tenant_user FOREIGN KEY (tenant_id, user_id)
    REFERENCES user_account (tenant_id, id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON google_calendar_connection TO app_runtime;

ALTER TABLE google_calendar_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_connection FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON google_calendar_connection
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON google_calendar_connection
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
