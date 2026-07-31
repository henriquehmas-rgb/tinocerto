import { Pool } from 'pg';

describe('trava do CAT por parâmetro provisório', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const VERSION_ID = 'a55e55e0-0000-4000-8000-000000000002';

  afterAll(async () => {
    await adminPool.end();
  });

  it('o instrumento semeado tem parâmetros provisórios (pré-condição do teste)', async () => {
    const { rows } = await adminPool.query<{ n: string }>(
      `SELECT count(*) AS n FROM item_parameter_version WHERE provisorio = true`,
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);
  });

  it('NÃO permite ativar modo CAT enquanto houver parâmetro provisório', async () => {
    await expect(
      adminPool.query(`UPDATE instrument_version SET modo_administracao = 'cat' WHERE id = $1`, [VERSION_ID]),
    ).rejects.toThrow(/provisorio/i);
  });

  it('continua permitindo o modo linear normalmente', async () => {
    await expect(
      adminPool.query(`UPDATE instrument_version SET modo_administracao = 'linear' WHERE id = $1`, [VERSION_ID]),
    ).resolves.toBeDefined();
  });
});
