// apps/api/src/platform-api/webhooks/webhook-delivery.controller.ts
import { Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Request } from 'express';
import { TenantContext } from '../../database/tenant-context';
import { DatabaseService } from '../../database/database.service';
import { CerbosGuard } from '../../authz/cerbos.guard';
import { CerbosCheck } from '../../authz/cerbos-check.decorator';
import { decodeCursor, encodeCursor } from '../cursor-pagination';
import { EncryptedSecret } from './webhook-secret-cipher';
import { WebhookDeliveryService } from './webhook-delivery.service';

interface RequestWithAuthContext extends Request {
  tenantId: string;
  userId: string;
  userRoles: string[];
}

class ListDeliveriesQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  @IsOptional()
  @IsString()
  cursor?: string;
}

// Mesmo prefixo de WebhookEndpointController (Task 4), classe distinta --
// mesmo padrão já usado por PlatformApplicationController/ApplicationController
// na Fase 4a (duas classes de controller podem compartilhar prefixo sem
// colisão de rota).
@Controller('v1/webhook-endpoints')
@UseGuards(CerbosGuard)
export class WebhookDeliveryController {
  private readonly tenantContext: TenantContext;

  constructor(
    private readonly webhookDeliveryService: WebhookDeliveryService,
    databaseService: DatabaseService,
  ) {
    this.tenantContext = new TenantContext(databaseService.pool);
  }

  @Get(':id/deliveries')
  @CerbosCheck('webhook_endpoint', 'read-deliveries')
  async list(@Req() req: RequestWithAuthContext, @Param('id') endpointId: string, @Query() query: ListDeliveriesQuery) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    return this.tenantContext.run(req.tenantId, async (client) => {
      // Mesmo estilo de montagem de query de ApplicationService.listByCursor
      // (Fase 1/4a) -- todo parâmetro variável é $N posicional, nunca
      // interpolado na string, inclusive o LIMIT.
      const values: unknown[] = [endpointId];
      let cursorCondition = '';
      if (cursor) {
        values.push(cursor.sortValue, cursor.id);
        cursorCondition = `AND (enviado_em, id) > ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
      }
      values.push(query.limit + 1); // busca 1 a mais para saber has_more sem COUNT(*)

      const rows = await client.query<{
        id: string; event_id: string; tentativa_num: number; status_http: number | null; latencia_ms: number | null; enviado_em: Date;
      }>(
        `SELECT id, event_id, tentativa_num, status_http, latencia_ms, enviado_em
           FROM webhook_delivery
          WHERE webhook_endpoint_id = $1
            ${cursorCondition}
          ORDER BY enviado_em ASC, id ASC
          LIMIT $${values.length}`,
        values,
      );

      const hasMore = rows.rows.length > query.limit;
      const items = rows.rows.slice(0, query.limit);
      const last = items[items.length - 1];

      return {
        data: items.map((item) => ({
          id: item.id,
          event_id: item.event_id,
          tentativa_num: item.tentativa_num,
          status_http: item.status_http,
          latencia_ms: item.latencia_ms,
          enviado_em: item.enviado_em.toISOString(),
        })),
        has_more: hasMore,
        next_cursor: hasMore && last ? encodeCursor({ sortValue: last.enviado_em.toISOString(), id: last.id }) : null,
      };
    });
  }

  @Post(':id/deliveries/:deliveryId/actions/resend')
  @CerbosCheck('webhook_endpoint', 'resend-delivery')
  async resend(@Req() req: RequestWithAuthContext, @Param('id') endpointId: string, @Param('deliveryId') deliveryId: string) {
    return this.tenantContext.run(req.tenantId, async (client) => {
      const original = await client.query<{ event_id: string; tentativa_num: number }>(
        `SELECT event_id, tentativa_num FROM webhook_delivery WHERE id = $1 AND webhook_endpoint_id = $2`,
        [deliveryId, endpointId],
      );
      if (original.rows.length === 0) throw new NotFoundException('Entrega não encontrada');

      const endpointRow = await client.query<{ id: string; url: string; ativo: boolean; segredo_atual_cifrado: EncryptedSecret; segredos_historico_cifrados: EncryptedSecret[] }>(
        `SELECT id, url, ativo, segredo_atual_cifrado, segredos_historico_cifrados FROM webhook_endpoint WHERE id = $1`,
        [endpointId],
      );
      if (endpointRow.rows.length === 0 || !endpointRow.rows[0].ativo) throw new NotFoundException('Endpoint não encontrado ou inativo');

      const eventRow = await client.query<{ id: string; event_type: string; sequence: string; occurred_at: Date; payload: Record<string, unknown> }>(
        `SELECT id, event_type, sequence, occurred_at, payload FROM outbox_event WHERE id = $1`,
        [original.rows[0].event_id],
      );
      if (eventRow.rows.length === 0) throw new NotFoundException('Evento de origem não encontrado');

      const maxTentativa = await client.query<{ max: number }>(
        `SELECT MAX(tentativa_num) AS max FROM webhook_delivery WHERE webhook_endpoint_id = $1 AND event_id = $2`,
        [endpointId, original.rows[0].event_id],
      );

      // Reenvio manual: tentativa avulsa, nunca reabre o cronograma
      // automático se falhar de novo (design spec decisão 16). tentativa_num
      // = max+1 SEM teto em 8 -- um endpoint que já esgotou o cronograma
      // automático (8 tentativas) ainda precisa poder ser reenviado
      // manualmente indefinidamente; agendarProximaTentativa: false já
      // garante que isso nunca reagenda uma tentativa 9/10/... automática
      // (ver WebhookDeliveryService.attemptDelivery: esse flag por si só
      // impede o reagendamento, independente do valor de tentativaNum).
      const resultado = await this.webhookDeliveryService.attemptDelivery(client, {
        tenantId: req.tenantId,
        webhookEndpoint: {
          id: endpointRow.rows[0].id,
          url: endpointRow.rows[0].url,
          segredoAtualCifrado: endpointRow.rows[0].segredo_atual_cifrado,
          segredosHistoricoCifrados: endpointRow.rows[0].segredos_historico_cifrados,
        },
        event: {
          id: eventRow.rows[0].id,
          eventType: eventRow.rows[0].event_type,
          sequence: Number(eventRow.rows[0].sequence),
          occurredAt: eventRow.rows[0].occurred_at,
          payload: eventRow.rows[0].payload,
        },
        tentativaNum: maxTentativa.rows[0].max + 1,
        agendarProximaTentativa: false,
      });

      return { sucesso: resultado.sucesso, status_http: resultado.statusHttp };
    });
  }
}
