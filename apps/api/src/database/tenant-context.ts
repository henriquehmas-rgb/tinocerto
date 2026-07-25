import { Pool, PoolClient } from 'pg';

export class TenantContext {
  constructor(private readonly pool: Pool) {}

  async run<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Postgres não aceita bind parameter em SET/SET LOCAL — set_config()
      // com 3º argumento `true` é o equivalente parametrizável, escopado à
      // transação atual (mesmo efeito de LOCAL, sem a limitação de sintaxe).
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
