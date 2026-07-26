import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    // Conecta como APP_DATABASE_URL (role app_runtime — NOSUPERUSER,
    // NOBYPASSRLS), nunca como DATABASE_URL (role dono do schema,
    // superuser/BYPASSRLS nesta fase de dev). Superuser sempre bypassa
    // RLS, inclusive FORCE ROW LEVEL SECURITY — se este provider
    // conectasse com DATABASE_URL, toda a proteção de RLS construída na
    // Fase 0 (Tasks 5-8, 11, 13, 18) estaria provada correta nos testes
    // mas não protegeria nada contra código de produção real escrito
    // contra este service, que é o único ponto @Global de acesso ao
    // banco que a aplicação vai injetar (ver database.module.ts).
    //
    // migrate.ts continua usando DATABASE_URL de propósito — migrations
    // precisam de privilégio de owner e constrói seu próprio Pool,
    // independente deste service.
    this.pool = new Pool({ connectionString: process.env.APP_DATABASE_URL });
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
