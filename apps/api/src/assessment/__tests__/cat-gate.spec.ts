import { Pool, PoolClient } from 'pg';
import { INSTRUMENT_VERSION_SEMEADA } from './seed-scope';

describe('trava do CAT por parâmetro provisório', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const VERSION_ID = INSTRUMENT_VERSION_SEMEADA;

  /** Versão/bloco de fixture, exclusivos deste arquivo. */
  const VERSAO_CAT = 'c0ffee00-0000-4000-8000-0000000000aa';
  const BLOCO_CAT = 'c0ffee00-0000-4000-8000-0000000000bb';

  afterAll(async () => {
    await adminPool.end();
  });

  /**
   * Monta, na transação do client, a sequência que o revisor usou para
   * contornar a trava: versão criada JÁ em modo CAT (sem bloco nenhum, logo
   * sem item provisório para contar) e só depois os blocos e os itens. É a
   * ordem natural de versionar um instrumento, não um caminho exótico.
   */
  async function montaVersaoCatComItensDoSeed(client: PoolClient): Promise<void> {
    await client.query(
      `INSERT INTO instrument_version (id, instrument_id, versao, modo_administracao, ativo)
       SELECT $1, instrument_id, 99, 'cat', false FROM instrument_version WHERE id = $2`,
      [VERSAO_CAT, VERSION_ID],
    );
    await client.query(`INSERT INTO block (id, instrument_version_id, ordem) VALUES ($1, $2, 1)`, [
      BLOCO_CAT,
      VERSAO_CAT,
    ]);
    await client.query(
      `INSERT INTO block_item (block_id, item_id, posicao)
       SELECT $1, bi.item_id, bi.posicao
         FROM block_item bi
         JOIN block b ON b.id = bi.block_id
        WHERE b.instrument_version_id = $2 AND b.ordem = 1`,
      [BLOCO_CAT, VERSION_ID],
    );
  }

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

  it('NÃO permite nascer em modo CAT e só depois receber os itens provisórios', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await montaVersaoCatComItensDoSeed(client);
      // A trava é deferida: a pergunta é feita no COMMIT, com o estado final
      // à vista. Sem a assessment_0014 esta transação commitava limpa e
      // deixava uma versão CAT com item provisório gravada.
      await expect(client.query('COMMIT')).rejects.toThrow(/provisorio/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('NÃO permite anexar item provisório a uma versão que JÁ está em modo CAT', async () => {
    const client = await adminPool.connect();
    try {
      // Versão CAT vazia é estado inócuo e permitido -- é o único jeito de
      // montar uma versão CAT legítima em transações separadas.
      await client.query(
        `INSERT INTO instrument_version (id, instrument_id, versao, modo_administracao, ativo)
         SELECT $1, instrument_id, 99, 'cat', false FROM instrument_version WHERE id = $2`,
        [VERSAO_CAT, VERSION_ID],
      );
      await client.query(`INSERT INTO block (id, instrument_version_id, ordem) VALUES ($1, $2, 1)`, [
        BLOCO_CAT,
        VERSAO_CAT,
      ]);
      // O que ela não pode é ganhar item sem parâmetro calibrado.
      await expect(
        client.query(
          `INSERT INTO block_item (block_id, item_id, posicao)
           SELECT $1, bi.item_id, bi.posicao
             FROM block_item bi
             JOIN block b ON b.id = bi.block_id
            WHERE b.instrument_version_id = $2 AND b.ordem = 1`,
          [BLOCO_CAT, VERSION_ID],
        ),
      ).rejects.toThrow(/provisorio/i);
    } finally {
      await client.query(`DELETE FROM block_item WHERE block_id = $1`, [BLOCO_CAT]).catch(() => undefined);
      await client.query(`DELETE FROM block WHERE id = $1`, [BLOCO_CAT]).catch(() => undefined);
      await client.query(`DELETE FROM instrument_version WHERE id = $1`, [VERSAO_CAT]).catch(() => undefined);
      client.release();
    }
  });

  it('trava também o item que não tem calibração NENHUMA, não só o provisório', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await montaVersaoCatComItensDoSeed(client);
      // Some com toda calibração desses itens: sem parâmetro, a seleção por
      // informação de Fisher não consegue nem pontuar o item.
      await client.query(
        `DELETE FROM item_parameter_version
          WHERE item_id IN (SELECT item_id FROM block_item WHERE block_id = $1)`,
        [BLOCO_CAT],
      );
      await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toThrow(/provisorio/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('barra uma recalibração provisória de item que já está em uso por uma versão CAT', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await montaVersaoCatComItensDoSeed(client);
      await client.query(
        `UPDATE item_parameter_version SET provisorio = false
          WHERE item_id IN (SELECT item_id FROM block_item WHERE block_id = $1)`,
        [BLOCO_CAT],
      );
      // CONTROLE POSITIVO: com tudo calibrado a versão CAT é aceita. Sem esta
      // asserção o teste abaixo passaria mesmo com um gate que recusa tudo.
      await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).resolves.toBeDefined();

      // Agora chega uma recalibração ainda provisória para um item que o CAT
      // já usa -- o parâmetro VIGENTE daquele item volta a ser provisório.
      // O `SET CONSTRAINTS ALL IMMEDIATE` acima vale para o resto da
      // transação, então a trava morde já no próprio INSERT; encadear os dois
      // deixa a asserção válida nos dois regimes (imediato e deferido).
      await expect(
        client
          .query(
            `INSERT INTO item_parameter_version
               (item_id, modelo, a, b, c, calibracao_versao, amostra_n, provisorio, criado_em)
             SELECT item_id, '2PL', 1.0, 0.0, 0, 'recalib_em_andamento', 10, true, now() + interval '1 hour'
               FROM block_item WHERE block_id = $1 LIMIT 1`,
            [BLOCO_CAT],
          )
          .then(() => client.query('SET CONSTRAINTS ALL IMMEDIATE')),
      ).rejects.toThrow(/provisorio/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  /**
   * REGRESSÃO da assessment_0015. A 0014 resolvia o item afetado por
   * `TG_OP = 'DELETE' ? OLD.item_id : NEW.item_id`, então um UPDATE que
   * REAPONTA a linha de calibração para outro item só validava as versões do
   * item NOVO -- nunca as do item de quem o parâmetro estava sendo TIRADO.
   *
   * Isso deixava passar exatamente o estado que o gate existe para proibir:
   * uma versão em modo CAT com um item de ZERO parâmetros, que a seleção por
   * informação de Fisher não consegue nem pontuar. E era o ramo alcançável
   * pela aplicação: app_runtime tem UPDATE em item_parameter_version, mas não
   * tem DELETE.
   */
  it('barra REAPONTAR a calibração vigente para outro item, zerando um item em uso pelo CAT', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await montaVersaoCatComItensDoSeed(client);
      await client.query(
        `UPDATE item_parameter_version SET provisorio = false
          WHERE item_id IN (SELECT item_id FROM block_item WHERE block_id = $1)`,
        [BLOCO_CAT],
      );
      // CONTROLE POSITIVO: a versão CAT montada é legítima e é aceita.
      await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).resolves.toBeDefined();

      // Item de FORA da versão CAT, para servir de destino do reaponte. Some
      // com a calibração dele primeiro: a unique (item_id, calibracao_versao)
      // barraria o UPDATE por outro motivo, e o teste passaria por engano.
      const alvoDeFora = `SELECT bi.item_id
                            FROM block_item bi
                            JOIN block b ON b.id = bi.block_id
                           WHERE b.instrument_version_id = $1 AND b.ordem = 2
                           ORDER BY bi.posicao LIMIT 1`;
      await client.query(
        `DELETE FROM item_parameter_version WHERE item_id = (${alvoDeFora})`,
        [VERSION_ID],
      );

      // O reaponte: a única linha de parâmetro de um item DE DENTRO passa a
      // pertencer ao item DE FORA. O item de dentro fica sem parâmetro nenhum.
      await expect(
        client.query(
          `UPDATE item_parameter_version
              SET item_id = (${alvoDeFora})
            WHERE item_id = (SELECT item_id FROM block_item WHERE block_id = $2 ORDER BY posicao LIMIT 1)`,
          [VERSION_ID, BLOCO_CAT],
        ),
      ).rejects.toThrow(/sem parametro calibrado vigente/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
