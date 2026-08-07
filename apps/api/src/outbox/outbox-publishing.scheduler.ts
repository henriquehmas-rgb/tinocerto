import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { OutboxPublisher } from './outbox-publisher.service';

const POLL_INTERVAL_MS = 2_000;

// OutboxPublisher.publishPending() faz `SELECT * FROM outbox_event WHERE
// published_at IS NULL` SEM filtro de tenant -- precisa enxergar todos os
// tenants numa única query eficiente. DatabaseService é reservado à conexão
// app_runtime (NOSUPERUSER, sem BYPASSRLS) de propósito -- ver o próprio
// comentário daquele arquivo. Este scheduler constrói seu PRÓPRIO Pool
// direto de DATABASE_URL, mesma exceção já documentada para migrate.ts
// ("migrations precisam de privilégio de owner e constrói seu próprio Pool,
// independente deste service") -- estendida aqui para o segundo caso
// legítimo de necessidade cross-tenant real: publicar outbox pendente.
@Injectable()
export class OutboxPublishingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublishingScheduler.name);
  private readonly adminPool: Pool;
  private readonly redis: Redis;
  private readonly publisher: OutboxPublisher;
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor() {
    this.adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    this.redis = new Redis(process.env.REDIS_URL!);
    this.publisher = new OutboxPublisher(this.adminPool, this.redis);
  }

  async onModuleInit(): Promise<void> {
    this.scheduleNext();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.redis.quit();
    await this.adminPool.end();
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    try {
      await this.publisher.publishPending();
    } catch (err) {
      // publishPending() já isola falha por evento internamente e só lança
      // quando TODO o lote falhou (sinal de outage de infra, ver comentário
      // da própria classe) -- aqui, no nível do laço, o mesmo princípio
      // fail-open-por-rodada do AdverseImpactConsumer.consumeLoop() se
      // aplica: uma rodada ruim não pode derrubar o processo inteiro nem
      // impedir a PRÓXIMA rodada de tentar de novo.
      this.logger.error('Falha numa rodada de publishPending() -- seguindo para a próxima', err as Error);
    } finally {
      this.scheduleNext();
    }
  }
}
