import { Pool } from 'pg';

describe('schema de instrumento e blocos', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let instrumentId: string | undefined;
  let versionId: string | undefined;

  afterAll(async () => {
    if (versionId) {
      await adminPool.query(
        'DELETE FROM block_item WHERE block_id IN (SELECT id FROM block WHERE instrument_version_id = $1)',
        [versionId],
      );
      await adminPool.query('DELETE FROM block WHERE instrument_version_id = $1', [versionId]);
      await adminPool.query('DELETE FROM instrument_version WHERE id = $1', [versionId]);
    }
    if (instrumentId) {
      await adminPool.query('DELETE FROM instrument WHERE id = $1', [instrumentId]);
    }
    await adminPool.end();
  });

  it('instrumento nasce no trilho nao_psicologico e a versão nasce linear e inativa', async () => {
    const inst = await adminPool.query<{ id: string; tipo_instrumento: string }>(
      `INSERT INTO instrument (nome) VALUES ('Perfil Comportamental Tinocerto') RETURNING id, tipo_instrumento`,
    );
    instrumentId = inst.rows[0].id;
    expect(inst.rows[0].tipo_instrumento).toBe('nao_psicologico');

    const ver = await adminPool.query<{ id: string; modo_administracao: string; ativo: boolean }>(
      `INSERT INTO instrument_version (instrument_id, versao) VALUES ($1, 1)
       RETURNING id, modo_administracao, ativo`,
      [instrumentId],
    );
    versionId = ver.rows[0].id;
    // Padrões que importam: linear no dia 1, e nada nasce ativo.
    expect(ver.rows[0].modo_administracao).toBe('linear');
    expect(ver.rows[0].ativo).toBe(false);
  });

  it('rejeita tipo_instrumento fora dos dois trilhos', async () => {
    await expect(
      adminPool.query(
        `INSERT INTO instrument (nome, tipo_instrumento) VALUES ('x', 'trilho_inventado')`,
      ),
    ).rejects.toThrow();
  });

  it('rejeita modo_administracao fora de linear/cat', async () => {
    await expect(
      adminPool.query(
        `INSERT INTO instrument_version (instrument_id, versao, modo_administracao) VALUES ($1, 99, 'magico')`,
        [instrumentId],
      ),
    ).rejects.toThrow();
  });

  it('o mesmo item não pode aparecer duas vezes no mesmo bloco', async () => {
    const item = await adminPool.query<{ id: string }>(
      `INSERT INTO item (enunciado, dominio, chave_valencia, ciclo_vida)
       VALUES ('No trabalho, eu reviso meu trabalho antes de entregar.', 'conscienciosidade', 'positivo', 'pre_teste')
       RETURNING id`,
    );
    const blk = await adminPool.query<{ id: string }>(
      `INSERT INTO block (instrument_version_id, ordem) VALUES ($1, 1) RETURNING id`,
      [versionId],
    );

    await adminPool.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 1)`, [
      blk.rows[0].id,
      item.rows[0].id,
    ]);

    await expect(
      adminPool.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 2)`, [
        blk.rows[0].id,
        item.rows[0].id,
      ]),
    ).rejects.toMatchObject({ code: '23505' });

    await adminPool.query('DELETE FROM block_item WHERE block_id = $1', [blk.rows[0].id]);
    await adminPool.query('DELETE FROM block WHERE id = $1', [blk.rows[0].id]);
    await adminPool.query('DELETE FROM item WHERE id = $1', [item.rows[0].id]);
  });
});
