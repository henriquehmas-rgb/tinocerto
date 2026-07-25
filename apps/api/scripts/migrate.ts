import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
import { Pool } from 'pg';

interface Manifest {
  migrations: string[];
}

interface RunMigrationsOptions {
  pool: Pool;
  migrationsDir: string;
  manifestPath: string;
  tableName?: string;
}

export async function runMigrations({
  pool,
  migrationsDir,
  manifestPath,
  tableName = 'schema_migrations',
}: RunMigrationsOptions): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id serial PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const alreadyApplied = new Set(
    (await pool.query<{ filename: string }>(`SELECT filename FROM ${tableName}`)).rows.map(
      (r) => r.filename,
    ),
  );

  const applied: string[] = [];

  for (const filename of manifest.migrations) {
    if (alreadyApplied.has(filename)) continue;

    const sql = readFileSync(join(migrationsDir, filename), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO ${tableName} (filename) VALUES ($1)`, [filename]);
      await client.query('COMMIT');
      applied.push(filename);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${filename} falhou: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  return applied;
}

async function main() {
  // CLI entrypoint only: load apps/api/.env, since (unlike the Jest suite)
  // nothing else pre-loads it when this runs standalone via `pnpm migrate`.
  config({ path: join(__dirname, '../.env') });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const applied = await runMigrations({
    pool,
    migrationsDir: join(__dirname, '../migrations'),
    manifestPath: join(__dirname, '../migrations/manifest.json'),
  });
  console.log(applied.length ? `Aplicadas: ${applied.join(', ')}` : 'Nada a aplicar.');
  await pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
