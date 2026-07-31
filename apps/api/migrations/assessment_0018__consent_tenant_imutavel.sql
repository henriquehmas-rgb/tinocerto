-- O OUTRO LADO DA INVARIANTE DA assessment_0017.
--
-- A 0017 poe um trigger em result_grant e afirma, no seu proprio comentario,
-- que "NADA no schema impede que um result_grant do tenant A aponte para uma
-- linha de consent do tenant B". Ela fecha esse estado pelo lado de result_grant
-- -- e so por ele. O mesmo estado continuava alcancavel pelo lado do consent:
--
--   INSERT INTO result_grant (..., tenant_id = A, consent_id = C)  -- C e de
--                                                                  -- plataforma
--   UPDATE consent SET tenant_id = B WHERE id = C;                 -- passava
--
-- Reproduzido ao vivo antes desta migration, em transacao revertida: o grant
-- de A ficava apontando para uma base legal do tenant B, exatamente o estado
-- que a 0017 existe para proibir, so que alcancado na ordem inversa. Trigger
-- BEFORE INSERT OR UPDATE ON result_grant nao ve UPDATE em consent.
--
-- POR QUE IMUTABILIDADE TOTAL, E NAO "rejeitar so a mudanca que orfana um
-- grant". A versao estreita seria:
--
--   IF EXISTS (SELECT 1 FROM result_grant g WHERE g.consent_id = OLD.id
--                AND g.tenant_id <> NEW.tenant_id) THEN RAISE ...
--
-- e ela FALHA ABERTO justamente no papel que importa. Uma funcao de trigger
-- comum (nao SECURITY DEFINER) roda com a RLS do papel INVOCADOR, e
-- result_grant tem FORCE RLS com isolamento por tenant. Medido ao vivo, com a
-- mesma linha de grant e o mesmo consent:
--
--   ADMIN_VE_GRANTS=1
--   APP_RUNTIME_TENANT_A_VE_GRANTS=0
--
-- Isto e: sob app_runtime, o tenant A nao enxerga o grant do tenant B, o
-- EXISTS nao casa nada, o trigger aprova e o grant de B fica orfanado. So
-- funcionaria como SECURITY DEFINER -- que faria a garantia depender de o dono
-- da funcao ter BYPASSRLS, uma premissa que hoje e verdade por acidente
-- (tinocerto e superusuario no ambiente de desenvolvimento) e que nao se
-- sustenta num deploy com dono nao-superusuario.
--
-- A regra absoluta nao consulta result_grant, entao nao tem nada que a RLS
-- possa esconder: ela falha FECHADO sob qualquer papel.
--
-- E ela fecha, de quebra, uma escalada que a versao estreita deixava passar. A
-- policy da trust_0004 tem WITH CHECK `tenant_id IS NULL OR tenant_id = <atual>`,
-- entao um tenant podia PROMOVER o proprio consent a escopo de PLATAFORMA
-- (tenant_id NULL) -- e escopo de plataforma e, por desenho, base legal
-- legitima para QUALQUER tenant (0017, e o caso de reaproveitamento de
-- resultado). Nenhum EXISTS de orfandade pega isso: NULL nao orfana grant
-- nenhum, so alarga unilateralmente a base legal para o mercado inteiro.
--
-- Semanticamente e o que ja deveria valer. consent registra uma base legal
-- concedida num momento, para um titular e um escopo. Trocar o escopo depois e
-- reescrever o registro, nao corrigi-lo: a operacao de produto correta e
-- revoked_at (coluna separada, que este trigger nem toca, porque
-- `BEFORE UPDATE OF tenant_id` so dispara quando tenant_id aparece no SET) mais
-- um consent novo. Nenhum caminho de producao faz UPDATE em consent.tenant_id
-- -- so um caso de report.service.spec.ts, que fabrica o estado de proposito
-- para provar a defesa em profundidade da camada de aplicacao e que desliga
-- este trigger explicitamente, dentro de transacao revertida, para conseguir.

CREATE FUNCTION assert_consent_tenant_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- IS DISTINCT FROM, e nao <>: tenant_id e nulavel, e `NULL <> valor` daria
  -- NULL (nem verdadeiro nem falso), deixando passar tanto a promocao a
  -- escopo de plataforma quanto a saida dele.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION
      'consent %: escopo de tenant e imutavel (% -> %). Base legal registrada nao troca de titular: revogue (revoked_at) e registre um consent novo',
      OLD.id, OLD.tenant_id, NEW.tenant_id;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER trg_consent_tenant_imutavel
  BEFORE UPDATE OF tenant_id ON consent
  FOR EACH ROW EXECUTE FUNCTION assert_consent_tenant_imutavel();
