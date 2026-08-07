-- apps/api/migrations/platform_0006__webhook_endpoint.sql
CREATE TABLE webhook_endpoint (
  id                                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                              uuid NOT NULL REFERENCES tenant(id),
  url                                    text NOT NULL,
  eventos_filtro                         text[] NOT NULL DEFAULT '{}',
  -- Cifrado (AES-256-GCM), nunca texto plano nem hash -- diferente de
  -- api_key (Fase 4a): o remetente precisa recuperar o valor em claro a
  -- cada entrega, para sempre, então hash está descartado por construção.
  segredo_atual_cifrado                  jsonb NOT NULL,
  segredos_historico_cifrados            jsonb[] NOT NULL DEFAULT '{}',
  ativo                                  boolean NOT NULL DEFAULT true,
  -- NULL = sem falha em aberto. Setado na PRIMEIRA falha após um sucesso
  -- (COALESCE na escrita, ver WebhookDeliveryService), nunca sobrescrito
  -- por falhas subsequentes -- WebhookEndpointDisableScheduler soma 5 dias
  -- a partir daqui.
  primeira_falha_desde_ultimo_sucesso_em timestamptz,
  criado_em                              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webhook_endpoint ADD CONSTRAINT uq_webhook_endpoint_tenant_id UNIQUE (tenant_id, id);
CREATE INDEX idx_webhook_endpoint_tenant_ativo ON webhook_endpoint (tenant_id, ativo);

-- HTTPS obrigatório é validado no DTO do controller (@Matches), NÃO aqui
-- via CHECK -- WebhookEndpointService.create é chamado DIRETO pelos testes
-- de entrega (Tasks 5/6/8/9), que registram um servidor HTTP local
-- (http://127.0.0.1:porta) como destino para capturar a requisição real
-- sem a complexidade de TLS efêmero em teste. Um CHECK de banco bloquearia
-- essa técnica de teste inteira (inclusive o gate com openssl). Produção
-- nunca chama o service fora do controller, então o DTO já é a fronteira
-- de enforcement real -- mesmo ponto de validação de toda regra de formato
-- já usada no projeto (nunca CHECK de negócio em migration).

GRANT SELECT, INSERT ON webhook_endpoint TO app_runtime;
GRANT UPDATE (url, eventos_filtro, segredo_atual_cifrado, segredos_historico_cifrados, ativo, primeira_falha_desde_ultimo_sucesso_em)
  ON webhook_endpoint TO app_runtime;

ALTER TABLE webhook_endpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoint FORCE  ROW LEVEL SECURITY;

CREATE POLICY allow_all_base ON webhook_endpoint
  AS PERMISSIVE FOR ALL TO app_runtime
  USING (true)
  WITH CHECK (true);

CREATE POLICY tenant_isolation ON webhook_endpoint
  AS RESTRICTIVE FOR ALL TO app_runtime
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
