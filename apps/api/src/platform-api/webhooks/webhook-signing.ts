// apps/api/src/platform-api/webhooks/webhook-signing.ts
import { createHmac } from 'crypto';

export interface WebhookEnvelopeInput {
  eventId: string;
  eventType: string;
  occurredAt: string; // ISO 8601, já formatado pelo chamador
  sequence: number;
  tenantId: string;
  payload: Record<string, unknown>;
}

// Ordem de chave FIXA -- JSON.stringify preserva ordem de inserção de
// chave string, então chamar isto duas vezes com o mesmo input produz
// bytes IDÊNTICOS. É o que garante que toda retentativa da mesma entrega
// assina exatamente o mesmo corpo, mesmo reconstruído em momentos
// diferentes a partir de outbox_event (ver WebhookRetryScheduler, Task 6).
export function buildWebhookEnvelope(input: WebhookEnvelopeInput): string {
  return JSON.stringify({
    id: input.eventId,
    type: input.eventType,
    occurred_at: input.occurredAt,
    sequence: input.sequence,
    tenant_id: input.tenantId,
    data: input.payload,
  });
}

// Conteúdo assinado = `${id}.${timestamp}.${corpo_bruto}` -- id é o id do
// EVENTO (campo "id" do envelope, ecoado em X-Webhook-Id), NUNCA
// webhook_delivery.id/webhook_endpoint.id -- ver design spec decisão 2,
// leitura literal de 04-api-e-webhooks.md §4. Uma assinatura "v1,<base64>"
// por segredo em `secrets` (ordem: segredo_atual primeiro, depois cada
// segredo_historico) -- múltiplas assinaturas no MESMO header, separadas
// por espaço, é o mecanismo Svix de rotação sem downtime: o receptor
// aceita se qualquer uma bater.
export function signWebhookBody(secrets: string[], eventId: string, timestampUnixSeconds: number, rawBody: string): string {
  const signedContent = `${eventId}.${timestampUnixSeconds}.${rawBody}`;
  return secrets
    .map((secret) => `v1,${createHmac('sha256', secret).update(signedContent).digest('base64')}`)
    .join(' ');
}
