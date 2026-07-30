import { Pool } from 'pg';

const TERMOS_CLINICOS = [
  'transtorno', 'patologia', 'sintoma', 'diagnostico', 'diagnóstico',
  'depressao', 'depressão', 'ansiedade', 'neurose', 'psicologico', 'psicológico',
  'tratamento', 'terapia', 'doenca', 'doença',
];

describe('banco de itens semeado', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await adminPool.end();
  });

  it('semeia 40 itens, 8 por domínio Big Five', async () => {
    const porDominio = await adminPool.query<{ dominio: string; n: string }>(
      `SELECT dominio, count(*) AS n FROM item WHERE banco_id = 'ipip_contextualizado' GROUP BY dominio ORDER BY dominio`,
    );
    expect(porDominio.rows).toHaveLength(5);
    for (const linha of porDominio.rows) {
      expect(Number(linha.n)).toBe(8);
    }
  });

  it('valência é balanceada 4/4 dentro de cada domínio', async () => {
    const { rows } = await adminPool.query<{ dominio: string; positivos: string; negativos: string }>(
      `SELECT dominio,
              count(*) FILTER (WHERE chave_valencia = 'positivo') AS positivos,
              count(*) FILTER (WHERE chave_valencia = 'negativo') AS negativos
         FROM item WHERE banco_id = 'ipip_contextualizado' GROUP BY dominio`,
    );
    for (const linha of rows) {
      expect(Number(linha.positivos)).toBe(4);
      expect(Number(linha.negativos)).toBe(4);
    }
  });

  it('todo item nasce em pre_teste e todo parâmetro nasce provisório', async () => {
    const naoPreTeste = await adminPool.query(
      `SELECT 1 FROM item WHERE banco_id = 'ipip_contextualizado' AND ciclo_vida <> 'pre_teste'`,
    );
    expect(naoPreTeste.rows).toHaveLength(0);

    const naoProvisorio = await adminPool.query(
      `SELECT 1 FROM item_parameter_version WHERE calibracao_versao = 'literatura_v1' AND provisorio = false`,
    );
    expect(naoProvisorio.rows).toHaveLength(0);
  });

  it('nenhum enunciado usa vocabulário clínico', async () => {
    const { rows } = await adminPool.query<{ enunciado: string }>(
      `SELECT enunciado FROM item WHERE banco_id = 'ipip_contextualizado'`,
    );
    expect(rows.length).toBeGreaterThan(0);

    const ofensores = rows
      .filter((r) => TERMOS_CLINICOS.some((t) => r.enunciado.toLowerCase().includes(t)))
      .map((r) => r.enunciado);

    expect(ofensores).toEqual([]);
  });

  it('todo enunciado é contextualizado ao trabalho', async () => {
    const { rows } = await adminPool.query<{ enunciado: string }>(
      `SELECT enunciado FROM item WHERE banco_id = 'ipip_contextualizado' AND enunciado NOT ILIKE 'No trabalho,%'`,
    );
    expect(rows).toEqual([]);
  });

  it('monta 20 blocos, todos com exatamente 2 itens e chaveamento oposto', async () => {
    const { rows } = await adminPool.query<{ block_id: string; n: string; positivos: string; negativos: string }>(
      `SELECT b.id AS block_id,
              count(*) AS n,
              count(*) FILTER (WHERE i.chave_valencia = 'positivo') AS positivos,
              count(*) FILTER (WHERE i.chave_valencia = 'negativo') AS negativos
         FROM block b
         JOIN block_item bi ON bi.block_id = b.id
         JOIN item i ON i.id = bi.item_id
        WHERE b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
        GROUP BY b.id`,
    );

    expect(rows).toHaveLength(20);
    for (const linha of rows) {
      expect(Number(linha.n)).toBe(2);
      expect(Number(linha.positivos)).toBe(1);
      expect(Number(linha.negativos)).toBe(1);
    }
  });

  it('o instrumento inicial está ativo e em modo linear', async () => {
    const { rows } = await adminPool.query<{ modo_administracao: string; ativo: boolean }>(
      `SELECT modo_administracao, ativo FROM instrument_version WHERE id = 'a55e55e0-0000-4000-8000-000000000002'`,
    );
    expect(rows[0].modo_administracao).toBe('linear');
    expect(rows[0].ativo).toBe(true);
  });
});
