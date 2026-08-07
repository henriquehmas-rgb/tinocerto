-- apps/api/migrations/interview_0008__interview_schedule_calendar_event.sql
--
-- Resultado (best-effort) da tentativa de criar um evento no Google
-- Calendar para um interview_schedule. Tabela DEDICADA, não colunas em
-- interview_schedule -- mesmo racional já documentado em
-- llm_router_0001__llm_call_log.sql (Fase 3a): a maioria dos
-- interview_schedule pode nunca ter uma tentativa de calendário
-- (organizador sem conexão), então colunas aqui ficariam NULL na maior
-- parte das linhas do domínio central de Interview (decisão 10 da spec).
-- UNIQUE(tenant_id, interview_schedule_id): uma linha por schedule --
-- representa o resultado da ÚNICA tentativa síncrona feita na criação,
-- não uma fila de retentativa (fora de escopo desta fase).
CREATE TABLE interview_schedule_calendar_event (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenant(id),
  interview_schedule_id  uuid NOT NULL,
  organizador_user_id    uuid NOT NULL,
  status                 text NOT NULL CHECK (status IN ('criado', 'falha', 'sem_conexao')),
  google_event_id        text,
  google_meet_link       text,
  erro                   text,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_isce_tenant_schedule FOREIGN KEY (tenant_id, interview_schedule_id)
    REFERENCES interview_schedule (tenant_id, id),
  CONSTRAINT uq_isce_tenant_schedule UNIQUE (tenant_id, interview_schedule_id)
);

CREATE INDEX idx_isce_tenant_status ON interview_schedule_calendar_event (tenant_id, status);

GRANT SELECT, INSERT, UPDATE ON interview_schedule_calendar_event TO app_runtime;

ALTER TABLE interview_schedule_calendar_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_schedule_calendar_event FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON interview_schedule_calendar_event
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON interview_schedule_calendar_event
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
