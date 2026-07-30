-- [Fix round 2 da Task 3 -- achados #1 (alto), #2 (alto) e #4 (baixo) do
-- revisor independente]
--
-- Mesma restricao do round 1: o runner (apps/api/scripts/migrate.ts) registra
-- migration aplicada por NOME, sem checksum. Editar assessment_0003 ou
-- assessment_0009, ja aplicadas, deixaria banco e repositorio divergentes de
-- forma permanente e silenciosa. As funcoes ja existentes sao redefinidas aqui
-- com CREATE OR REPLACE -- os triggers continuam apontando para as MESMAS
-- funcoes e passam a executar o corpo corrigido.
--
-- TEMA COMUM DOS TRES ACHADOS: o round 1 fechou os caminhos de escrita que
-- passam pela tabela onde o trigger esta pendurado. Os que sobraram sao
-- caminhos de FLANCO -- escritas em OUTRA tabela que mudam o resultado da
-- pergunta que o gate faz. Um gate estrutural precisa cobrir a pergunta, nao a
-- tabela. Todos os tres foram reproduzidos ao vivo sob o role app_runtime (o
-- que roda em producao), usando GRANTs que ele de fato possui.

-- ---------------------------------------------------------------------------
-- Fonte unica da pergunta do gate 1.
--
-- O gate 1 existia em UM lugar e agora precisa ser feito de TRES (ativacao de
-- versao, reclassificacao de instrumento, revogacao de credencial). Tres
-- copias do mesmo `NOT EXISTS` sao tres oportunidades de divergirem -- que e
-- exatamente a classe de bug destes achados. A pergunta passa a morar aqui.
--
-- SECURITY DEFINER pelo motivo ja documentado em assessment_0009: a
-- psicologo_credencial tem FORCE ROW LEVEL SECURITY com as policies escopadas
-- TO app_runtime, entao sem SECURITY DEFINER a resposta mudaria conforme o
-- role e conforme haver ou nao app.tenant_id na conexao.
CREATE FUNCTION existe_psicologo_com_crp_ativo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM psicologo_credencial WHERE crp_ativo IS TRUE)
$fn$;

REVOKE ALL ON FUNCTION existe_psicologo_com_crp_ativo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION existe_psicologo_com_crp_ativo() TO app_runtime;

-- Gate 1 original passa a consumir a fonte unica. Comportamento identico ao de
-- assessment_0009 -- so deixa de ter copia propria do predicado.
CREATE OR REPLACE FUNCTION assert_trilho_b_requer_crp_ativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  tipo text;
BEGIN
  IF NEW.ativo IS NOT TRUE THEN
    RETURN NEW;  -- versao inativa nao precisa de gate nenhum
  END IF;

  SELECT i.tipo_instrumento INTO tipo
    FROM instrument i
   WHERE i.id = NEW.instrument_id;

  IF tipo = 'teste_psicologico_satepsi' AND NOT existe_psicologo_com_crp_ativo() THEN
    RAISE EXCEPTION
      'instrument_version % e do trilho teste_psicologico_satepsi e nao pode ser ativada sem um psicologo com crp_ativo = true (Res. CFP 31/2022 art. 8)',
      NEW.id;
  END IF;

  RETURN NEW;
END
$fn$;

-- ---------------------------------------------------------------------------
-- ACHADO #1 (ALTO): o gate 1 era contornavel por UPDATE em instrument.
--
-- trg_trilho_b_requer_crp dispara so em instrument_version. Nada guardava
-- instrument.tipo_instrumento -- e o trilho e lido de la. A sequencia:
--   1. criar instrument com tipo_instrumento = 'nao_psicologico' (trilho A);
--   2. ativar uma instrument_version dele (legitimo, trilho A nao pede CRP);
--   3. UPDATE instrument SET tipo_instrumento = 'teste_psicologico_satepsi'.
-- O resultado e uma instrument_version ATIVA de teste_psicologico_satepsi com
-- ZERO psicologo de crp_ativo no sistema -- exatamente o estado que o gate
-- existe para tornar impossivel.
--
-- Nao e caminho hipotetico de console de admin: assessment_0002 concede
-- `GRANT SELECT, INSERT, UPDATE ON instrument TO app_runtime`, entao o role que
-- roda em producao tem o privilegio. Reproduzido ao vivo com SET LOCAL ROLE
-- app_runtime: UPDATE 1, sem excecao.
--
-- Fix: espelhar a pergunta do gate no outro lado da relacao. Reclassificar um
-- instrumento PARA o trilho B enquanto ele tem versao ativa passa a exigir o
-- mesmo CRP que a ativacao direta exigiria. Sem versao ativa a reclassificacao
-- segue livre -- ai a exigencia recai no gate de instrument_version, na hora de
-- ativar, e o resultado final e o mesmo.
CREATE FUNCTION assert_instrument_trilho_nao_burla_crp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.tipo_instrumento IS NOT DISTINCT FROM OLD.tipo_instrumento THEN
    RETURN NEW;
  END IF;

  IF NEW.tipo_instrumento <> 'teste_psicologico_satepsi' THEN
    RETURN NEW;  -- sair do trilho B nunca precisa de CRP
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM instrument_version iv
     WHERE iv.instrument_id = NEW.id
       AND iv.ativo IS TRUE
  ) THEN
    RETURN NEW;  -- sem versao ativa nao ha o que travar aqui
  END IF;

  IF NOT existe_psicologo_com_crp_ativo() THEN
    RAISE EXCEPTION
      'instrument % nao pode ser reclassificado para teste_psicologico_satepsi tendo versao ativa sem um psicologo com crp_ativo = true (Res. CFP 31/2022 art. 8)',
      NEW.id;
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION assert_instrument_trilho_nao_burla_crp() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assert_instrument_trilho_nao_burla_crp() TO app_runtime;

CREATE TRIGGER trg_instrument_trilho_nao_burla_crp
  BEFORE UPDATE ON instrument
  FOR EACH ROW EXECUTE FUNCTION assert_instrument_trilho_nao_burla_crp();

-- ---------------------------------------------------------------------------
-- ACHADO #4 (baixo): o gate 1 nunca era reavaliado DEPOIS da ativacao.
--
-- trg_trilho_b_requer_crp e BEFORE INSERT OR UPDATE em instrument_version, ou
-- seja, uma checagem de instante-da-ativacao. Revogar a credencial depois --
-- `UPDATE psicologo_credencial SET crp_ativo = false`, ou apagar a linha --
-- produzia silenciosamente o mesmo estado proibido: versao SATEPSI ativa com
-- zero CRP ativo. CRP que caduca ou e cassado e evento rotineiro, nao exotico.
-- Reproduzido ao vivo: UPDATE 1, sem excecao, versao continua ativa.
--
-- Escolha de fix: DESATIVAR a versao, nao bloquear a revogacao. Registrar que
-- um CRP caducou e registro de fato do mundo -- o banco nao pode se recusar a
-- aceitar a realidade. O que a Res. CFP 31/2022 art. 8 exige e que o
-- instrumento privativo deixe de poder ser aplicado, e e isso que acontece:
-- ativo passa a false e a versao volta a precisar do gate para religar.
--
-- Escopo GLOBAL, coerente com o LIMITE CONHECIDO ja documentado em
-- assessment_0009: instrument/instrument_version sao catalogo compartilhado,
-- sem tenant_id, entao tanto a exigencia quanto a revogacao so conseguem falar
-- de existencia global de CRP ativo. A exigencia de vinculo POR TENANT vive na
-- camada de leitura (result_grant + policy Cerbos psych:report.read, Fase 4).
--
-- FOR EACH STATEMENT, nao FOR EACH ROW: a pergunta e sobre o sistema inteiro,
-- nao sobre a linha; uma avaliacao por comando basta e evita N execucoes numa
-- revogacao em lote.
CREATE FUNCTION desativa_trilho_b_sem_crp_ativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF existe_psicologo_com_crp_ativo() THEN
    RETURN NULL;
  END IF;

  -- Este UPDATE dispara trg_trilho_b_requer_crp, que retorna cedo porque
  -- NEW.ativo e false -- versao inativa nao precisa de gate. Sem recursao.
  UPDATE instrument_version iv
     SET ativo = false
    FROM instrument i
   WHERE i.id = iv.instrument_id
     AND i.tipo_instrumento = 'teste_psicologico_satepsi'
     AND iv.ativo IS TRUE;

  RETURN NULL;
END
$fn$;

REVOKE ALL ON FUNCTION desativa_trilho_b_sem_crp_ativo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION desativa_trilho_b_sem_crp_ativo() TO app_runtime;

CREATE TRIGGER trg_crp_revogado_desativa_trilho_b
  AFTER UPDATE OR DELETE ON psicologo_credencial
  FOR EACH STATEMENT EXECUTE FUNCTION desativa_trilho_b_sem_crp_ativo();

-- ---------------------------------------------------------------------------
-- ACHADO #2 (ALTO): o gate 2 era contornavel por UPDATE em item.
--
-- assert_bloco_mfc_valido so esta pendurada em block_item. A composicao do
-- bloco ficou coberta no round 1 (INSERT, UPDATE de block_id, DELETE), mas a
-- VALENCIA vem de item, e nada disparava quando a valencia de um item ja
-- pertencente a um bloco commitado era virada:
--   UPDATE item SET chave_valencia = 'positivo' WHERE id = <unico negativo>
-- deixa o bloco em 2 positivos / 0 negativos de forma permanente -- o ranking
-- ipsativo que o gate existe para impedir, pelo mesmo efeito final do achado
-- de UPDATE do round 1. assessment_0001 concede
-- `GRANT SELECT, INSERT, UPDATE ON item TO app_runtime`, entao uma correcao
-- editorial de item (caminho plausivel) invalidava calado todo bloco que
-- contivesse aquele item. Reproduzido ao vivo sob app_runtime: UPDATE 1, bloco
-- resultante 2 positivos / 0 negativos.
--
-- Fix: extrair a validacao de UM bloco para uma funcao, e disparar tambem a
-- partir de item. Extrair, e nao copiar, pelo mesmo motivo do helper de CRP
-- acima -- duas copias da regra e como o gate ficou com furo em primeiro lugar.
CREATE FUNCTION valida_bloco_mfc(alvo uuid)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  n_itens     integer;
  n_positivos integer;
  n_negativos integer;
BEGIN
  IF alvo IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE i.chave_valencia = 'positivo'),
         count(*) FILTER (WHERE i.chave_valencia = 'negativo')
    INTO n_itens, n_positivos, n_negativos
    FROM block_item bi
    JOIN item i ON i.id = bi.item_id
   WHERE bi.block_id = alvo;

  -- Bloco vazio e estado legitimo (ainda nao montado, ou desmontado).
  IF n_itens = 0 THEN
    RETURN;
  END IF;

  IF n_itens < 2 THEN
    RAISE EXCEPTION
      'bloco % tem % item; um bloco MFC precisa de 2 a 4 itens -- com um item so nao existe escolha forcada',
      alvo, n_itens;
  END IF;

  IF n_itens > 4 THEN
    RAISE EXCEPTION 'bloco % tem % itens; um bloco MFC aceita no maximo 4', alvo, n_itens;
  END IF;

  IF n_positivos = 0 OR n_negativos = 0 THEN
    RAISE EXCEPTION
      'bloco % nao tem chaveamento oposto (% positivos, % negativos); sem valencia oposta o MFC vira ranking ipsativo',
      alvo, n_positivos, n_negativos;
  END IF;
END
$fn$;

-- Mesmo conjunto de blocos-alvo do round 1 (destino sempre, origem quando a
-- linha mudou de bloco); so a validacao em si sai daqui para valida_bloco_mfc.
CREATE OR REPLACE FUNCTION assert_bloco_mfc_valido()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  alvos uuid[];
  alvo  uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    alvos := ARRAY[NEW.block_id];
  ELSIF TG_OP = 'DELETE' THEN
    alvos := ARRAY[OLD.block_id];
  ELSE
    -- UPDATE: o destino SEMPRE, a origem tambem quando a linha mudou de bloco.
    alvos := ARRAY[NEW.block_id];
    IF OLD.block_id IS DISTINCT FROM NEW.block_id THEN
      alvos := alvos || OLD.block_id;
    END IF;
  END IF;

  FOREACH alvo IN ARRAY alvos LOOP
    PERFORM valida_bloco_mfc(alvo);
  END LOOP;

  RETURN NULL;
END
$fn$;

-- Virar a valencia de um item revalida TODO bloco que contenha aquele item.
-- DEFERRABLE INITIALLY DEFERRED pelo mesmo motivo do gate 2 original: a
-- checagem roda no COMMIT, com o estado final a vista. Assim uma transacao que
-- vira a valencia de dois itens do mesmo bloco (trocando positivo por negativo
-- e vice-versa, remanejo legitimo) e aceita, em vez de barrar no meio.
CREATE FUNCTION assert_item_valencia_nao_quebra_bloco()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  alvo uuid;
BEGIN
  IF NEW.chave_valencia IS NOT DISTINCT FROM OLD.chave_valencia THEN
    RETURN NULL;
  END IF;

  FOR alvo IN SELECT DISTINCT bi.block_id FROM block_item bi WHERE bi.item_id = NEW.id LOOP
    PERFORM valida_bloco_mfc(alvo);
  END LOOP;

  RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER trg_item_valencia_nao_quebra_bloco
  AFTER UPDATE OF chave_valencia ON item
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_item_valencia_nao_quebra_bloco();
