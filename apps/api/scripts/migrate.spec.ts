import { Pool } from 'pg';
import { runMigrations } from './migrate';

describe('runMigrations', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS schema_migrations');
    await pool.end();
  });

  it('cria a tabela schema_migrations e aplica migrations do manifest na ordem', async () => {
    await pool.query('DROP TABLE IF EXISTS schema_migrations');

    const applied = await runMigrations({
      pool,
      migrationsDir: __dirname + '/__fixtures__/migrations',
      manifestPath: __dirname + '/__fixtures__/migrations/manifest.json',
    });

    expect(applied).toEqual(['0001_test__create_foo.sql', '0002_test__create_bar.sql']);

    const rows = await pool.query('SELECT filename FROM schema_migrations ORDER BY applied_at');
    expect(rows.rows.map((r) => r.filename)).toEqual(applied);
  });
});
