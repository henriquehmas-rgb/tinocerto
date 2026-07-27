import Redis from 'ioredis';
import { Pool } from 'pg';
import { TenantContext } from '../../database/tenant-context';
import { OutboxService } from '../../outbox/outbox.service';
import { OutboxPublisher } from '../../outbox/outbox-publisher.service';
import { AuditLogService, computeEntryHash } from '../audit-log.service';
import { OutboxToAuditConsumer } from '../outbox-to-audit.consumer';

// Precisa bater com o CONSUMER_GROUP privado de outbox-to-audit.consumer.ts
// — não exportado de propósito (não faz parte da API pública da classe),
// então os testes de PEL abaixo (que precisam inspecionar XPENDING
// diretamente) duplicam a constante aqui.
const CONSUMER_GROUP = 'trust-audit-consumer';

describe('Portão de integração Fase 0 — outbox → Trust → audit_log_entry', () => {
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const redis = new Redis(process.env.REDIS_URL!);
  let tenantId: string;

  beforeAll(async () => {
    // CNPJ '00000000000010' do brief original colide com o mesmo valor já
    // usado em outbox-publisher.service.spec.ts ("Empresa Publisher Fila
    // Vazia") — tenant.cnpj é UNIQUE, e o INSERT abaixo falharia com
    // violação de constraint. Trocado para '00000000000013', o próximo
    // valor livre (00000000000001–00000000000012 já estão em uso por
    // specs existentes; mesmo tipo de correção de fixture já aplicado nas
    // Tasks 11 e 13).
    const t = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Gate', '00000000000013', 'test-tenant-00000000000013') RETURNING id`,
    );
    tenantId = t.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [tenantId]);
    await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    await redis.del(`outbox:${tenantId}`);
    await adminPool.end();
    await appPool.end();
    await redis.quit();
  });

  it('um evento gravado por outro domínio é consumido e aparece hash-chained em menos de 5s', async () => {
    const ctx = new TenantContext(appPool);
    const outbox = new OutboxService();
    const aggregateId = '44444444-4444-4444-4444-444444444444';

    // Simula um agregado de negócio qualquer (Fase 1+) gravando um evento.
    await ctx.run(tenantId, (client) =>
      outbox.write(client, {
        tenantId,
        aggregateType: 'application',
        aggregateId,
        eventType: 'application.stage_changed',
        sequence: 1,
        payload: { from_state: 'triagem', to_state: 'entrevista' },
        occurredAt: new Date(),
      }),
    );

    const publisher = new OutboxPublisher(adminPool, redis);
    await publisher.publishPending();

    const consumer = new OutboxToAuditConsumer(redis, appPool, tenantId);
    await consumer.consumeOnce();

    const rows = await adminPool.query(
      `SELECT * FROM audit_log_entry WHERE tenant_id = $1 AND resource_type = 'application'`,
      [tenantId],
    );

    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0];
    expect(row.action).toBe('application.stage_changed');
    expect(row.hash).toBeDefined();

    // [Minor, revisão adversarial Task 14 fix2] a asserção acima
    // (`hash` definido) é vacuamente verdadeira — `hash` é `text NOT
    // NULL`, nunca poderia ser `undefined`. O portão de integração só
    // prova o que promete (evento chega hash-chained, não só "chega")
    // se a cadeia for de fato verificada: hash recomputado a partir dos
    // valores LIDOS DO BANCO (não dos valores originais em memória —
    // mesma disciplina de "verificador externo" de
    // audit-log.service.spec.ts) bate com o hash gravado, é a primeira
    // entrada da cadeia deste tenant (prev_hash nulo, chain_seq = 1), e
    // o evento foi de fato confirmado no stream (XPENDING zerado).
    expect(row.prev_hash).toBeNull();
    expect(row.chain_seq).toBe('1');

    const recomputedHash = computeEntryHash(row.prev_hash, row.id, BigInt(row.chain_seq), {
      tenantId: row.tenant_id,
      actorId: row.actor_id ?? undefined,
      actorType: row.actor_type,
      onBehalfOf: row.on_behalf_of ?? undefined,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id ?? undefined,
      fieldsRead: row.fields_read ?? undefined,
      ip: row.ip ?? undefined,
      userAgent: row.user_agent ?? undefined,
      requestId: row.request_id ?? undefined,
      occurredAt: row.occurred_at,
    });
    expect(recomputedHash).toBe(row.hash);

    const pendingAfterAck = await redis.xpending(`outbox:${tenantId}`, CONSUMER_GROUP);
    expect(Number(pendingAfterAck[0])).toBe(0);
  }, 10_000);

  describe('recuperação de falhas via PEL (revisão adversarial Task 14, achado Critical)', () => {
    let pelTenantId: string;

    beforeAll(async () => {
      const t = await adminPool.query<{ id: string }>(
        `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Gate Recuperacao PEL', '00000000000014', 'test-tenant-00000000000014') RETURNING id`,
      );
      pelTenantId = t.rows[0].id;
    });

    afterAll(async () => {
      await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [pelTenantId]);
      await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [pelTenantId]);
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [pelTenantId]);
      await redis.del(`outbox:${pelTenantId}`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('append falha na 1a rodada: evento fica pendente no PEL (nao some) e e recuperado na 2a rodada', async () => {
      const ctx = new TenantContext(appPool);
      const outbox = new OutboxService();
      const aggregateId = '88888888-8888-8888-8888-888888888888';
      const streamKey = `outbox:${pelTenantId}`;

      await ctx.run(pelTenantId, (client) =>
        outbox.write(client, {
          tenantId: pelTenantId,
          aggregateType: 'application',
          aggregateId,
          eventType: 'application.pel_recovery',
          sequence: 1,
          payload: {},
          occurredAt: new Date(),
        }),
      );

      const publisher = new OutboxPublisher(adminPool, redis);
      await publisher.publishPending();

      // Reproduz exatamente o cenario da revisao adversarial: o append()
      // do 1o (unico) evento falha nesta rodada.
      const appendSpy = jest.spyOn(AuditLogService.prototype, 'append');
      appendSpy.mockRejectedValueOnce(new Error('append falhou (simulado)'));

      const consumer = new OutboxToAuditConsumer(redis, appPool, pelTenantId);

      // Lote inteiro falhou (1 de 1) -> outage sinalizado via throw, ver
      // achado Important / escalada espelhada do OutboxPublisher.
      await expect(consumer.consumeOnce()).rejects.toThrow();

      const rowsAfterFirstRound = await adminPool.query(
        `SELECT * FROM audit_log_entry WHERE tenant_id = $1`,
        [pelTenantId],
      );
      expect(rowsAfterFirstRound.rows).toHaveLength(0);

      const pendingAfterFirstRound = await redis.xpending(streamKey, CONSUMER_GROUP);
      expect(Number(pendingAfterFirstRound[0])).toBe(1);

      // 2a rodada: append volta a funcionar normalmente (o mock de uma
      // unica vez ja foi consumido). Antes da correcao, consumeOnce() so
      // lia com ID '>' e essa leitura nao devolveria mais nada — a
      // mensagem ja tinha sido entregue uma vez e ficaria orfa no PEL para
      // sempre. Com a leitura adicional por '0', ela e recuperada aqui.
      await consumer.consumeOnce();

      const rowsAfterSecondRound = await adminPool.query(
        `SELECT * FROM audit_log_entry WHERE tenant_id = $1`,
        [pelTenantId],
      );
      expect(rowsAfterSecondRound.rows).toHaveLength(1);
      expect(rowsAfterSecondRound.rows[0].action).toBe('application.pel_recovery');
      expect(rowsAfterSecondRound.rows[0].resource_id).toBe(aggregateId);

      const pendingAfterSecondRound = await redis.xpending(streamKey, CONSUMER_GROUP);
      expect(Number(pendingAfterSecondRound[0])).toBe(0);
    }, 10_000);
  });

  describe('isolamento por evento no lote (revisão adversarial Task 14, achado Important)', () => {
    let batchTenantId: string;

    beforeAll(async () => {
      const t = await adminPool.query<{ id: string }>(
        `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Gate Isolamento Lote', '00000000000015', 'test-tenant-00000000000015') RETURNING id`,
      );
      batchTenantId = t.rows[0].id;
    });

    afterAll(async () => {
      await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [batchTenantId]);
      await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [batchTenantId]);
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [batchTenantId]);
      await redis.del(`outbox:${batchTenantId}`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('falha isolada no 1o de 3 eventos nao aborta os outros 2 do mesmo lote, e o 1o e recuperado depois', async () => {
      const ctx = new TenantContext(appPool);
      const outbox = new OutboxService();
      const streamKey = `outbox:${batchTenantId}`;
      const aggregateIds = [
        '99999999-9999-9999-9999-999999999991',
        '99999999-9999-9999-9999-999999999992',
        '99999999-9999-9999-9999-999999999993',
      ];

      for (let i = 0; i < aggregateIds.length; i++) {
        await ctx.run(batchTenantId, (client) =>
          outbox.write(client, {
            tenantId: batchTenantId,
            aggregateType: 'application',
            aggregateId: aggregateIds[i],
            eventType: `application.batch_evento_${i + 1}`,
            sequence: i + 1,
            payload: {},
            occurredAt: new Date(),
          }),
        );
      }

      const publisher = new OutboxPublisher(adminPool, redis);
      await publisher.publishPending();

      // Só o 1o append (evento mais antigo do stream, lido primeiro) falha.
      const appendSpy = jest.spyOn(AuditLogService.prototype, 'append');
      appendSpy.mockRejectedValueOnce(new Error('append falhou no 1o evento (simulado)'));

      const consumer = new OutboxToAuditConsumer(redis, appPool, batchTenantId);

      // Falha parcial (1 de 3) -> degradação tolerável, não lança.
      await consumer.consumeOnce();

      const rowsAfterFirstRound = await adminPool.query(
        `SELECT resource_id FROM audit_log_entry WHERE tenant_id = $1 ORDER BY chain_seq`,
        [batchTenantId],
      );
      // Os 2 eventos seguintes do MESMO lote foram processados mesmo com o
      // 1o falhando — antes da correção, a exceção do 1o evento propagava
      // e abortava o `for`, e nenhum dos 3 era gravado.
      expect(rowsAfterFirstRound.rows).toHaveLength(2);
      expect(rowsAfterFirstRound.rows.map((r) => r.resource_id)).toEqual([
        aggregateIds[1],
        aggregateIds[2],
      ]);

      const pendingAfterFirstRound = await redis.xpending(streamKey, CONSUMER_GROUP);
      expect(Number(pendingAfterFirstRound[0])).toBe(1);

      // 2a rodada: o evento que falhou é recuperado via PEL, sem duplicar
      // os outros 2 (já confirmados com XACK na 1a rodada).
      await consumer.consumeOnce();

      const rowsAfterSecondRound = await adminPool.query(
        `SELECT resource_id FROM audit_log_entry WHERE tenant_id = $1 ORDER BY chain_seq`,
        [batchTenantId],
      );
      expect(rowsAfterSecondRound.rows).toHaveLength(3);
      // chain_seq reflete a ORDEM DE INSERÇÃO, não a ordem original do
      // stream: o evento 1 (que falhou na 1a rodada) só ganha seu
      // chain_seq na 2a rodada, depois dos eventos 2 e 3 — por isso ele
      // aparece por último aqui, mesmo tendo sido o primeiro publicado.
      expect(rowsAfterSecondRound.rows.map((r) => r.resource_id)).toEqual([
        aggregateIds[1],
        aggregateIds[2],
        aggregateIds[0],
      ]);

      const pendingAfterSecondRound = await redis.xpending(streamKey, CONSUMER_GROUP);
      expect(Number(pendingAfterSecondRound[0])).toBe(0);
    }, 10_000);
  });

  describe('outage total do lote (espelha OutboxPublisher, Task 12)', () => {
    let outageTenantId: string;

    beforeAll(async () => {
      const t = await adminPool.query<{ id: string }>(
        `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('Empresa Gate Outage Total', '00000000000016', 'test-tenant-00000000000016') RETURNING id`,
      );
      outageTenantId = t.rows[0].id;
    });

    afterAll(async () => {
      await adminPool.query('DELETE FROM audit_log_entry WHERE tenant_id = $1', [outageTenantId]);
      await adminPool.query('DELETE FROM outbox_event WHERE tenant_id = $1', [outageTenantId]);
      await adminPool.query('DELETE FROM tenant WHERE id = $1', [outageTenantId]);
      await redis.del(`outbox:${outageTenantId}`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('todos os eventos do lote falham: consumeOnce() lança e nenhum e confirmado (XACK)', async () => {
      const ctx = new TenantContext(appPool);
      const outbox = new OutboxService();
      const streamKey = `outbox:${outageTenantId}`;
      const aggregateId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

      await ctx.run(outageTenantId, (client) =>
        outbox.write(client, {
          tenantId: outageTenantId,
          aggregateType: 'application',
          aggregateId,
          eventType: 'application.outage_total',
          sequence: 1,
          payload: {},
          occurredAt: new Date(),
        }),
      );

      const publisher = new OutboxPublisher(adminPool, redis);
      await publisher.publishPending();

      const appendSpy = jest.spyOn(AuditLogService.prototype, 'append');
      appendSpy.mockRejectedValue(new Error('postgres totalmente indisponivel (simulado)'));

      const consumer = new OutboxToAuditConsumer(redis, appPool, outageTenantId);

      await expect(consumer.consumeOnce()).rejects.toThrow();

      const rows = await adminPool.query(
        `SELECT * FROM audit_log_entry WHERE tenant_id = $1`,
        [outageTenantId],
      );
      expect(rows.rows).toHaveLength(0);

      const pending = await redis.xpending(streamKey, CONSUMER_GROUP);
      expect(Number(pending[0])).toBe(1);
    }, 10_000);
  });
});
