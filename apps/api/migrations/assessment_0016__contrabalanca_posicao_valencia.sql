-- Contrabalanceamento de POSIÇÃO x VALÊNCIA dentro do bloco.
--
-- A assessment_0005 montou todos os 20 blocos com
--     posicao 1 -> item de chave POSITIVA
--     posicao 2 -> item de chave NEGATIVA
-- sem uma única exceção. A assessment_0013 desconfundiu ORDEM x DOMÍNIO um
-- nível acima e não tocou neste, que é o nível de dentro do bloco.
--
-- `posicao` é a ordem de APRESENTAÇÃO das alternativas: é por ela que
-- AssessmentService.responderBloco monta o array canônico que vai
-- criptografado para o silo (ORDER BY bi.posicao) e é ela que qualquer
-- superfície de aplicação vai usar para desenhar as duas opções. Com a
-- valência colada à posição, dois estragos:
--
--   (a) DISTORÇÃO TRIVIAL. "aponte sempre a PRIMEIRA alternativa como MAIS"
--       -- estratégia que não lê o enunciado, não processa conteúdo nenhum
--       e não exige saber o que o instrumento mede -- devolve escore alto
--       nas cinco dimensões ao mesmo tempo (θ ≈ +1,35 em cada uma, medido
--       ponta a ponta pela API antes desta migration). O MFC de chaveamento
--       oposto foi escolhido justamente para DIFICULTAR distorção; com o
--       confundimento ele não dificulta nada.
--
--   (b) CONTAMINAÇÃO DA CALIBRAÇÃO. Qualquer viés de posição (primazia,
--       preferência pela primeira opção, varredura visual apressada) carrega
--       INTEIRO sobre o contraste escorado, e no MESMO sentido em todos os
--       blocos. Quando a calibration_run real rodar, esse viés entra dentro
--       das estimativas de `a` e `b` sem nenhuma forma de separá-lo depois.
--       É o mesmo argumento da assessment_0013, um nível abaixo.
--
-- CORREÇÃO: inverter a posição dos dois itens em METADE dos blocos, com a
-- metade escolhida de modo que a valência-na-posição-1 fique balanceada em
-- TRÊS eixos ao mesmo tempo:
--
--   * DOMÍNIO -- exatamente 2 dos 4 blocos de cada domínio invertidos. É
--     isto que zera o escore de um respondente cego a conteúdo: ele empurra
--     a dimensão para o polo alto em 2 blocos e para o polo baixo em 2.
--   * DIFICULDADE -- 2 ou 3 blocos por slot de limiar (a assessment_0012
--     espalhou os limiares de cada domínio em 4 slots). Sem este eixo o viés
--     de posição recairia sobre uma faixa específica de `b`, e seriam sempre
--     os mesmos itens a receber o empurrão na calibração.
--   * POSIÇÃO SERIAL -- a média de `ordem` dos invertidos é 10,5, idêntica à
--     dos não invertidos, e não há dois blocos invertidos consecutivos.
--     Fadiga e efeito de prática não se alinham com a inversão.
--
-- Conjunto escolhido (numeração de `ordem` já é a da assessment_0013), e a
-- tabela inteira para que a checagem dos três eixos seja auditável linha a
-- linha em vez de exigir confiança na aritmética:
--
--   ordem | domínio           | slot de limiar | inverte
--       1 | conscienciosidade |       1        |  sim
--       2 | extroversao       |       2        |  não
--       3 | amabilidade       |       3        |  sim
--       4 | estabilidade      |       4        |  não
--       5 | abertura          |       1        |  sim
--       6 | conscienciosidade |       2        |  não
--       7 | extroversao       |       3        |  sim
--       8 | amabilidade       |       4        |  não
--       9 | estabilidade      |       1        |  sim
--      10 | abertura          |       2        |  não
--      11 | conscienciosidade |       3        |  não
--      12 | extroversao       |       4        |  sim
--      13 | amabilidade       |       1        |  não
--      14 | estabilidade      |       2        |  sim
--      15 | abertura          |       3        |  não
--      16 | conscienciosidade |       4        |  sim
--      17 | extroversao       |       1        |  não
--      18 | amabilidade       |       2        |  sim
--      19 | estabilidade      |       3        |  não
--      20 | abertura          |       4        |  sim
--
--   por domínio: 2 invertidos de 4 (todos os cinco)
--   por slot:    3, 2, 2, 3 invertidos de 5
--
-- O QUE ESTA MIGRATION NÃO CORRIGE: viés de posição continua existindo como
-- fenômeno; o contrabalanceamento faz com que ele deixe de se somar sempre
-- no mesmo sentido, e passe a ser separável do traço na calibração. Ele não
-- desaparece.
--
-- JANELA: item_response, assessment_result e assessment_application estão em
-- 0 linhas (conferido antes de escrever esta migration). A escoragem é por
-- VALÊNCIA e não por posição, então trocar `posicao` não reescreve nem
-- invalida resposta nenhuma já gravada -- mas mudar a ordem de apresentação
-- no meio de uma coleta muda as condições de aplicação da amostra, e a
-- amostra de calibração é exatamente o que a forma linear existe para
-- produzir. Gratuito agora; depois, não.

CREATE TEMP TABLE inverte_posicao (ordem integer PRIMARY KEY) ON COMMIT DROP;

INSERT INTO inverte_posicao (ordem)
VALUES (1), (3), (5), (7), (9), (12), (14), (16), (18), (20);

-- Desvio para 11/12 antes da troca: uq_block_posicao (block_id, posicao) é
-- UNIQUE NÃO adiável, verificada linha a linha DENTRO do mesmo UPDATE -- uma
-- troca direta (posicao = 3 - posicao) colidiria no meio do caminho, quando a
-- primeira linha do bloco já chegou ao destino e a segunda ainda não saiu.
UPDATE block_item bi
   SET posicao = bi.posicao + 10
  FROM block b
 WHERE b.id = bi.block_id
   AND b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
   AND b.ordem IN (SELECT ordem FROM inverte_posicao);

UPDATE block_item bi
   SET posicao = 13 - bi.posicao
  FROM block b
 WHERE b.id = bi.block_id
   AND b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
   AND bi.posicao > 10;

-- Prova de que a troca fechou nos três eixos. Não é comentário: é a mesma
-- checagem que a spec faz, rodando aqui para que a migration não possa
-- terminar com o instrumento em estado intermediário.
DO $$
DECLARE
  fora_de_faixa integer;
  negativo_primeiro integer;
  desbalanceado text;
BEGIN
  -- Nenhuma linha pode ter sobrado no desvio.
  SELECT count(*) INTO fora_de_faixa
    FROM block_item bi
    JOIN block b ON b.id = bi.block_id
   WHERE b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
     AND bi.posicao NOT IN (1, 2);
  IF fora_de_faixa > 0 THEN
    RAISE EXCEPTION 'contrabalanceamento nao fechou: % linha(s) de block_item fora de {1,2}', fora_de_faixa;
  END IF;

  -- Metade exata dos blocos abre com item de chave negativa.
  SELECT count(*) INTO negativo_primeiro
    FROM block b
    JOIN block_item bi ON bi.block_id = b.id AND bi.posicao = 1
    JOIN item i ON i.id = bi.item_id
   WHERE b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
     AND i.chave_valencia = 'negativo';
  IF negativo_primeiro <> 10 THEN
    RAISE EXCEPTION 'contrabalanceamento nao fechou: % blocos abrem com item negativo, esperado 10', negativo_primeiro;
  END IF;

  -- Eixo DOMÍNIO: exatamente 2 de 4 em cada um dos cinco.
  SELECT string_agg(t.dominio || '=' || t.n, ', ' ORDER BY t.dominio) INTO desbalanceado
    FROM (
      SELECT i.dominio, count(*) FILTER (WHERE i.chave_valencia = 'negativo') AS n
        FROM block b
        JOIN block_item bi ON bi.block_id = b.id AND bi.posicao = 1
        JOIN item i ON i.id = bi.item_id
       WHERE b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
       GROUP BY i.dominio
    ) t
   WHERE t.n <> 2;
  IF desbalanceado IS NOT NULL THEN
    RAISE EXCEPTION 'contrabalanceamento desbalanceado por dominio (esperado 2 de 4 em cada): %', desbalanceado;
  END IF;

  -- Eixo DIFICULDADE: 2 ou 3 por slot de limiar efetivo dentro do domínio.
  SELECT string_agg(t.slot || '=' || t.n, ', ' ORDER BY t.slot) INTO desbalanceado
    FROM (
      SELECT s.slot, count(*) FILTER (WHERE s.abre_negativo) AS n
        FROM (
          SELECT b.id,
                 rank() OVER (
                   PARTITION BY max(i.dominio)
                   ORDER BY sum(p.a * p.b) / sum(p.a)
                 ) AS slot,
                 bool_or(bi.posicao = 1 AND i.chave_valencia = 'negativo') AS abre_negativo
            FROM block b
            JOIN block_item bi ON bi.block_id = b.id
            JOIN item i ON i.id = bi.item_id
            JOIN item_parameter_version p
              ON p.item_id = i.id AND p.calibracao_versao = 'literatura_v1'
           WHERE b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
           GROUP BY b.id
        ) s
       GROUP BY s.slot
    ) t
   WHERE t.n NOT BETWEEN 2 AND 3;
  IF desbalanceado IS NOT NULL THEN
    RAISE EXCEPTION 'contrabalanceamento desbalanceado por slot de dificuldade (esperado 2 ou 3 de 5): %', desbalanceado;
  END IF;
END
$$;
