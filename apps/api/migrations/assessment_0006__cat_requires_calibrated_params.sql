-- CAT só pode ser ativado se NENHUM item do instrumento ainda estiver com
-- parâmetro provisório vigente. Com parâmetros de literatura, a seleção por
-- máxima informação de Fisher escolhe itens errados E contamina os dados da
-- própria calibração futura (missing-not-at-random). Ver decisão de bootstrap
-- na spec da Fase 2a.
CREATE FUNCTION assert_cat_requer_parametros_calibrados()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  n_provisorios integer;
BEGIN
  IF NEW.modo_administracao <> 'cat' THEN
    RETURN NEW;
  END IF;

  -- Conta itens do instrumento cuja calibração MAIS RECENTE ainda é provisória.
  SELECT count(*) INTO n_provisorios
    FROM (
      SELECT DISTINCT ON (i.id) i.id, ipv.provisorio
        FROM block b
        JOIN block_item bi ON bi.block_id = b.id
        JOIN item i ON i.id = bi.item_id
        JOIN item_parameter_version ipv ON ipv.item_id = i.id
       WHERE b.instrument_version_id = NEW.id
       ORDER BY i.id, ipv.criado_em DESC
    ) vigentes
   WHERE vigentes.provisorio;

  IF n_provisorios > 0 THEN
    RAISE EXCEPTION
      'instrument_version % nao pode usar modo CAT: % item(ns) ainda com parametro provisorio. Rode uma calibration_run real antes.',
      NEW.id, n_provisorios;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER trg_cat_requer_calibracao
  BEFORE INSERT OR UPDATE ON instrument_version
  FOR EACH ROW EXECUTE FUNCTION assert_cat_requer_parametros_calibrados();
