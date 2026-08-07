// apps/api/src/platform-api/webhooks/webhook-delivery.service.ts
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildWebhookEnvelope, signWebhookBody } from './webhook-signing';
import { decryptWebhookSecret, EncryptedSecret } from './webhook-secret-cipher';
import { MAX_ATTEMPTS, RETRY_SCHEDULE_MS } from './webhook-retry-schedule';

export interface WebhookEndpointForDelivery {
  id: string;
  url: string;
  segredoAtualCifrado: EncryptedSecret;
  segredosHistoricoCifrados: EncryptedSecret[];
}

export interface OutboxEventForDelivery {
  id: string;
  eventType: string;
  sequence: number;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export interface AttemptDeliveryInput {
  tenantId: string;
  webhookEndpoint: WebhookEndpointForDelivery;
  event: OutboxEventForDelivery;
  tentativaNum: number;
  // false só no reenvio manual (Task 8) -- não reabre o cronograma
  // automático se esta tentativa avulsa também falhar.
  agendarProximaTentativa?: boolean;
}

@Injectable()
export class WebhookDeliveryService {
  async attemptDelivery(client: PoolClient, input: AttemptDeliveryInput): Promise<{ sucesso: boolean; statusHttp: number | null }> {
    const rawBody = buildWebhookEnvelope({
      eventId: input.event.id,
      eventType: input.event.eventType,
      occurredAt: input.event.occurredAt.toISOString(),
      sequence: input.event.sequence,
      tenantId: input.tenantId,
      payload: input.event.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const secrets = [input.webhookEndpoint.segredoAtualCifrado, ...input.webhookEndpoint.segredosHistoricoCifrados].map(decryptWebhookSecret);
    const assinatura = signWebhookBody(secrets, input.event.id, timestamp, rawBody);

    const startedAt = Date.now();
    let statusHttp: number | null = null;
    try {
      const response = await fetch(input.webhookEndpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-id': input.event.id,
          'x-webhook-timestamp': String(timestamp),
          'x-signature': assinatura,
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      });
      statusHttp = response.status;
    } catch {
      // Falha de rede/timeout -- sem resposta HTTP nenhuma. Não relança:
      // falha de entrega é resultado esperado e registrável, não exceção.
      statusHttp = null;
    }
    const latenciaMs = Date.now() - startedAt;
    const sucesso = statusHttp !== null && statusHttp >= 200 && statusHttp < 300;

    const podeReagendar = (input.agendarProximaTentativa ?? true) && !sucesso && input.tentativaNum < MAX_ATTEMPTS;
    const proximaTentativaEm = podeReagendar ? new Date(Date.now() + RETRY_SCHEDULE_MS[input.tentativaNum - 1]) : null;

    await client.query(
      `INSERT INTO webhook_delivery
         (tenant_id, webhook_endpoint_id, event_id, tentativa_num, corpo_enviado, assinatura_enviada, status_http, latencia_ms, enviado_em, proxima_tentativa_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)
       ON CONFLICT (webhook_endpoint_id, event_id, tentativa_num) DO NOTHING`,
      [input.tenantId, input.webhookEndpoint.id, input.event.id, input.tentativaNum, rawBody, assinatura, statusHttp, latenciaMs, proximaTentativaEm],
    );

    // COALESCE na escrita: só a PRIMEIRA falha desde o último sucesso seta
    // o marcador (design spec decisão 11) -- falhas subsequentes não
    // empurram a janela de 5 dias pra frente.
    await client.query(
      sucesso
        ? `UPDATE webhook_endpoint SET primeira_falha_desde_ultimo_sucesso_em = NULL WHERE id = $1`
        : `UPDATE webhook_endpoint SET primeira_falha_desde_ultimo_sucesso_em = COALESCE(primeira_falha_desde_ultimo_sucesso_em, now()) WHERE id = $1`,
      [input.webhookEndpoint.id],
    );

    return { sucesso, statusHttp };
  }
}
