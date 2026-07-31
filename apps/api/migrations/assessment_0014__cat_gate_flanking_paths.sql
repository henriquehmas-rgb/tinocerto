-- [Fix round 1 da Task 10 -- achado #1 (alto) do revisor independente]
--
-- Mesma restricao ja documentada em assessment_0010: o runner
-- (apps/api/scripts/migrate.ts) registra migration aplicada por NOME, sem
-- checksum. Editar a assessment_0006, ja aplicada, deixaria banco e
-- repositorio divergentes de forma permanente e silenciosa. A funcao existente
-- e redefinida aqui com CREATE OR REPLACE.
--
-- O ACHADO: a trava do CAT so era avaliada na escrita de instrument_version.
-- A ordem NATURAL de versionar um instrumento contorna isso inteiro:
--   1. INSERT instrument_version (... modo_administracao = 'cat')  -- 0 blocos,
--      logo 0 itens provisorios, logo o gate deixa passar;
--   2. INSERT block             -- nenhum trigger olhava por aqui;
--   3. INSERT block_item        -- nenhum trigger olhava por aqui.
-- Resultado: instrument_version em modo CAT com N itens de parametro
-- provisorio -- exatamente o estado que a Fase 2a existe para tornar
-- impossivel. Reproduzido ao vivo (transacao revertida): versao 99 em 'cat'
-- com 2 itens provisorios anexados, sem uma unica excecao.
--
-- E o MESMO tema do fix da Task 3 (assessment_0010): o gate cobria a TABELA
-- onde o trigger estava pendurado, nao a PERGUNTA que ele faz. Os caminhos de
-- flanco -- escritas em block, block_item e item_parameter_version -- mudam a
-- resposta da pergunta sem tocar em instrument_version.
--
-- POR QUE IMPORTA (nao e formalismo): com parametros de literatura, a selecao
-- por maxima informacao de Fisher escolhe os itens errados E contamina a
-- amostra da propria calibracao futura (missing-not-at-random). A trava e no
-- banco justamente para que nao exista caminho em que o CAT ligue cedo demais.

-- ---------------------------------------------------------------------------
-- Fonte UNICA da pergunta do gate. Tres copias do mesmo predicado seriam tres
-- oportunidades de divergirem -- que e como o gate ficou com furo em primeiro
-- lugar. Mesmo padrao de valida_bloco_mfc (assessment_0010).
--
-- DUAS MUDANCAS DE SEMANTICA, ambas na direcao FAIL-CLOSED, porque este e um
-- gate de seguranca e a duvida tem de bloquear:
--
--   (a) item SEM NENHUMA calibracao passa a contar como nao-pronto. A
--       assessment_0006 fazia JOIN com item_parameter_version, entao um item
--       sem nenhuma linha de parametro simplesmente sumia da contagem e o CAT
--       era liberado -- para um item que a selecao por informacao de Fisher
--       nem consegue pontuar. Nada no schema exige uma ipv por item.
--
--   (b) empate em criado_em resolve pelo pior caso. O DISTINCT ON
--       (ORDER BY ipv.criado_em DESC) da 0006 escolhia UMA linha arbitraria
--       entre calibracoes de mesmo timestamp -- e now() e constante dentro de
--       uma transacao, entao gravar a calibracao definitiva junto de uma
--       provisoria empata de verdade. Agora: se QUALQUER linha do timestamp
--       mais recente for provisoria, o item conta como nao-pronto.
CREATE FUNCTION valida_cat_calibrado(alvo uuid)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  modo          text;
  n_nao_prontos integer;
BEGIN
  IF alvo IS NULL THEN
    RETURN;
  END IF;

  SELECT iv.modo_administracao INTO modo
    FROM instrument_version iv
   WHERE iv.id = alvo;

  -- Versao inexistente (apagada na mesma transacao) ou fora do modo CAT: o
  -- trilho linear nao depende de parametro calibrado e segue livre.
  IF modo IS DISTINCT FROM 'cat' THEN
    RETURN;
  END IF;

  SELECT count(*) INTO n_nao_prontos
    FROM (
      SELECT DISTINCT i.id
        FROM block b
        JOIN block_item bi ON bi.block_id = b.id
        JOIN item i ON i.id = bi.item_id
       WHERE b.instrument_version_id = alvo
         AND (
           NOT EXISTS (
             SELECT 1 FROM item_parameter_version ipv WHERE ipv.item_id = i.id
           )
           OR EXISTS (
             SELECT 1
               FROM item_parameter_version ipv
              WHERE ipv.item_id = i.id
                AND ipv.provisorio
                AND ipv.criado_em = (
                  SELECT max(x.criado_em)
                    FROM item_parameter_version x
                   WHERE x.item_id = i.id
                )
           )
         )
    ) nao_prontos;

  IF n_nao_prontos > 0 THEN
    RAISE EXCEPTION
      'instrument_version % nao pode usar modo CAT: % item(ns) sem parametro calibrado vigente (ausente ou provisorio). Rode uma calibration_run real antes.',
      alvo, n_nao_prontos;
  END IF;
END
$fn$;

-- ---------------------------------------------------------------------------
-- O gate original passa a consumir a fonte unica e vira CONSTRAINT TRIGGER.
--
-- POR QUE DEFERIDO: montar uma versao CAT legitima e, por natureza, varios
-- comandos -- INSERT da versao, dos blocos, dos block_item. Uma checagem
-- IMEDIATA barraria no meio do caminho toda montagem feita nessa ordem, mesmo
-- a de um instrumento 100% calibrado. Deferido, a pergunta e feita no COMMIT,
-- com o estado final a vista. Mesmo motivo e mesmo padrao de
-- trg_bloco_mfc_valido.
--
-- Efeito colateral corrigido de quebra: a 0006 era BEFORE UPDATE e reavaliava
-- a cada UPDATE de qualquer coluna. Uma linha que tivesse entrado em 'cat' com
-- itens provisorios (o furo acima) ficava emparedada -- ate um
-- `SET ativo = true` falhava. Com o WHEN abaixo e o estado invalido agora
-- inalcancavel, nao ha mais linha nesse limbo.
CREATE OR REPLACE FUNCTION assert_cat_requer_parametros_calibrados()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM valida_cat_calibrado(NEW.id);
  RETURN NULL;
END
$fn$;

DROP TRIGGER trg_cat_requer_calibracao ON instrument_version;

CREATE CONSTRAINT TRIGGER trg_cat_requer_calibracao
  AFTER INSERT OR UPDATE ON instrument_version
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.modo_administracao = 'cat')
  EXECUTE FUNCTION assert_cat_requer_parametros_calibrados();

-- ---------------------------------------------------------------------------
-- FLANCO 1: block. Criar um bloco numa versao CAT, ou mover um bloco existente
-- para dentro dela, muda o conjunto de itens que a pergunta enxerga.
--
-- So INSERT e UPDATE: remover bloco de uma versao CAT so pode DIMINUIR a
-- contagem de itens nao-prontos, nunca criar o estado proibido.
CREATE FUNCTION assert_block_nao_burla_cat()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM valida_cat_calibrado(NEW.instrument_version_id);
  RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER trg_block_nao_burla_cat
  AFTER INSERT OR UPDATE ON block
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_block_nao_burla_cat();

-- ---------------------------------------------------------------------------
-- FLANCO 2: block_item. E o passo 3 da reproducao -- o que de fato anexa item
-- provisorio a uma versao ja em modo CAT. Mesmo criterio: so INSERT e UPDATE.
CREATE FUNCTION assert_block_item_nao_burla_cat()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  alvo uuid;
BEGIN
  SELECT b.instrument_version_id INTO alvo FROM block b WHERE b.id = NEW.block_id;
  PERFORM valida_cat_calibrado(alvo);
  RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER trg_block_item_nao_burla_cat
  AFTER INSERT OR UPDATE ON block_item
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_block_item_nao_burla_cat();

-- ---------------------------------------------------------------------------
-- FLANCO 3: item_parameter_version. Aqui a versao CAT ja pode estar
-- legitimamente ligada (tudo calibrado) e a escrita acontece do outro lado da
-- relacao:
--   - INSERT de uma ipv provisoria nova (recalibracao em andamento) torna
--     provisorio o parametro VIGENTE de um item que ja esta em uso pelo CAT;
--   - UPDATE virando provisorio = true faz o mesmo;
--   - DELETE da linha calibrada mais recente pode fazer uma provisoria antiga
--     voltar a ser a vigente, ou zerar o item (caso (a) acima).
-- Por isso este e o unico dos tres que tambem escuta DELETE.
CREATE FUNCTION assert_ipv_nao_burla_cat()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  item_alvo uuid;
  alvo      uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    item_alvo := OLD.item_id;
  ELSE
    item_alvo := NEW.item_id;
  END IF;

  FOR alvo IN
    SELECT DISTINCT b.instrument_version_id
      FROM block_item bi
      JOIN block b ON b.id = bi.block_id
     WHERE bi.item_id = item_alvo
  LOOP
    PERFORM valida_cat_calibrado(alvo);
  END LOOP;

  RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER trg_ipv_nao_burla_cat
  AFTER INSERT OR UPDATE OR DELETE ON item_parameter_version
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ipv_nao_burla_cat();

-- ---------------------------------------------------------------------------
-- ESTADO DELIBERADAMENTE PERMITIDO: instrument_version em 'cat' com ZERO
-- blocos. E inofensivo (nao ha item para o CAT selecionar) e e o unico jeito
-- de montar uma versao CAT legitima em transacoes separadas -- exigir bloco no
-- INSERT tornaria impossivel criar qualquer versao CAT. A partir do momento em
-- que ela tenta ganhar item, os tres flancos acima decidem.
