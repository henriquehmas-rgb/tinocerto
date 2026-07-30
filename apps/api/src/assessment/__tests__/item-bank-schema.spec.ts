import { Pool } from 'pg';

describe('schema do banco de itens', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let itemId: string | undefined;

  afterAll(async () => {
    if (itemId) {
      await adminPool.query('DELETE FROM dif_flag WHERE item_id = $1', [itemId]);
      await adminPool.query('DELETE FROM item_parameter_version WHERE item_id = $1', [itemId]);
      await adminPool.query('DELETE FROM item WHERE id = $1', [itemId]);
    }
    await adminPool.end();
  });

  it('item nasce como rascunho e aceita só os estágios do ciclo de vida', async () => {
    const inserted = await adminPool.query<{ id: string; ciclo_vida: string }>(
      `INSERT INTO item (enunciado, dominio, faceta, chave_valencia)
       VALUES ('No trabalho, eu planejo minhas tarefas com antecedência.', 'conscienciosidade', 'ordem', 'positivo')
       RETURNING id, ciclo_vida`,
    );
    itemId = inserted.rows[0].id;
    expect(inserted.rows[0].ciclo_vida).toBe('rascunho');

    await expect(
      adminPool.query(
        `INSERT INTO item (enunciado, dominio, chave_valencia, ciclo_vida)
         VALUES ('x', 'y', 'positivo', 'estagio_inventado')`,
      ),
    ).rejects.toThrow();
  });

  it('chave_valencia só aceita positivo ou negativo', async () => {
    await expect(
      adminPool.query(
        `INSERT INTO item (enunciado, dominio, chave_valencia) VALUES ('x', 'y', 'talvez')`,
      ),
    ).rejects.toThrow();
  });

  it('parâmetro nasce provisório e é versionado por calibracao_versao', async () => {
    await adminPool.query(
      `INSERT INTO item_parameter_version (item_id, modelo, a, b, calibracao_versao)
       VALUES ($1, '2PL', 1.2, -0.3, 'literatura_v1')`,
      [itemId],
    );

    const row = await adminPool.query<{ provisorio: boolean }>(
      `SELECT provisorio FROM item_parameter_version WHERE item_id = $1 AND calibracao_versao = 'literatura_v1'`,
      [itemId],
    );
    expect(row.rows[0].provisorio).toBe(true);

    // Mesma calibração para o mesmo item duas vezes é erro -- recalibrar
    // cria versão NOVA, nunca duplica a mesma.
    await expect(
      adminPool.query(
        `INSERT INTO item_parameter_version (item_id, modelo, a, b, calibracao_versao)
         VALUES ($1, '2PL', 9.9, 9.9, 'literatura_v1')`,
        [itemId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('recalibrar cria versão nova sem tocar na anterior', async () => {
    await adminPool.query(
      `INSERT INTO item_parameter_version (item_id, modelo, a, b, calibracao_versao, provisorio, amostra_n, calibrado_em)
       VALUES ($1, '2PL', 1.35, -0.25, 'run_2027_01', false, 1200, now())`,
      [itemId],
    );

    const todas = await adminPool.query<{ calibracao_versao: string; provisorio: boolean }>(
      `SELECT calibracao_versao, provisorio FROM item_parameter_version WHERE item_id = $1 ORDER BY criado_em`,
      [itemId],
    );
    expect(todas.rows).toHaveLength(2);
    // A versão provisória original continua lá, intacta.
    expect(todas.rows[0].provisorio).toBe(true);
    expect(todas.rows[1].provisorio).toBe(false);
  });
});
