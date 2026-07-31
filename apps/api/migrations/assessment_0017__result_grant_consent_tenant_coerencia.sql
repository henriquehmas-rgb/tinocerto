-- COERENCIA DE TENANT ENTRE result_grant E consent.
--
-- result_grant (tenant-scoped) referencia consent (tenant-scoped) por uma FK
-- SIMPLES de coluna unica, e nao pela composta (tenant_id, col) REFERENCES
-- pai (tenant_id, id) que o resto do repositorio usa (precedentes reais:
-- assessment_application -> application, org_unit.parent_id,
-- psicologo_credencial). Sem isso, NADA no schema impede que um result_grant
-- do tenant A aponte para uma linha de consent do tenant B -- a validacao de
-- FK nao passa por RLS, entao a RLS tambem nao fecha esse caminho. O unico
-- controle era o predicado escrito a mao em ReportService.gerar
-- (`c.tenant_id IS NULL OR c.tenant_id = g.tenant_id`), controle de
-- aplicacao que some junto com a query no dia em que alguem escrever um
-- segundo caminho de leitura.
--
-- A FK COMPOSTA NAO SERVE AQUI, e e por isso que esta migration usa trigger.
-- consent e tenant-scoped com tenant_id NULAVEL DE PROPOSITO: base legal de
-- escopo de PLATAFORMA (tenant_id NULL) e legitima e e justamente o caso do
-- reaproveitamento de resultado entre tenants. Como result_grant.tenant_id e
-- NOT NULL, uma FK composta (tenant_id, consent_id) -> consent (tenant_id, id)
-- exigiria igualdade exata e passaria a REJEITAR o consentimento de
-- plataforma: trocaria um furo de isolamento por uma regressao de produto.
-- (consent tampouco tem UNIQUE (tenant_id, id) para uma FK composta apontar.)
--
-- Entao a invariante vira trigger, que e como esta fase ja trata invariante
-- que FK nao expressa -- ver assessment_0006 (CAT so com parametro calibrado)
-- e o gate do trilho B / CRP.

CREATE FUNCTION assert_result_grant_consent_mesmo_tenant()
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
  -- conexao app_runtime significa que a policy da trust_0004 escondeu a
  -- linha, isto e, ela pertence a OUTRO tenant -- exatamente o caso que este
  -- gatilho existe para barrar. Falha FECHADO nos dois.
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'result_grant do tenant % nao pode apontar para consent %: base legal inexistente ou inacessivel a este tenant',
      NEW.tenant_id, NEW.consent_id;
  END IF;

  -- NULL = base legal de escopo de plataforma, legitima para qualquer tenant.
  IF consent_tenant IS NOT NULL AND consent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION
      'result_grant do tenant % nao pode apontar para consent % do tenant %: base legal de outro tenant',
      NEW.tenant_id, NEW.consent_id, consent_tenant;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER trg_result_grant_consent_mesmo_tenant
  BEFORE INSERT OR UPDATE ON result_grant
  FOR EACH ROW EXECUTE FUNCTION assert_result_grant_consent_mesmo_tenant();
