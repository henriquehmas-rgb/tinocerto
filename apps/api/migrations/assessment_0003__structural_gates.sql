-- GATE 1: trilho B (teste psicológico SATEPSI) só pode ser ativado se existir
-- ao menos um psicólogo com CRP ATIVO. Res. CFP 31/2022 art. 8º: teste
-- psicológico é privativo de psicólogo com CRP. Isso é bloqueio estrutural,
-- não aviso de UI -- ver critério de pronto do roadmap §4.
--
-- NOTA DE SCHEMA: a coluna real de psicologo_credencial (Fase 0,
-- identity_0006__session_service_account_psicologo.sql) é `crp_ativo boolean`,
-- não `crp_status text`. O gate usa a coluna que existe de fato.
CREATE FUNCTION assert_trilho_b_requer_crp_ativo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tipo text;
BEGIN
  IF NEW.ativo IS NOT TRUE THEN
    RETURN NEW;  -- versão inativa não precisa de gate nenhum
  END IF;

  SELECT i.tipo_instrumento INTO tipo
    FROM instrument i
   WHERE i.id = NEW.instrument_id;

  IF tipo = 'teste_psicologico_satepsi'
     AND NOT EXISTS (SELECT 1 FROM psicologo_credencial WHERE crp_ativo IS TRUE) THEN
    RAISE EXCEPTION
      'instrument_version % é do trilho teste_psicologico_satepsi e nao pode ser ativada sem um psicologo com crp_ativo = true (Res. CFP 31/2022 art. 8)',
      NEW.id;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER trg_trilho_b_requer_crp
  BEFORE INSERT OR UPDATE ON instrument_version
  FOR EACH ROW EXECUTE FUNCTION assert_trilho_b_requer_crp_ativo();

-- GATE 2: um bloco MFC precisa de 2 a 4 itens E de chaveamento oposto (pelo
-- menos um positivo e um negativo). Sem valência oposta a escolha forçada não
-- informa nível de traço, só preferência relativa -- é exatamente a
-- ipsatividade que o MFC existe para evitar. CHECK não consegue contar linhas
-- de outra tabela, então o gate é trigger no fim da montagem do bloco.
CREATE FUNCTION assert_bloco_mfc_valido()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  alvo uuid;
  n_itens integer;
  n_positivos integer;
  n_negativos integer;
BEGIN
  alvo := COALESCE(NEW.block_id, OLD.block_id);

  SELECT count(*),
         count(*) FILTER (WHERE i.chave_valencia = 'positivo'),
         count(*) FILTER (WHERE i.chave_valencia = 'negativo')
    INTO n_itens, n_positivos, n_negativos
    FROM block_item bi
    JOIN item i ON i.id = bi.item_id
   WHERE bi.block_id = alvo;

  -- Bloco vazio é estado intermediário legítimo (montando ou desmontando).
  IF n_itens = 0 THEN
    RETURN NULL;
  END IF;

  IF n_itens > 4 THEN
    RAISE EXCEPTION 'bloco % tem % itens; um bloco MFC aceita no maximo 4', alvo, n_itens;
  END IF;

  -- Só exige chaveamento oposto quando o bloco já está completo (>= 2), para
  -- não impedir a montagem item a item.
  IF n_itens >= 2 AND (n_positivos = 0 OR n_negativos = 0) THEN
    RAISE EXCEPTION
      'bloco % nao tem chaveamento oposto (% positivos, % negativos); sem valencia oposta o MFC vira ranking ipsativo',
      alvo, n_positivos, n_negativos;
  END IF;

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER trg_bloco_mfc_valido
  AFTER INSERT OR UPDATE OR DELETE ON block_item
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_bloco_mfc_valido();
