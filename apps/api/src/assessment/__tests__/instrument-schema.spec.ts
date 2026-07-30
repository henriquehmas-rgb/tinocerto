import { Pool } from 'pg';

describe('schema de instrumento e blocos', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const instrumentIdsToClean: string[] = [];
  const itemIdsToClean: string[] = [];
  let instrumentId: string | undefined;
  let versionId: string | undefined;

  afterAll(async () => {
    try {
      // Ordem obrigatória: filhas antes das mães. `item` é tabela GLOBAL,
      // compartilhada por todos os specs e pelo seed do banco de itens, então a
      // limpeza dela é rede de segurança e roda mesmo se uma asserção falhar no
      // meio de um teste. Todos os DELETEs são idempotentes.
      if (itemIdsToClean.length > 0) {
        await adminPool.query('DELETE FROM block_item WHERE item_id = ANY($1::uuid[])', [
          itemIdsToClean,
        ]);
      }
      if (instrumentIdsToClean.length > 0) {
        await adminPool.query(
          `DELETE FROM block_item WHERE block_id IN (
             SELECT b.id FROM block b
             JOIN instrument_version iv ON iv.id = b.instrument_version_id
             WHERE iv.instrument_id = ANY($1::uuid[]))`,
          [instrumentIdsToClean],
        );
        await adminPool.query(
          `DELETE FROM block WHERE instrument_version_id IN (
             SELECT id FROM instrument_version WHERE instrument_id = ANY($1::uuid[]))`,
          [instrumentIdsToClean],
        );
        await adminPool.query(
          'DELETE FROM instrument_version WHERE instrument_id = ANY($1::uuid[])',
          [instrumentIdsToClean],
        );
        await adminPool.query('DELETE FROM instrument WHERE id = ANY($1::uuid[])', [
          instrumentIdsToClean,
        ]);
      }
      if (itemIdsToClean.length > 0) {
        await adminPool.query('DELETE FROM item WHERE id = ANY($1::uuid[])', [itemIdsToClean]);
      }
    } finally {
      await adminPool.end();
    }
  });

  it('instrumento nasce no trilho nao_psicologico e a versão nasce linear e inativa', async () => {
    const inst = await adminPool.query<{ id: string; tipo_instrumento: string }>(
      `INSERT INTO instrument (nome) VALUES ('Perfil Comportamental Tinocerto') RETURNING id, tipo_instrumento`,
    );
    instrumentId = inst.rows[0].id;
    instrumentIdsToClean.push(instrumentId);
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
    // O INSERT é feito dentro de try/catch, com RETURNING id, em vez de
    // `expect(...).rejects`: se o CHECK for removido ou relaxado no futuro, o
    // INSERT passa a ter sucesso e a linha 'trilho_inventado' precisa ser
    // registrada para limpeza. `instrument` é tabela GLOBAL -- compartilhada
    // por todos os arquivos de spec e pelo seed do instrumento inicial --, e
    // uma linha bogus vazada ali contamina o resto da suíte. O teste tem que
    // ficar vermelho nesse cenário sem também sujar o banco.
    let erroDoInsert: unknown;
    try {
      const bogus = await adminPool.query<{ id: string }>(
        `INSERT INTO instrument (nome, tipo_instrumento)
         VALUES ('x', 'trilho_inventado') RETURNING id`,
      );
      instrumentIdsToClean.push(bogus.rows[0].id);
    } catch (erro) {
      erroDoInsert = erro;
    }

    // 23514 = check_violation. Asserção por SQLSTATE, não só `toThrow()`: um
    // `toThrow()` genérico ficaria verde para qualquer erro do banco, inclusive
    // um que não tem nada a ver com o CHECK que o teste diz cobrir.
    expect(erroDoInsert).toMatchObject({ code: '23514' });
  });

  it('rejeita modo_administracao fora de linear/cat', async () => {
    // Instrumento próprio: sem ele o teste dependeria do estado deixado pelo
    // teste 1 e, com instrumentId undefined, o INSERT falharia com 23502
    // (NOT NULL) em vez de 23514 (CHECK) -- ficaria verde sem nunca exercer o
    // CHECK de modo_administracao.
    const inst = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument (nome) VALUES ('Instrumento do caso modo_administracao') RETURNING id`,
    );
    instrumentIdsToClean.push(inst.rows[0].id);

    await expect(
      adminPool.query(
        `INSERT INTO instrument_version (instrument_id, versao, modo_administracao) VALUES ($1, 99, 'magico')`,
        [inst.rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('o mesmo item não pode aparecer duas vezes no mesmo bloco', async () => {
    const item = await adminPool.query<{ id: string }>(
      `INSERT INTO item (enunciado, dominio, chave_valencia, ciclo_vida)
       VALUES ('No trabalho, eu reviso meu trabalho antes de entregar.', 'conscienciosidade', 'positivo', 'pre_teste')
       RETURNING id`,
    );
    const itemId = item.rows[0].id;
    itemIdsToClean.push(itemId);

    let blockId: string | undefined;
    try {
      const blk = await adminPool.query<{ id: string }>(
        `INSERT INTO block (instrument_version_id, ordem) VALUES ($1, 1) RETURNING id`,
        [versionId],
      );
      blockId = blk.rows[0].id;

      await adminPool.query(
        `INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 1)`,
        [blockId, itemId],
      );

      await expect(
        adminPool.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 2)`, [
          blockId,
          itemId,
        ]),
      ).rejects.toMatchObject({ code: '23505' });
    } finally {
      // Limpeza no finally: uma asserção falhando não pode vazar linha para a
      // tabela global `item`, que é compartilhada com os outros arquivos de spec.
      if (blockId) {
        await adminPool.query('DELETE FROM block_item WHERE block_id = $1', [blockId]);
        await adminPool.query('DELETE FROM block WHERE id = $1', [blockId]);
      }
      await adminPool.query('DELETE FROM item WHERE id = $1', [itemId]);
    }
  });
});
