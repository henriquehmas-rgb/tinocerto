-- Duas correções na janela em que ainda são gratuitas (zero item_response,
-- zero assessment_result -- confirmado antes de escrever esta migration).
-- Depois que a amostra de calibração começar a ser coletada, a primeira
-- delas passa a ser IRRECUPERÁVEL.

-- ============================================================
-- 1. Desconfunde ordem de administração x domínio
-- ============================================================
-- O seed da 0005 numerou os blocos com `ordem_global := ordem_global + 1`
-- DENTRO do laço de domínio, então a ordem ficou perfeitamente confundida
-- com o construto: blocos 1-4 conscienciosidade, 5-8 extroversão, 9-12
-- amabilidade, 13-16 estabilidade, 17-20 abertura. A Task 9 serve os blocos
-- com ORDER BY min(b.ordem), então é exatamente assim que o candidato
-- responde. Dois problemas:
--
--   (a) FAKING. Quatro blocos seguidos sobre planejamento e organização
--       deixam óbvio o construto medido. Num contexto de seleção isso é a
--       condição que MAXIMIZA faking-good -- e o MFC de chaveamento oposto
--       foi escolhido justamente para dificultar distorção. Agrupar por
--       domínio devolve boa parte dessa vantagem de graça.
--
--   (b) CONTAMINAÇÃO DA CALIBRAÇÃO. Posição no instrumento vira função
--       determinística do domínio, então qualquer efeito de posição
--       (fadiga, prática, carryover, mudança de set de resposta) carrega
--       inteiro sobre as estimativas de parâmetro daquele domínio quando a
--       calibration_run real rodar -- sem nenhuma forma de separar os dois
--       depois. Como a coleta em forma fixa existe PARA calibrar, isso
--       atacaria o próprio motivo de o instrumento rodar linear primeiro.
--
-- Correção: quadrado latino sobre (domínio x slot de dificuldade). A 0012
-- espalhou os limiares dentro de cada domínio em 4 slots; aqui a ordem passa
-- a percorrer os 5 domínios intercalados, e o slot de dificuldade cicla junto,
-- de modo que NEM domínio NEM dificuldade fica correlacionado com posição.
-- Cada par (domínio, slot) aparece exatamente uma vez.
--
-- Mapeamento explícito (e não aritmética modular em SQL) para ser auditável
-- linha a linha. Origem: ordem antiga = dominio_idx*4 + slot + 1.
-- Destino:  ordem nova  = 5*((slot - dominio_idx) mod 4) + dominio_idx + 1.
--
--   nova | domínio           | slot      (sequência resultante)
--      1 | conscienciosidade | 0
--      2 | extroversao       | 1
--      3 | amabilidade       | 2
--      4 | estabilidade      | 3
--      5 | abertura          | 0
--      6 | conscienciosidade | 1   ... e assim por diante, ciclando
--
CREATE TEMP TABLE remapeia_ordem (de integer PRIMARY KEY, para integer NOT NULL)
  ON COMMIT DROP;

INSERT INTO remapeia_ordem (de, para) VALUES
  ( 1,  1), ( 2,  6), ( 3, 11), ( 4, 16),   -- conscienciosidade, slots 0..3
  ( 5, 17), ( 6,  2), ( 7,  7), ( 8, 12),   -- extroversao
  ( 9, 13), (10, 18), (11,  3), (12,  8),   -- amabilidade
  (13,  9), (14, 14), (15, 19), (16,  4),   -- estabilidade
  (17,  5), (18, 10), (19, 15), (20, 20);   -- abertura

-- Desvio temporário para +1000: block tem UNIQUE (instrument_version_id,
-- ordem), então uma renumeração direta colidiria no meio do caminho.
UPDATE block SET ordem = ordem + 1000
 WHERE instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002';

UPDATE block b
   SET ordem = r.para
  FROM remapeia_ordem r
 WHERE b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
   AND b.ordem = r.de + 1000;

-- Prova de que a renumeração fechou: nenhum bloco pode ter sobrado no
-- desvio, e não pode haver dois blocos consecutivos do mesmo domínio.
DO $$
DECLARE
  sobrou integer;
  vizinhos integer;
BEGIN
  SELECT count(*) INTO sobrou
    FROM block
   WHERE instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
     AND ordem > 1000;
  IF sobrou > 0 THEN
    RAISE EXCEPTION 'remapeamento incompleto: % bloco(s) ficaram no desvio +1000', sobrou;
  END IF;

  SELECT count(*) INTO vizinhos
    FROM (
      SELECT i.dominio,
             lag(i.dominio) OVER (ORDER BY b.ordem) AS dominio_anterior
        FROM block b
        JOIN block_item bi ON bi.block_id = b.id
        JOIN item i ON i.id = bi.item_id
       WHERE b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
       GROUP BY b.ordem, i.dominio
    ) seq
   WHERE seq.dominio = seq.dominio_anterior;

  IF vizinhos > 0 THEN
    RAISE EXCEPTION 'ainda existem % par(es) de blocos consecutivos do mesmo dominio', vizinhos;
  END IF;
END
$$;

-- ============================================================
-- 2. `banco_id` vira discriminador de verdade
-- ============================================================
-- O linter de vocabulário clínico precisa varrer "todo item que um candidato
-- pode ler" -- é isso que a Res. CFP 31/2022 obriga. Nenhum dos dois escopos
-- usados até agora entrega isso:
--
--   - `banco_id = 'ipip_contextualizado'` é o DEFAULT da coluna, então
--     qualquer fixture de teste cai no mesmo balde e o linter passa a
--     depender de dado de teste;
--   - "itens de um instrument_version específico" perde item que exista no
--     banco mas ainda não esteja blocado, e perde o segundo instrument_version
--     que a Task 10 (modo CAT) cria.
--
-- Dando aos 40 itens semeados um banco_id NÃO-default, ele passa a ser um
-- discriminador real: fixture nenhuma o herda por acidente, e o linter pode
-- varrer o banco inteiro em vez de um instrumento.
UPDATE item
   SET banco_id = 'seed_ipip_v1'
 WHERE id IN (
   SELECT DISTINCT bi.item_id
     FROM block b
     JOIN block_item bi ON bi.block_id = b.id
    WHERE b.instrument_version_id = 'a55e55e0-0000-4000-8000-000000000002'
 );

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM item WHERE banco_id = 'seed_ipip_v1';
  IF n <> 40 THEN
    RAISE EXCEPTION 'esperados 40 itens em seed_ipip_v1, encontrados %', n;
  END IF;
END
$$;
