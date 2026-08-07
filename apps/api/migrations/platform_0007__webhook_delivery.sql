-- apps/api/migrations/platform_0007__webhook_delivery.sql
--
-- Append-only: uma linha por TENTATIVA (nunca UPDATE) -- painel de entrega
-- precisa do histórico completo, não só da tentativa mais recente.
CREATE TABLE webhook_delivery (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  webhook_endpoint_id   uuid NOT NULL,
  event_id              uuid NOT NULL,
  -- Sem CHECK de teto em 8: o cronograma automático nunca ultrapassa isso
  -- (MAX_ATTEMPTS aplicado em código), mas reenvio MANUAL (Task 8) precisa
  -- poder continuar gerando tentativa_num > 8 depois do cronograma
  -- automático se esgotar -- um CHECK travando em 8 faria todo reenvio
  -- manual pós-esgotamento colidir com UNIQUE(webhook_endpoint_id, event_id,
  -- tentativa_num) e ser silenciosamente descartado pelo ON CONFLICT DO
  -- NOTHING do INSERT, sem nenhum erro visível.
  tentativa_num         int NOT NULL CHECK (tentativa_num >= 1),
  -- Corpo exato enviado -- idêntico entre tentativas da mesma entrega
  -- (reconstruído deterministicamente de outbox_event a cada tentativa),
  -- registrado aqui como fato histórico para o painel não depender de JOIN.
  corpo_enviado         jsonb NOT NULL,
  -- Valor exato de X-Signature ENVIADO nesta tentativa -- não recalculado
  -- na leitura (um segredo rotacionado depois da tentativa produziria um
  -- valor diferente do que foi de fato transmitido).
  assinatura_enviada    text NOT NULL,
  -- NULL = falha de rede/timeout, sem resposta HTTP nenhuma.
  status_http           int,
  latencia_ms           int,
  enviado_em            timestamptz NOT NULL DEFAULT now(),
  -- NULL = terminal (sucesso, ou tentativa 8 esgotada). Alvo de poll do
  -- WebhookRetryScheduler.
  proxima_tentativa_em  timestamptz,
  CONSTRAINT fk_webhook_delivery_tenant_endpoint FOREIGN KEY (tenant_id, webhook_endpoint_id)
    REFERENCES webhook_endpoint (tenant_id, id),
  CONSTRAINT fk_webhook_delivery_tenant_event FOREIGN KEY (tenant_id, event_id)
    REFERENCES outbox_event (tenant_id, id),
  CONSTRAINT uq_webhook_delivery_tentativa UNIQUE (webhook_endpoint_id, event_id, tentativa_num)
);

CREATE INDEX idx_webhook_delivery_tenant_endpoint_event ON webhook_delivery (tenant_id, webhook_endpoint_id, event_id);
-- Índice parcial -- só linhas com retentativa pendente interessam ao
-- scheduler, mesma técnica de idx_outbox_tenant_pending/idx_idempotency_key_expira.
CREATE INDEX idx_webhook_delivery_proxima_tentativa ON webhook_delivery (proxima_tentativa_em) WHERE proxima_tentativa_em IS NOT NULL;

-- Só SELECT/INSERT -- tabela verdadeiramente append-only, nenhuma linha já
-- gravada é atualizada depois.
GRANT SELECT, INSERT ON webhook_delivery TO app_runtime;

ALTER TABLE webhook_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON webhook_delivery
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON webhook_delivery
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
