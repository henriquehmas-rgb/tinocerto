import { Pool } from 'pg';

describe('gates estruturais do assessment', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Conexão com o role que roda em produção (NOSUPERUSER/NOBYPASSRLS). O gate 1
  // precisa valer IGUAL nos dois roles -- ver o último caso deste arquivo.
  const appUrl = new URL(process.env.DATABASE_URL!);
  appUrl.username = 'app_runtime';
  appUrl.password = 'app_runtime_dev_only';
  const appPool = new Pool({ connectionString: appUrl.toString() });

  // Só `instrumentos` e `itens` são rastreados: a limpeza varre versão, bloco e
  // block_item POR instrument_id, então uma linha que só existe porque um gate
  // deixou de bloquear (e que portanto nunca seria registrada aqui) também é
  // removida. Rastrear id por id era justamente o furo do teardown anterior --
  // o primeiro caso inseria instrument_version sem RETURNING, e se o gate 1
  // regredisse a versão órfã travava o `DELETE FROM instrument` por FK,
  // abortando o teardown ANTES da limpeza de `item` e vazando linha para as
  // tabelas GLOBais compartilhadas com todos os outros specs e com o seed IPIP.
  const criados = { instrumentos: [] as string[], itens: [] as string[] };

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

  async function novoInstrumento(nome: string, tipo?: string): Promise<string> {
    const r =
      tipo === undefined
        ? await adminPool.query<{ id: string }>(
            `INSERT INTO instrument (nome) VALUES ($1) RETURNING id`,
            [nome],
          )
        : await adminPool.query<{ id: string }>(
            `INSERT INTO instrument (nome, tipo_instrumento) VALUES ($1, $2) RETURNING id`,
            [nome, tipo],
          );
    criados.instrumentos.push(r.rows[0].id);
    return r.rows[0].id;
  }

  afterAll(async () => {
    try {
      try {
        for (const i of criados.instrumentos) {
          await adminPool.query(
            `DELETE FROM block_item WHERE block_id IN (
               SELECT b.id FROM block b
               JOIN instrument_version iv ON iv.id = b.instrument_version_id
               WHERE iv.instrument_id = $1)`,
            [i],
          );
          await adminPool.query(
            `DELETE FROM block WHERE instrument_version_id IN (
               SELECT id FROM instrument_version WHERE instrument_id = $1)`,
            [i],
          );
          await adminPool.query('DELETE FROM instrument_version WHERE instrument_id = $1', [i]);
          await adminPool.query('DELETE FROM instrument WHERE id = $1', [i]);
        }
      } finally {
        // `item` é tabela GLOBAL. A limpeza dela roda no finally do finally:
        // mesmo que a varredura de instrumento acima estoure (FK inesperada,
        // gate regredido), nenhum item de fixture fica para trás.
        for (const it of criados.itens) {
          await adminPool.query('DELETE FROM block_item WHERE item_id = $1', [it]);
          await adminPool.query('DELETE FROM item WHERE id = $1', [it]);
        }
      }
    } finally {
      await adminPool.end();
      await appPool.end();
    }
  });

  it('trilho B NÃO pode ser ativado sem psicólogo com CRP ativo', async () => {
    const instId = await novoInstrumento('Instrumento Trilho B', 'teste_psicologico_satepsi');

    // Garante que não há CRP ativo neste banco de teste.
    const ativos = await adminPool.query(
      `SELECT 1 FROM psicologo_credencial WHERE crp_ativo IS TRUE`,
    );
    expect(ativos.rows).toHaveLength(0);

    await expect(
      adminPool.query(
        `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true)`,
        [instId],
      ),
    ).rejects.toThrow(/crp_ativo/i);
  });

  it('trilho B INATIVO pode existir no schema (o trilho existe, só não liga)', async () => {
    const instId = await novoInstrumento(
      'Instrumento Trilho B Inativo',
      'teste_psicologico_satepsi',
    );

    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, false) RETURNING id`,
      [instId],
    );
    expect(ver.rows[0].id).toBeDefined();
  });

  it('trilho A pode ser ativado normalmente, sem exigir CRP', async () => {
    const instId = await novoInstrumento('Instrumento Trilho A');

    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true) RETURNING id`,
      [instId],
    );
    expect(ver.rows[0].id).toBeDefined();
  });

  it('bloco sem chaveamento oposto é rejeitado no commit', async () => {
    const instId = await novoInstrumento('Instrumento Bloco Invalido');
    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao) VALUES ($1, 1) RETURNING id`,
      [instId],
    );

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

  it('bloco com UM ÚNICO item é rejeitado no commit', async () => {
    // [Fix round 1, achado #4] O gate declarava "2 a 4 itens" mas só rejeitava
    // n > 4 e só cobrava chaveamento oposto quando n >= 2 -- um bloco com
    // exatamente 1 item passava por todas as condições e virava escolha
    // forçada sem nada a escolher. O trigger é DEFERRABLE INITIALLY DEFERRED:
    // no COMMIT o bloco já está montado, então 1 item é resultado final
    // inválido, não estado intermediário de montagem.
    const instId = await novoInstrumento('Instrumento Bloco Unitario');
    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao) VALUES ($1, 1) RETURNING id`,
      [instId],
    );

    const solo = await novoItem('positivo');

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      const blk = await client.query<{ id: string }>(
        `INSERT INTO block (instrument_version_id, ordem) VALUES ($1, 1) RETURNING id`,
        [ver.rows[0].id],
      );
      await client.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 1)`, [
        blk.rows[0].id,
        solo,
      ]);
      await expect(client.query('COMMIT')).rejects.toThrow(/precisa de 2 a 4 itens/i);
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
    const instId = await novoInstrumento('Instrumento Bloco Valido');
    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao) VALUES ($1, 1) RETURNING id`,
      [instId],
    );

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
      expect(blk.rows[0].id).toBeDefined();
    } finally {
      client.release();
    }
  });

  it('UPDATE que tira a valência oposta do bloco de ORIGEM é rejeitado no commit', async () => {
    // [Fix round 1, achado #1 -- ALTO] `COALESCE(NEW.block_id, OLD.block_id)`
    // resolve para NEW.block_id em UPDATE: só o bloco de DESTINO era
    // revalidado. Mover o único item de valência oposta para outro bloco
    // deixava o bloco de ORIGEM com chaveamento único de forma permanente --
    // exatamente o ranking ipsativo que o gate existe para impedir --, por um
    // caminho de escrita plausível (console de admin remontando blocos).
    const instId = await novoInstrumento('Instrumento Bloco Movido');
    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao) VALUES ($1, 1) RETURNING id`,
      [instId],
    );

    const p1 = await novoItem('positivo');
    const p2 = await novoItem('positivo');
    const n1 = await novoItem('negativo');
    const p3 = await novoItem('positivo');
    const n2 = await novoItem('negativo');

    // Estado inicial commitado: bloco A = (p1, p2, n1) e bloco B = (p3, n2),
    // os dois válidos.
    const montar = await adminPool.connect();
    let blocoA = '';
    let blocoB = '';
    let linhaN1 = '';
    try {
      await montar.query('BEGIN');
      const a = await montar.query<{ id: string }>(
        `INSERT INTO block (instrument_version_id, ordem) VALUES ($1, 1) RETURNING id`,
        [ver.rows[0].id],
      );
      const b = await montar.query<{ id: string }>(
        `INSERT INTO block (instrument_version_id, ordem) VALUES ($1, 2) RETURNING id`,
        [ver.rows[0].id],
      );
      blocoA = a.rows[0].id;
      blocoB = b.rows[0].id;
      await montar.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 1)`, [
        blocoA,
        p1,
      ]);
      await montar.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 2)`, [
        blocoA,
        p2,
      ]);
      const bi = await montar.query<{ id: string }>(
        `INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 3) RETURNING id`,
        [blocoA, n1],
      );
      linhaN1 = bi.rows[0].id;
      await montar.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 1)`, [
        blocoB,
        p3,
      ]);
      await montar.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 2)`, [
        blocoB,
        n2,
      ]);
      await montar.query('COMMIT');
    } finally {
      montar.release();
    }

    // Agora move o ÚNICO negativo do bloco A para o bloco B. O bloco de destino
    // continua válido (p3, n2, n1); quem fica inválido é o de origem (p1, p2).
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE block_item SET block_id = $1, posicao = 3 WHERE id = $2`, [
        blocoB,
        linhaN1,
      ]);
      await expect(client.query('COMMIT')).rejects.toThrow(/chaveamento oposto/i);
    } finally {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Transação já encerrada pelo erro do COMMIT.
      }
      client.release();
    }

    // O bloco de origem continua íntegro: o COMMIT inteiro foi revertido.
    const conferencia = await adminPool.query<{ n: string; neg: string }>(
      `SELECT count(*)::text AS n,
              count(*) FILTER (WHERE i.chave_valencia = 'negativo')::text AS neg
         FROM block_item bi JOIN item i ON i.id = bi.item_id
        WHERE bi.block_id = $1`,
      [blocoA],
    );
    expect(conferencia.rows[0]).toEqual({ n: '3', neg: '1' });
  });

  it('gate 1 vale IGUAL sob o role app_runtime, que é quem escreve em produção', async () => {
    // [Fix round 1, achado #3] psicologo_credencial tem FORCE ROW LEVEL
    // SECURITY com as duas policies escopadas TO app_runtime. Enquanto a função
    // do gate não era SECURITY DEFINER, o `NOT EXISTS (...)` era filtrado por
    // RLS: sob app_runtime SEM app.tenant_id o gate bloqueava mesmo com
    // psicólogo credenciado no sistema, e COM app.tenant_id virava uma checagem
    // por tenant -- três respostas diferentes para o mesmo INSERT numa tabela
    // GLOBAL. A suíte inteira só exercitava o role owner (SUPERUSER/BYPASSRLS),
    // então a divergência era invisível. Este caso trava as duas pontas.
    const instBloqueado = await novoInstrumento(
      'Instrumento Trilho B app_runtime bloqueado',
      'teste_psicologico_satepsi',
    );

    // Ponta 1: sem nenhum CRP ativo no sistema, app_runtime é bloqueado.
    await expect(
      appPool.query(
        `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true)`,
        [instBloqueado],
      ),
    ).rejects.toThrow(/crp_ativo/i);

    // Ponta 2: com um psicólogo de CRP ativo cadastrado, app_runtime passa --
    // mesmo SEM app.tenant_id na conexão, que era exatamente o caso em que a
    // RLS escondia a credencial e o gate mentia.
    const instLiberado = await novoInstrumento(
      'Instrumento Trilho B app_runtime liberado',
      'teste_psicologico_satepsi',
    );

    let tenantId: string | undefined;
    let userId: string | undefined;
    try {
      // [Fix round 2, achado #3] Este fixture nasceu com o CNPJ 4-9 do fim da
      // faixa reservada, que o plano da Fase 2a já aloca para o spec da Task 7.
      // A colisão só não aparecia porque a Task 7 ainda não existe --
      // fixture-cnpj-uniqueness.spec.ts quebraria no dia em que ela entrasse, e
      // num arquivo sem relação com a mudança. Renumerado para o primeiro valor
      // fora da faixa que o plano reserva.
      const t = await adminPool.query<{ id: string }>(
        `INSERT INTO tenant (razao_social, cnpj, slug)
         VALUES ('Empresa Gate CRP', '00000000000052', 'test-tenant-00000000000052') RETURNING id`,
      );
      tenantId = t.rows[0].id;

      const u = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'psi.gate@example.com') RETURNING id`,
        [tenantId],
      );
      userId = u.rows[0].id;

      await adminPool.query(
        `INSERT INTO psicologo_credencial (user_id, tenant_id, crp_numero, crp_uf, crp_ativo)
         VALUES ($1, $2, '06/123456', 'SP', true)`,
        [userId, tenantId],
      );

      const ver = await appPool.query<{ id: string }>(
        `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true) RETURNING id`,
        [instLiberado],
      );
      expect(ver.rows[0].id).toBeDefined();
    } finally {
      // Limpeza no finally e ANTES de qualquer outra asserção: uma falha aqui
      // não pode deixar CRP ativo residual, que faria o PRIMEIRO caso deste
      // arquivo (e o gate consolidado da Task 13) ficar verde por acidente.
      if (userId) {
        await adminPool.query('DELETE FROM psicologo_credencial WHERE user_id = $1', [userId]);
        await adminPool.query('DELETE FROM user_account WHERE id = $1', [userId]);
      }
      if (tenantId) await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    }

    const sobrou = await adminPool.query(
      `SELECT 1 FROM psicologo_credencial WHERE crp_ativo IS TRUE`,
    );
    expect(sobrou.rows).toHaveLength(0);
  });

  it('gate 1 não é contornável reclassificando o instrumento para o trilho B', async () => {
    // [Fix round 2, achado #1 -- ALTO] O trigger de gate 1 só existia em
    // instrument_version, mas o TRILHO é lido de instrument.tipo_instrumento.
    // Criar um instrumento trilho A, ativar a versão dele legitimamente (trilho
    // A não pede CRP) e só então reclassificar o instrumento para
    // teste_psicologico_satepsi produzia uma versão SATEPSI ATIVA com zero CRP
    // ativo -- o exato estado que o gate existe para tornar impossível. E não
    // por um caminho hipotético: assessment_0002 concede UPDATE em `instrument`
    // ao app_runtime, o role que escreve em produção, então este caso roda pelo
    // appPool de propósito.
    const instId = await novoInstrumento('Instrumento Trilho A Reclassificado');
    await adminPool.query(
      `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true)`,
      [instId],
    );

    await expect(
      appPool.query(`UPDATE instrument SET tipo_instrumento = $2 WHERE id = $1`, [
        instId,
        'teste_psicologico_satepsi',
      ]),
    ).rejects.toThrow(/crp_ativo/i);

    const depois = await adminPool.query<{ tipo_instrumento: string }>(
      `SELECT tipo_instrumento FROM instrument WHERE id = $1`,
      [instId],
    );
    expect(depois.rows[0].tipo_instrumento).toBe('nao_psicologico');
  });

  it('reclassificar para o trilho B SEM versão ativa é livre — o gate recai na ativação', async () => {
    // A contrapartida do caso acima: o gate de instrument não é um veto a
    // reclassificar, é o mesmo gate de sempre olhando do outro lado da relação.
    // Sem versão ativa não há o que travar, e a exigência de CRP volta a ser
    // cobrada na hora de ativar. Sem este caso, o fix acima passaria igual se
    // tivesse sido implementado como "tipo_instrumento é imutável", que é uma
    // regra diferente e mais forte do que a Res. CFP 31/2022 art. 8 pede.
    const instId = await novoInstrumento('Instrumento Reclassificado Sem Versao Ativa');
    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, false) RETURNING id`,
      [instId],
    );

    await appPool.query(`UPDATE instrument SET tipo_instrumento = $2 WHERE id = $1`, [
      instId,
      'teste_psicologico_satepsi',
    ]);

    await expect(
      appPool.query(`UPDATE instrument_version SET ativo = true WHERE id = $1`, [ver.rows[0].id]),
    ).rejects.toThrow(/crp_ativo/i);
  });

  it('gate 2 não é contornável virando a valência de um item já dentro do bloco', async () => {
    // [Fix round 2, achado #2 -- ALTO] O round 1 fechou a COMPOSIÇÃO do bloco
    // (INSERT, UPDATE de block_id, DELETE em block_item), mas a VALÊNCIA mora
    // em `item`, e nada disparava quando ela era virada num item já commitado
    // dentro de um bloco. Virar o único 'negativo' para 'positivo' deixa o
    // bloco em 2 positivos / 0 negativos de forma permanente -- o mesmo ranking
    // ipsativo do achado de UPDATE do round 1, por outra porta. assessment_0001
    // concede UPDATE em `item` ao app_runtime, então uma correção editorial de
    // item (caminho plausível) invalidava calado todo bloco que o contivesse.
    const instId = await novoInstrumento('Instrumento Valencia Virada');
    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao) VALUES ($1, 1) RETURNING id`,
      [instId],
    );

    const pos = await novoItem('positivo');
    const neg = await novoItem('negativo');

    const montar = await adminPool.connect();
    let blocoId = '';
    try {
      await montar.query('BEGIN');
      const blk = await montar.query<{ id: string }>(
        `INSERT INTO block (instrument_version_id, ordem) VALUES ($1, 1) RETURNING id`,
        [ver.rows[0].id],
      );
      blocoId = blk.rows[0].id;
      await montar.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 1)`, [
        blocoId,
        pos,
      ]);
      await montar.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 2)`, [
        blocoId,
        neg,
      ]);
      await montar.query('COMMIT');
    } finally {
      montar.release();
    }

    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE item SET chave_valencia = 'positivo' WHERE id = $1`, [neg]);
      // Trigger de constraint DIFERIDO: a validação só dispara aqui, no COMMIT.
      await expect(client.query('COMMIT')).rejects.toThrow(/chaveamento oposto/i);
    } finally {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Transação já encerrada pelo erro do COMMIT.
      }
      client.release();
    }

    // O bloco continua íntegro: o COMMIT inteiro foi revertido.
    const conferencia = await adminPool.query<{ n: string; pos: string; neg: string }>(
      `SELECT count(*)::text AS n,
              count(*) FILTER (WHERE i.chave_valencia = 'positivo')::text AS pos,
              count(*) FILTER (WHERE i.chave_valencia = 'negativo')::text AS neg
         FROM block_item bi JOIN item i ON i.id = bi.item_id
        WHERE bi.block_id = $1`,
      [blocoId],
    );
    expect(conferencia.rows[0]).toEqual({ n: '2', pos: '1', neg: '1' });
  });

  it('troca simétrica de valência dentro do bloco é aceita no commit', async () => {
    // A contrapartida do caso acima. O gate 2 protege o CHAVEAMENTO OPOSTO do
    // bloco, não a valência individual de cada item: inverter os dois itens de
    // um bloco na mesma transação é remanejo editorial legítimo e o estado
    // final continua 1 positivo / 1 negativo. Só passa porque o trigger é
    // DEFERRABLE INITIALLY DEFERRED e enxerga o estado final no COMMIT -- uma
    // implementação IMMEDIATE barraria no meio da troca. Sem este caso, essa
    // diferença passaria despercebida.
    const instId = await novoInstrumento('Instrumento Valencia Trocada');
    const ver = await adminPool.query<{ id: string }>(
      `INSERT INTO instrument_version (instrument_id, versao) VALUES ($1, 1) RETURNING id`,
      [instId],
    );

    const pos = await novoItem('positivo');
    const neg = await novoItem('negativo');

    const montar = await adminPool.connect();
    let blocoId = '';
    try {
      await montar.query('BEGIN');
      const blk = await montar.query<{ id: string }>(
        `INSERT INTO block (instrument_version_id, ordem) VALUES ($1, 1) RETURNING id`,
        [ver.rows[0].id],
      );
      blocoId = blk.rows[0].id;
      await montar.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 1)`, [
        blocoId,
        pos,
      ]);
      await montar.query(`INSERT INTO block_item (block_id, item_id, posicao) VALUES ($1, $2, 2)`, [
        blocoId,
        neg,
      ]);
      await montar.query('COMMIT');
    } finally {
      montar.release();
    }

    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE item SET chave_valencia = 'negativo' WHERE id = $1`, [pos]);
      await client.query(`UPDATE item SET chave_valencia = 'positivo' WHERE id = $1`, [neg]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const conferencia = await adminPool.query<{ n: string; pos: string; neg: string }>(
      `SELECT count(*)::text AS n,
              count(*) FILTER (WHERE i.chave_valencia = 'positivo')::text AS pos,
              count(*) FILTER (WHERE i.chave_valencia = 'negativo')::text AS neg
         FROM block_item bi JOIN item i ON i.id = bi.item_id
        WHERE bi.block_id = $1`,
      [blocoId],
    );
    expect(conferencia.rows[0]).toEqual({ n: '2', pos: '1', neg: '1' });
  });

  it('revogar o CRP desativa a versão do trilho B que dependia dele', async () => {
    // [Fix round 2, achado #4] O gate 1 era uma checagem de INSTANTE DA
    // ATIVAÇÃO: depois de ativada, revogar o CRP (ou apagar a credencial)
    // deixava a versão SATEPSI ativa com zero CRP ativo no sistema -- o estado
    // proibido, alcançado por um evento rotineiro (CRP que caduca ou é
    // cassado). O banco não bloqueia a revogação, que é registro de fato do
    // mundo; ele desliga o instrumento privativo, que é o que a Res. CFP
    // 31/2022 art. 8 de fato exige.
    const instId = await novoInstrumento('Instrumento Trilho B CRP Revogado', 'teste_psicologico_satepsi');

    let tenantId: string | undefined;
    let userId: string | undefined;
    let versaoId = '';
    try {
      const t = await adminPool.query<{ id: string }>(
        `INSERT INTO tenant (razao_social, cnpj, slug)
         VALUES ('Empresa CRP Revogado', '00000000000053', 'test-tenant-00000000000053') RETURNING id`,
      );
      tenantId = t.rows[0].id;

      const u = await adminPool.query<{ id: string }>(
        `INSERT INTO user_account (tenant_id, email) VALUES ($1, 'psi.revogado@example.com') RETURNING id`,
        [tenantId],
      );
      userId = u.rows[0].id;

      await adminPool.query(
        `INSERT INTO psicologo_credencial (user_id, tenant_id, crp_numero, crp_uf, crp_ativo)
         VALUES ($1, $2, '06/654321', 'SP', true)`,
        [userId, tenantId],
      );

      // Ativação legítima: há CRP ativo no sistema neste momento.
      const ver = await adminPool.query<{ id: string }>(
        `INSERT INTO instrument_version (instrument_id, versao, ativo) VALUES ($1, 1, true) RETURNING id`,
        [instId],
      );
      versaoId = ver.rows[0].id;

      const antes = await adminPool.query<{ ativo: boolean }>(
        `SELECT ativo FROM instrument_version WHERE id = $1`,
        [versaoId],
      );
      expect(antes.rows[0].ativo).toBe(true);

      // O CRP caduca.
      await adminPool.query(`UPDATE psicologo_credencial SET crp_ativo = false WHERE user_id = $1`, [
        userId,
      ]);
    } finally {
      // Limpeza no finally e ANTES das asserções finais, pelo mesmo motivo do
      // caso anterior: CRP ativo residual deixaria o primeiro caso deste
      // arquivo verde por acidente.
      if (userId) {
        await adminPool.query('DELETE FROM psicologo_credencial WHERE user_id = $1', [userId]);
        await adminPool.query('DELETE FROM user_account WHERE id = $1', [userId]);
      }
      if (tenantId) await adminPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    }

    const depois = await adminPool.query<{ ativo: boolean }>(
      `SELECT ativo FROM instrument_version WHERE id = $1`,
      [versaoId],
    );
    expect(depois.rows[0].ativo).toBe(false);

    const sobrou = await adminPool.query(
      `SELECT 1 FROM psicologo_credencial WHERE crp_ativo IS TRUE`,
    );
    expect(sobrou.rows).toHaveLength(0);
  });
});
