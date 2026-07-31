-- [Fix round 2 da Task 10 -- achado residual do revisor independente]
--
-- Mesma restricao de sempre: o runner (apps/api/scripts/migrate.ts) registra
-- migration aplicada por NOME, sem checksum. Editar a assessment_0014, ja
-- aplicada, deixaria banco e repositorio divergentes de forma permanente e
-- silenciosa. A funcao e redefinida aqui com CREATE OR REPLACE.
--
-- O ACHADO: a assessment_0014 fechou o flanco de item_parameter_version, mas
-- resolveu o item afetado de forma ASSIMETRICA --
--
--   IF TG_OP = 'DELETE' THEN item_alvo := OLD.item_id;
--   ELSE                     item_alvo := NEW.item_id;  -- INSERT *e* UPDATE
--
-- Num UPDATE que REAPONTA a linha de calibracao para outro item
-- (UPDATE item_parameter_version SET item_id = <outro>), so as
-- instrument_version que contem o item NOVO sao validadas. As que contem o
-- item ANTIGO -- justamente aquelas de quem o parametro esta sendo tirado --
-- nunca sao visitadas.
--
-- Consequencia concreta, reproduzida ao vivo: com uma versao CAT legitima no
-- ar (tudo calibrado), reapontar a linha vigente de um item DE DENTRO para um
-- item DE FORA deixa aquela versao CAT com um item de ZERO parametros. E
-- exatamente o estado (a) que o predicado da 0014 foi escrito para proibir --
-- e um item que a selecao por maxima informacao de Fisher nem consegue
-- pontuar. A transacao commitava limpa; nem sob SET CONSTRAINTS ALL IMMEDIATE
-- havia excecao.
--
-- E o ramo aberto era o unico que a aplicacao alcanca: app_runtime tem
-- INSERT/SELECT/UPDATE em item_parameter_version, mas NAO tem DELETE. O ramo
-- coberto (DELETE) era inalcancavel pelo papel da aplicacao; o descoberto
-- (UPDATE) era a unica mutacao que ela pode fazer.
--
-- A CORRECAO e simetrica por construcao: o UPDATE valida a UNIAO dos dois
-- lados. Nao ha mais TG_OP escolhendo UM item -- ha um conjunto de itens
-- afetados, e todo item afetado tem suas versoes visitadas. Quando o item_id
-- nao muda (o caso comum: virar provisorio = true), OLD.item_id = NEW.item_id
-- e o DISTINCT do SELECT abaixo dedupla -- custo zero.
CREATE OR REPLACE FUNCTION assert_ipv_nao_burla_cat()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  itens_afetados uuid[];
  alvo           uuid;
BEGIN
  -- OLD nao existe em INSERT e NEW nao existe em DELETE; referenciar o campo
  -- errado e erro de execucao, entao os tres casos sao montados explicitamente
  -- em vez de num CASE dentro da consulta.
  IF TG_OP = 'INSERT' THEN
    itens_afetados := ARRAY[NEW.item_id];
  ELSIF TG_OP = 'DELETE' THEN
    itens_afetados := ARRAY[OLD.item_id];
  ELSE
    itens_afetados := ARRAY[OLD.item_id, NEW.item_id];
  END IF;

  FOR alvo IN
    SELECT DISTINCT b.instrument_version_id
      FROM block_item bi
      JOIN block b ON b.id = bi.block_id
     WHERE bi.item_id = ANY (itens_afetados)
  LOOP
    PERFORM valida_cat_calibrado(alvo);
  END LOOP;

  RETURN NULL;
END
$fn$;
