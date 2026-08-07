import { createHmac } from 'crypto';
import { buildWebhookEnvelope, signWebhookBody } from '../webhook-signing';
import { MAX_ATTEMPTS, RETRY_SCHEDULE_MS } from '../webhook-retry-schedule';

describe('webhook-signing', () => {
  const input = {
    eventId: 'evt-teste-0001',
    eventType: 'application.created',
    occurredAt: '2026-08-07T12:00:00.000Z',
    sequence: 1,
    tenantId: 'tenant-teste-0001',
    payload: { application_id: 'app-teste-0001' },
  };

  it('buildWebhookEnvelope é determinístico -- duas chamadas com o mesmo input produzem bytes idênticos', () => {
    expect(buildWebhookEnvelope(input)).toBe(buildWebhookEnvelope({ ...input }));
  });

  it('buildWebhookEnvelope usa a ordem de chave id/type/occurred_at/sequence/tenant_id/data', () => {
    const body = buildWebhookEnvelope(input);
    const chaves = Object.keys(JSON.parse(body));
    expect(chaves).toEqual(['id', 'type', 'occurred_at', 'sequence', 'tenant_id', 'data']);
  });

  it('signWebhookBody com 2 segredos produz 2 blocos v1,... separados por espaço, na ordem recebida', () => {
    const rawBody = buildWebhookEnvelope(input);
    const assinatura = signWebhookBody(['segredo-a', 'segredo-b'], input.eventId, 1785163202, rawBody);
    const blocos = assinatura.split(' ');
    expect(blocos).toHaveLength(2);
    for (const bloco of blocos) expect(bloco.startsWith('v1,')).toBe(true);

    const esperadoA = createHmac('sha256', 'segredo-a').update(`${input.eventId}.1785163202.${rawBody}`).digest('base64');
    expect(blocos[0]).toBe(`v1,${esperadoA}`);
  });

  it('cronograma tem 7 intervalos para 8 tentativas, todos em milissegundos crescentes ou iguais', () => {
    expect(RETRY_SCHEDULE_MS).toHaveLength(MAX_ATTEMPTS - 1);
    for (let i = 1; i < RETRY_SCHEDULE_MS.length; i++) {
      expect(RETRY_SCHEDULE_MS[i]).toBeGreaterThanOrEqual(RETRY_SCHEDULE_MS[i - 1] === RETRY_SCHEDULE_MS[i] ? RETRY_SCHEDULE_MS[i] : RETRY_SCHEDULE_MS[i - 1]);
    }
  });
});
