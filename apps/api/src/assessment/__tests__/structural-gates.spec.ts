import { Pool } from 'pg';

describe('gates estruturais do assessment', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const criados = {
    instrumentos: [] as string[],
    versoes: [] as string[],
    blocos: [] as string[],
    itens: [] as string[],
  };

  async function novoItem(valencia: 'positivo' | 'negativo'): Promise<string> {
    const r = await adminPool.query<{ id: string }>(
      `INSERT INTO item (enunciado, dominio, chave_valencia, ciclo_vida)
       VALUES ($1, 'conscienciosidade', $2, 'pre_teste') RETURNING id`,
      [
        `No trabalho, eu ${valencia === 'positivo' ? 'cumpro prazos' : 'deixo tarefas pela metade'}.`,
        valencia,
      ],
    );
    criados.itens.push(r.rows[0].id);
    return r.rows[0].id;
  }

  afterAll(async () => {
    try {
      for (const b of criados.blocos) {
        await adminPool.query('DELETE FROM block_item WHERE block_id = $1', [b]);
        await adminPool.query('DELETE FROM block WHERE id = $1', [b]);
      }
      // Rede de segurança: se um gate deixar de bloquear, o bloco da transação
      // que deveria ter falhado sobrevive ao COMMIT sem entrar em
      // `criados.blocos` e trava o DELETE das versões por FK — o teardown
      // inteiro aborta e vaza fixture para os outros specs (aconteceu ao vivo
      // na rodada RED). Varrer por instrument_version_id cobre esse caso.
      for (const v of criados.versoes) {
        await adminPool.query(
          'DELETE FROM block_item WHERE block_id IN (SELECT id FROM block WHERE instrument_version_id = $1)',
          [v],
        );
        await adminPool.query('DELETE FROM block WHERE instrument_version_id = $1', [v]);
      }
      for (const v of criados.versoes)
        await adminPool.query('DELETE FROM instrument_version WHERE id = $1', [v]);
      for (const i of criados.instrumentos)
        await adminPool.query('DELETE FROM instrument WHERE id = $1', [i]);
      for (const i of criados.itens) await adminPool.query('DELETE FROM item WHERE id = $1', [i]);
    } finally {
      await adminPool.end();
    }
  });

  it('trilho B NÃO pode ser ativado sem psicólogo com CRP ativo', async () => {
    const inst = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument (nome, tipo_instrumento)
       VALUES ('Instrumento Trilho B', 'teste_psicologico_satepsi') RETURNING id`,
    );
    criados.instrumentos.push(inst.rows[0].id);

    // Garante que não há CRP ativo neste banco de teste.
    const ativos = await adminPool.query(
      `SELECT 1 FROM psicologo_credencial WHERE crp_ativo IS TRUE`,
    );
    expect(ativos.rows).toHaveLength(0);

    await expect(
      adminPool.query(
        `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true)`,
        [inst.rows[0].id],
      ),
    ).rejects.toThrow(/crp_ativo/i);
  });

  it('trilho B INATIVO pode existir no schema (o trilho existe, só não liga)', async () => {
    const inst = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument (nome, tipo_instrumento)
       VALUES ('Instrumento Trilho B Inativo', 'teste_psicologico_satepsi') RETURNING id`,
    );
    criados.instrumentos.push(inst.rows[0].id);

    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, false) RETURNING id`,
      [inst.rows[0].id],
    );
    criados.versoes.push(ver.rows[0].id);
    expect(ver.rows[0].id).toBeDefined();
  });

  it('trilho A pode ser ativado normalmente, sem exigir CRP', async () => {
    const inst = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument (nome) VALUES ('Instrumento Trilho A') RETURNING id`,
    );
    criados.instrumentos.push(inst.rows[0].id);

    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true) RETURNING id`,
      [inst.rows[0].id],
    );
    criados.versoes.push(ver.rows[0].id);
    expect(ver.rows[0].id).toBeDefined();
  });

  it('bloco sem chaveamento oposto é rejeitado no commit', async () => {
    const inst = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument (nome) VALUES ('Instrumento Bloco Invalido') RETURNING id`,
    );
    criados.instrumentos.push(inst.rows[0].id);
    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao) VALUES ($1, 1) RETURNING id`,
      [inst.rows[0].id],
    );
    criados.versoes.push(ver.rows[0].id);

    const a = await novoItem('positivo');
    const b = await novoItem('positivo');

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const blk = await client.query<{ id: string }>(
        `INSERT INTO block (instrument_version_id, ordem) VALUES ($1, 1) RETURNING id`,
        [ver.rows[0].id],
      );
      await client.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 1)`, [
        blk.rows[0].id,
        a,
      ]);
      await client.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 2)`, [
        blk.rows[0].id,
        b,
      ]);
      // Dois positivos: a validação só dispara aqui, no COMMIT.
      await expect(client.query('COMMIT')).rejects.toThrow(/chaveamento oposto/i);
    } finally {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Transação já encerrada pelo erro do COMMIT.
      }
      client.release();
    }
  });

  it('bloco COM chaveamento oposto é aceito', async () => {
    const inst = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument (nome) VALUES ('Instrumento Bloco Valido') RETURNING id`,
    );
    criados.instrumentos.push(inst.rows[0].id);
    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao) VALUES ($1, 1) RETURNING id`,
      [inst.rows[0].id],
    );
    criados.versoes.push(ver.rows[0].id);

    const pos = await novoItem('positivo');
    const neg = await novoItem('negativo');

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const blk = await client.query<{ id: string }>(
        `INSERT INTO block (instrument_version_id, ordem) VALUES ($1, 1) RETURNING id`,
        [ver.rows[0].id],
      );
      await client.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 1)`, [
        blk.rows[0].id,
        pos,
      ]);
      await client.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 2)`, [
        blk.rows[0].id,
        neg,
      ]);
      await client.query('COMMIT');
      criados.blocos.push(blk.rows[0].id);
      expect(blk.rows[0].id).toBeDefined();
    } finally {
      client.release();
    }
  });
});
