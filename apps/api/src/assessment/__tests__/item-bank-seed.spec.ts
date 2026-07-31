import { Pool } from 'pg';
import { decomporBlocoEmPares, estimarThetaEAP, ItemNoBloco } from '../scoring/mfc-scoring';
import {
  INSTRUMENT_VERSION_SEMEADA,
  ITENS_SEMEADOS,
  TERMOS_CLINICOS,
} from './seed-scope';

describe('banco de itens semeado', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await adminPool.end();
  });

  it('semeia 40 itens, 8 por domínio Big Five', async () => {
    const porDominio = await adminPool.query<{ dominio: string; n: string }>(
      `WITH semeados AS (${ITENS_SEMEADOS})
       SELECT dominio, count(*) AS n FROM semeados GROUP BY dominio ORDER BY dominio`,
    );
    expect(porDominio.rows).toHaveLength(5);
    for (const linha of porDominio.rows) {
      expect(Number(linha.n)).toBe(8);
    }
  });

  it('valência é balanceada 4/4 dentro de cada domínio', async () => {
    const { rows } = await adminPool.query<{ dominio: string; positivos: string; negativos: string }>(
      `WITH semeados AS (${ITENS_SEMEADOS})
       SELECT dominio,
              count(*) FILTER (WHERE chave_valencia = 'positivo') AS positivos,
              count(*) FILTER (WHERE chave_valencia = 'negativo') AS negativos
         FROM semeados GROUP BY dominio`,
    );
    expect(rows).toHaveLength(5);
    for (const linha of rows) {
      expect(Number(linha.positivos)).toBe(4);
      expect(Number(linha.negativos)).toBe(4);
    }
  });

  it('todo item nasce em pre_teste e todo parâmetro nasce provisório', async () => {
    const naoPreTeste = await adminPool.query(
      `WITH semeados AS (${ITENS_SEMEADOS})
       SELECT 1 FROM semeados WHERE ciclo_vida <> 'pre_teste'`,
    );
    expect(naoPreTeste.rows).toHaveLength(0);

    // Escopado aos itens do seed, e não a `calibracao_versao = 'literatura_v1'`
    // solto: item-bank-schema.spec.ts também grava uma linha com esse rótulo,
    // no item de fixture DELA.
    const naoProvisorio = await adminPool.query(
      `WITH semeados AS (${ITENS_SEMEADOS})
       SELECT 1 FROM item_parameter_version p
        WHERE p.item_id IN (SELECT id FROM semeados) AND p.provisorio = false`,
    );
    expect(naoProvisorio.rows).toHaveLength(0);
  });

  it('nenhum enunciado usa vocabulário clínico', async () => {
    const { rows } = await adminPool.query<{ enunciado: string }>(
      `WITH semeados AS (${ITENS_SEMEADOS}) SELECT enunciado FROM semeados`,
    );
    expect(rows).toHaveLength(40);

    const ofensores = rows
      .filter((r) => TERMOS_CLINICOS.some((t) => r.enunciado.toLowerCase().includes(t)))
      .map((r) => r.enunciado);

    expect(ofensores).toEqual([]);
  });

  it('todo enunciado é contextualizado ao trabalho', async () => {
    const { rows } = await adminPool.query<{ enunciado: string }>(
      `WITH semeados AS (${ITENS_SEMEADOS})
       SELECT enunciado FROM semeados WHERE enunciado NOT ILIKE 'No trabalho,%'`,
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
        WHERE b.instrument_version_id = '${INSTRUMENT_VERSION_SEMEADA}'
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
      `SELECT modo_administracao, ativo FROM instrument_version WHERE id = '${INSTRUMENT_VERSION_SEMEADA}'`,
    );
    expect(rows[0].modo_administracao).toBe('linear');
    expect(rows[0].ativo).toBe(true);
  });
});

/**
 * INFORMAÇÃO DO INSTRUMENTO SEMEADO.
 *
 * Nada na suíte olhava para ONDE na escala o instrumento informa -- e foi
 * exatamente ali que ele estava quebrado. Num bloco de chaveamento oposto o
 * ponto 50/50 é o limiar efetivo
 *
 *     L = (a+ b+ + a- b-) / (a+ + a-)
 *
 * a MÉDIA PONDERADA das duas dificuldades. Escolhendo `b` item a item e
 * pareando os blocos por ordem alfabética, como a assessment_0005 fazia, os
 * 20 limiares colapsaram em [-0,153; +0,353]: fora dessa faixa de meio ponto
 * o instrumento não separava ninguém, e θ verdadeiro -2, -1,5, -1 e -0,5
 * devolviam todos o MESMO θ estimado. A assessment_0012 redesenhou `b` em
 * torno de L ∈ {-1; -0,35; +0,35; +1} por domínio. Estes casos são a guarda
 * que impede a regressão -- contagem e balanceamento de itens não veem essa
 * classe de defeito.
 */
describe('informação do instrumento semeado', () => {
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

  interface Bloco {
    ordem: number;
    dominio: string;
    itemIds: string[];
    limiarEfetivo: number;
  }

  let itens: Record<string, ItemNoBloco> = {};
  let blocos: Bloco[] = [];
  let dominios: string[] = [];

  beforeAll(async () => {
    const { rows } = await adminPool.query<{
      ordem: number;
      dominio: string;
      chave_valencia: 'positivo' | 'negativo';
      a: string;
      b: string;
      item_id: string;
    }>(
      `SELECT b.ordem, i.dominio, i.chave_valencia, p.a, p.b, i.id AS item_id
         FROM block b
         JOIN block_item bi ON bi.block_id = b.id
         JOIN item i ON i.id = bi.item_id
         JOIN item_parameter_version p ON p.item_id = i.id AND p.calibracao_versao = 'literatura_v1'
        WHERE b.instrument_version_id = '${INSTRUMENT_VERSION_SEMEADA}'
        ORDER BY b.ordem, bi.posicao`,
    );

    itens = {};
    const porOrdem = new Map<number, Bloco>();

    for (const r of rows) {
      itens[r.item_id] = {
        itemId: r.item_id,
        dominio: r.dominio,
        valencia: r.chave_valencia,
        params: { a: Number(r.a), b: Number(r.b), c: 0 },
      };
      const atual = porOrdem.get(r.ordem) ?? {
        ordem: r.ordem,
        dominio: r.dominio,
        itemIds: [],
        limiarEfetivo: 0,
      };
      atual.itemIds.push(r.item_id);
      porOrdem.set(r.ordem, atual);
    }

    for (const bloco of porOrdem.values()) {
      const [x, y] = bloco.itemIds.map((id) => itens[id]);
      const pos = x.valencia === 'positivo' ? x : y;
      const neg = x.valencia === 'positivo' ? y : x;
      bloco.limiarEfetivo =
        (pos.params.a * pos.params.b + neg.params.a * neg.params.b) / (pos.params.a + neg.params.a);
    }

    blocos = [...porOrdem.values()].sort((p, q) => p.ordem - q.ordem);
    dominios = [...new Set(blocos.map((b) => b.dominio))];
  });

  afterAll(async () => {
    await adminPool.end();
  });

  it('parâmetros ficam nas faixas que a migration declara', async () => {
    const { rows } = await adminPool.query<{ a_min: string; a_max: string; b_min: string; b_max: string }>(
      `SELECT min(p.a) AS a_min, max(p.a) AS a_max, min(p.b) AS b_min, max(p.b) AS b_max
         FROM item_parameter_version p
        WHERE p.item_id IN (SELECT id FROM (${ITENS_SEMEADOS}) s)
          AND p.calibracao_versao = 'literatura_v1'`,
    );
    const { a_min, a_max, b_min, b_max } = rows[0];

    // a ~ 0,9-1,5 (cabeçalho da assessment_0005).
    expect(Number(a_min)).toBeGreaterThanOrEqual(0.9);
    expect(Number(a_max)).toBeLessThanOrEqual(1.5);

    // b ~ -1,5 a +1,5, e USANDO a faixa toda -- o defeito antigo era o
    // cabeçalho prometer -1,5..+1,5 enquanto o dado ia de -0,60 a +0,70.
    expect(Number(b_min)).toBeGreaterThanOrEqual(-1.5);
    expect(Number(b_max)).toBeLessThanOrEqual(1.5);
    expect(Number(b_min)).toBeLessThanOrEqual(-1.4);
    expect(Number(b_max)).toBeGreaterThanOrEqual(1.4);
  });

  it('os limiares efetivos dos blocos varrem a escala em cada domínio', () => {
    expect(blocos).toHaveLength(20);
    expect(dominios).toHaveLength(5);

    for (const dominio of dominios) {
      const limiares = blocos.filter((b) => b.dominio === dominio).map((b) => b.limiarEfetivo);
      expect(limiares).toHaveLength(4);

      const menor = Math.min(...limiares);
      const maior = Math.max(...limiares);

      // Com o seed antigo a amplitude por domínio ia de 0,135 a 0,474.
      expect(maior - menor).toBeGreaterThanOrEqual(1.5);
      expect(menor).toBeLessThanOrEqual(-0.7);
      expect(maior).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('o θ estimado acompanha o θ verdadeiro ao longo da escala', () => {
    const verdadeiros = [-1.5, -0.5, 0.5, 1.5];

    /** Respondente modal: em cada bloco aponta o lado que o modelo prevê. */
    function respostasModais(thetaVerdadeiro: number) {
      return blocos.flatMap((bloco) => {
        const [x, y] = bloco.itemIds.map((id) => itens[id]);
        const aEfetivo = (it: ItemNoBloco) =>
          it.valencia === 'positivo' ? it.params.a : -it.params.a;
        const uX = aEfetivo(x) * (thetaVerdadeiro - x.params.b);
        const uY = aEfetivo(y) * (thetaVerdadeiro - y.params.b);
        return decomporBlocoEmPares({
          blockId: `bloco-${bloco.ordem}`,
          itemIds: bloco.itemIds,
          maisId: uX >= uY ? x.itemId : y.itemId,
          menosId: uX >= uY ? y.itemId : x.itemId,
        });
      });
    }

    for (const dominio of dominios) {
      const estimados = verdadeiros.map(
        (tv) => estimarThetaEAP(respostasModais(tv), dominio, itens).theta,
      );

      for (let i = 1; i < estimados.length; i++) {
        // Estritamente crescente E com separação de verdade. Com o seed
        // antigo θ verdadeiro -1,5 e -0,5 produziam o MESMO padrão modal e
        // portanto o MESMO θ estimado -- este passo valia exatamente 0.
        expect(estimados[i] - estimados[i - 1]).toBeGreaterThanOrEqual(0.4);
      }

      // E o instrumento chega às pontas, em vez de saturar no meio.
      expect(estimados[0]).toBeLessThanOrEqual(-0.9);
      expect(estimados[estimados.length - 1]).toBeGreaterThanOrEqual(0.9);
    }
  });
});
