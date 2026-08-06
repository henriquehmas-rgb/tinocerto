-- COERENCIA DE TENANT ENTRE demographic_self_report E consent.
--
-- Achado de revisao adversarial da Task 1 (Fase 2c): demographic_self_report
-- referencia consent por FK SIMPLES de coluna unica (mesma forma exata do
-- problema ja fechado em result_grant, ver
-- assessment_0017__result_grant_consent_tenant_coerencia.sql). A checagem de
-- FK do Postgres nao passa por RLS, entao nada no SCHEMA impedia um INSERT
-- direto gravar tenant_id = A com consent_id de um consent do tenant B. O
-- unico controle era a validacao em aplicacao
-- (DemographicSelfReportService.declarar), que "some junto com a query no
-- dia em que alguem escrever um segundo caminho de escrita" -- exatamente a
-- licao ja registrada na migration irma.
--
-- DIFERENCA DELIBERADA em relacao a result_grant: la, consent.tenant_id NULL
-- (escopo de plataforma) e um caso LEGITIMO -- reaproveitamento de resultado
-- entre tenants exige base legal de plataforma. Aqui NAO: autodeclaracao
-- demografica e por desenho tenant-scoped por (tenant_id, person_id) --
-- nao existe "reaproveitamento entre tenants" para esta tabela (ver design
-- da Fase 2c). Por isso este trigger exige IGUALDADE EXATA de tenant_id,
-- sem o "NULL = qualquer tenant" da versao de result_grant -- um
-- consentimento de escopo de plataforma tambem seria uma base legal larga
-- demais para dado sensivel (LGPD art. 11), que pede consentimento
-- ESPECIFICO e destacado.

CREATE FUNCTION assert_demographic_self_report_consent_mesmo_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  consent_tenant uuid;
BEGIN
  SELECT c.tenant_id INTO consent_tenant
    FROM consent c
   WHERE c.id = NEW.consent_id;

  -- Nenhuma linha VISIVEL. Numa conexao que ignora RLS isso so acontece se o
  -- consent nao existir, e ai a propria FK reprova logo em seguida. Numa
  -- conexao app_runtime significa que a policy escondeu a linha, isto e,
  -- ela pertence a OUTRO tenant -- exatamente o caso que este gatilho existe
  -- para barrar. Falha FECHADO nos dois.
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'demographic_self_report do tenant % nao pode apontar para consent %: base legal inexistente ou inacessivel a este tenant',
      NEW.tenant_id, NEW.consent_id;
  END IF;

  IF consent_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION
      'demographic_self_report do tenant % nao pode apontar para consent % (tenant do consentimento: %): autodeclaracao exige consentimento especifico deste tenant, sem excecao de escopo de plataforma',
      NEW.tenant_id, NEW.consent_id, consent_tenant;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER trg_demographic_self_report_consent_mesmo_tenant
  BEFORE INSERT OR UPDATE ON demographic_self_report
  FOR EACH ROW EXECUTE FUNCTION assert_demographic_self_report_consent_mesmo_tenant();
