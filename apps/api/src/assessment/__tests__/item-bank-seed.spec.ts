import { Pool } from 'pg';
import {
  decomporBlocoEmPares,
  escoreBrutoPorDimensao,
  estimarThetaEAP,
  ItemNoBloco,
} from '../scoring/mfc-scoring';
import {
  INSTRUMENT_VERSION_SEMEADA,
  ITENS_SEMEADOS,
  TODOS_OS_ITENS,
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

  it('nenhum enunciado usa vocabulário clínico -- BANCO INTEIRO, não só o seed', async () => {
    // Escopo deliberadamente ABERTO (TODOS_OS_ITENS, não ITENS_SEMEADOS):
    // a Res. CFP 31/2022 fala de todo enunciado que um candidato pode ler, e
    // o instrumento semeado deixará de ser o único quando a Task 10 criar o
    // instrument_version do modo CAT. Ver seed-scope.ts.
    const { rows } = await adminPool.query<{ enunciado: string }>(
      `WITH todos AS (${TODOS_OS_ITENS}) SELECT enunciado FROM todos`,
    );
    // Cobertura mínima, não exata: o banco tem PELO MENOS os 40 semeados.
    // Igualdade aqui reintroduziria a fragilidade de cardinalidade que este
    // escopo existe para evitar.
    expect(rows.length).toBeGreaterThanOrEqual(40);

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

  /**
   * POSIÇÃO x VALÊNCIA (assessment_0016).
   *
   * O teste acima confere que todo bloco TEM um item de cada valência --
   * e passava verde enquanto os 20 blocos abriam, sem exceção, pelo item
   * positivo. `posicao` é a ordem de apresentação: com ela colada à
   * valência, "aponte sempre a primeira alternativa como MAIS" -- que não
   * lê o enunciado -- devolvia θ ≈ +1,35 nas cinco dimensões.
   *
   * A conferência é POR DOMÍNIO, não no agregado: 10/10 no total poderia
   * esconder um domínio inteiro confundido, compensado por outro. São os
   * 2 de 4 DENTRO do domínio que zeram o escore de quem responde por
   * posição -- ver o teste de comportamento mais abaixo.
   */
  it('a valência não é previsível pela posição de apresentação', async () => {
    const { rows } = await adminPool.query<{ dominio: string; abre_negativo: string; n: string }>(
      `SELECT i.dominio,
              count(*) FILTER (WHERE i.chave_valencia = 'negativo') AS abre_negativo,
              count(*) AS n
         FROM block b
         JOIN block_item bi ON bi.block_id = b.id AND bi.posicao = 1
         JOIN item i ON i.id = bi.item_id
        WHERE b.instrument_version_id = '${INSTRUMENT_VERSION_SEMEADA}'
        GROUP BY i.dominio`,
    );

    expect(rows).toHaveLength(5);
    for (const linha of rows) {
      expect(Number(linha.n)).toBe(4);
      expect(Number(linha.abre_negativo)).toBe(2);
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

  /**
   * RESPONDENTE CEGO A CONTEÚDO -- a guarda de comportamento da
   * assessment_0016.
   *
   * `blocos[].itemIds` vem `ORDER BY b.ordem, bi.posicao`, então
   * `itemIds[0]` é literalmente a primeira alternativa apresentada. Este
   * teste responde o instrumento inteiro pela POSIÇÃO, sem olhar o
   * enunciado, o domínio ou a valência -- as duas estratégias possíveis --
   * e exige que nenhuma delas produza escore. Antes do contrabalanceamento
   * "sempre a primeira" devolvia θ ≈ +1,35 SIMULTANEAMENTE nas cinco
   * dimensões, isto é, o perfil máximo sem processar conteúdo nenhum.
   *
   * O teste de contagem lá em cima (2 de 4 por domínio) prende a CAUSA;
   * este prende o EFEITO, que é o que de fato importa e o que continuaria
   * valendo se um dia o instrumento semeado mudar de tamanho.
   */
  it('responder sempre pela POSIÇÃO não escora em dimensão nenhuma', () => {
    for (const posicaoFixa of [0, 1]) {
      const comparacoes = blocos.flatMap((bloco) =>
        decomporBlocoEmPares({
          blockId: `bloco-${bloco.ordem}`,
          itemIds: bloco.itemIds,
          maisId: bloco.itemIds[posicaoFixa],
          menosId: bloco.itemIds[1 - posicaoFixa],
        }),
      );

      for (const dominio of dominios) {
        // Escore bruto é contagem de endosso chaveada, sem parâmetro: com
        // 2 dos 4 blocos do domínio invertidos ele fecha em ZERO por
        // construção, qualquer que seja a calibração.
        expect(escoreBrutoPorDimensao(comparacoes, dominio, itens)).toBe(0);

        // E o θ estimado não pode cair em faixa nenhuma do relatório --
        // o corte de "alto"/"baixo" em report.service.ts é ±0,5.
        const { theta } = estimarThetaEAP(comparacoes, dominio, itens);
        expect(Math.abs(theta)).toBeLessThan(0.5);
      }
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
