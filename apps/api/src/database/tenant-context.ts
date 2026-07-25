import { Pool, PoolClient } from 'pg';

export class TenantContext {
  constructor(private readonly pool: Pool) {}

  async run<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let errorToReport: Error | undefined;
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
      errorToReport = err instanceof Error ? err : new Error(String(err));
      try {
        await client.query('ROLLBACK');
      } catch {
        // Rollback falhou (ex.: conexão já caiu) -- o erro original de `err`
        // é o que importa reportar; o client ainda assim é liberado marcado
        // como corrompido logo abaixo, então o pool não recicla ele.
      }
      throw err;
    } finally {
      // Passar o erro para release() avisa o pool para descartar esta
      // conexão em vez de devolvê-la ao pool -- evita reciclar um client
      // que pode estar em estado inconsistente após um erro na transação.
      client.release(errorToReport);
    }
  }
}
