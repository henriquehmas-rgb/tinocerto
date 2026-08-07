import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DatabaseService } from '../../database/database.service';
import { RateLimitService } from '../rate-limit.service';

describe('RateLimitService.checkAndIncrement', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });
  const databaseService = { pool: appPool } as DatabaseService;
  // Instância única reaproveitada por todos os testes (menos o de Redis
  // quebrado, que precisa do próprio cliente) -- mesmo cliente ioredis
  // interno reaproveitado em vez de uma conexão nova por `it`, e fechado
  // uma única vez no afterAll (acesso à propriedade privada via cast --
  // mesma técnica já usada em candidate-token.service.spec.ts para
  // substituir/inspecionar dependência interna sem mexer no construtor de
  // produção).
  const service = new RateLimitService(databaseService);
  const redisInterno = (service as unknown as { redis: Redis }).redis;

  let tenantIdEntrada: string;
  let tenantIdStarter: string;

  beforeAll(async () => {
    const entrada = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug) VALUES ('RateLimit Entrada Ltda','00000000000151','test-tenant-00000000000151') RETURNING id`,
    );
    tenantIdEntrada = entrada.rows[0].id;

    const starter = await adminPool.query<{ id: string }>(
      `INSERT INTO tenant (razao_social, cnpj, slug, plano) VALUES ('RateLimit Starter Ltda','00000000000152','test-tenant-00000000000152','starter') RETURNING id`,
    );
    tenantIdStarter = starter.rows[0].id;
  });

  afterAll(async () => {
    await adminPool.query('DELETE FROM tenant WHERE id = ANY($1)', [[tenantIdEntrada, tenantIdStarter]]);
    await adminPool.end();
    await appPool.end();
    await redisInterno.quit();
  });

  it('primeira chamada de uma chave nova -- allowed, remaining = limit - 1', async () => {
    const apiKeyId = randomUUID();
    const result = await service.checkAndIncrement(apiKeyId, tenantIdEntrada);
    expect(result).toEqual({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetSeconds: expect.any(Number),
      resetAtEpochSeconds: expect.any(Number),
    });
  });

  it('chamadas sucessivas decrementam remaining corretamente', async () => {
    const apiKeyId = randomUUID();
    const now = Date.UTC(2026, 7, 7, 10, 0, 0);

    const r1 = await service.checkAndIncrement(apiKeyId, tenantIdEntrada, now);
    const r2 = await service.checkAndIncrement(apiKeyId, tenantIdEntrada, now + 1000);
    const r3 = await service.checkAndIncrement(apiKeyId, tenantIdEntrada, now + 2000);

    expect([r1.remaining, r2.remaining, r3.remaining]).toEqual([59, 58, 57]);
    expect([r1.allowed, r2.allowed, r3.allowed]).toEqual([true, true, true]);
  });

  it('na chamada de número limit+1, allowed vira false e remaining fica 0', async () => {
    const apiKeyId = randomUUID();
    const now = Date.UTC(2026, 7, 7, 11, 0, 0);

    let ultimo;
    for (let i = 0; i < 61; i++) {
      ultimo = await service.checkAndIncrement(apiKeyId, tenantIdEntrada, now + i * 100);
    }
    expect(ultimo!.allowed).toBe(false);
    expect(ultimo!.remaining).toBe(0);
    expect(ultimo!.limit).toBe(60);
  });

  it('duas api_key diferentes (mesmo tenant) têm contadores independentes', async () => {
    const now = Date.UTC(2026, 7, 7, 12, 0, 0);
    const chaveA = randomUUID();
    const chaveB = randomUUID();

    await service.checkAndIncrement(chaveA, tenantIdEntrada, now);
    await service.checkAndIncrement(chaveA, tenantIdEntrada, now + 100);
    const resultB = await service.checkAndIncrement(chaveB, tenantIdEntrada, now + 200);

    expect(resultB.remaining).toBe(59); // primeira chamada de B, não contaminada pelas 2 de A
  });

  it('tenant com plano starter resolve limite de 300, não 60', async () => {
    const apiKeyId = randomUUID();
    const result = await service.checkAndIncrement(apiKeyId, tenantIdStarter);
    expect(result.limit).toBe(300);
    expect(result.remaining).toBe(299);
  });

  it('janelas diferentes (now separado por > windowSeconds) resetam a contagem', async () => {
    const apiKeyId = randomUUID();
    const janela1 = Date.UTC(2026, 7, 7, 13, 0, 0);
    const janela2 = janela1 + 61_000; // 61s depois -- janela seguinte

    await service.checkAndIncrement(apiKeyId, tenantIdEntrada, janela1);
    const resultJanela2 = await service.checkAndIncrement(apiKeyId, tenantIdEntrada, janela2);
    expect(resultJanela2.remaining).toBe(59); // não 58 -- é a primeira chamada da nova janela
  });

  it('Redis indisponível -- fail-open (allowed true, sem lançar)', async () => {
    // Instância PRÓPRIA (não a `service` compartilhada) com o cliente
    // interno trocado por um que nunca conecta -- não pode contaminar os
    // testes acima, que dependem do Redis real funcionando. O construtor já
    // abre um cliente real (`new Redis(process.env.REDIS_URL!)`) antes de
    // ser substituído aqui -- guarda a referência para fechar os DOIS no
    // final, senão o cliente real original fica órfão com uma conexão
    // aberta que ninguém mais consegue fechar.
    const serviceComRedisQuebrado = new RateLimitService(databaseService);
    const redisOriginalDescartado = (serviceComRedisQuebrado as unknown as { redis: Redis }).redis;
    const redisQuebrado = new Redis({ port: 1, lazyConnect: true, retryStrategy: () => null });
    (serviceComRedisQuebrado as unknown as { redis: Redis }).redis = redisQuebrado;

    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = await serviceComRedisQuebrado.checkAndIncrement(randomUUID(), tenantIdEntrada);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(result.limit);
    // Fail-open não pode ficar silencioso -- degradação do Redis precisa
    // deixar rastro (ver "Riscos conhecidos" no design spec da Fase 4b).
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('Redis indisponível');

    warnSpy.mockRestore();
    await redisQuebrado.quit().catch(() => undefined);
    await redisOriginalDescartado.quit().catch(() => undefined);
  });
});
