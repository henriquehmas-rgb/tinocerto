-- [Fix round 1 da Task 3 -- achados #1 (alto), #3 (medio) e #4 (baixo) do
-- revisor independente]
--
-- Esta migration NAO edita assessment_0003__structural_gates.sql. O runner
-- (apps/api/scripts/migrate.ts) registra migration aplicada por NOME, sem
-- checksum: editar um arquivo ja aplicado deixaria banco de dev e de CI
-- divergentes do repositorio de forma permanente e silenciosa. Os dois gates
-- sao redefinidos aqui com CREATE OR REPLACE FUNCTION -- os triggers criados
-- em assessment_0003 continuam apontando para as MESMAS funcoes e passam a
-- executar o corpo corrigido, sem recriar trigger nenhum.

-- ---------------------------------------------------------------------------
-- ACHADO #3 (medio): o significado do GATE 1 mudava conforme o role do banco.
--
-- psicologo_credencial tem FORCE ROW LEVEL SECURITY com as duas policies
-- (allow_all_base PERMISSIVE + tenant_isolation RESTRICTIVE) escopadas
-- `TO app_runtime` (identity_0008). A funcao do gate nao era SECURITY DEFINER,
-- entao o `NOT EXISTS (SELECT 1 FROM psicologo_credencial ...)` era avaliado
-- com a visibilidade de quem escrevia:
--   * owner (tinocerto, SUPERUSER/BYPASSRLS) -> enxerga todas as credenciais;
--   * app_runtime SEM app.tenant_id          -> enxerga ZERO credenciais; o
--     gate fecha sempre, mesmo com psicologo credenciado cadastrado;
--   * app_runtime COM app.tenant_id          -> vira checagem por tenant.
-- O mesmo INSERT tinha tres respostas diferentes, e a suite inteira so
-- exercitava o role owner -- a divergencia era invisivel para todo teste
-- existente. Um gate estrutural que muda de sentido conforme a conexao nao e
-- um gate.
--
-- Fix: SECURITY DEFINER com search_path fixo, mesmo padrao ja usado em
-- list_all_tenant_ids (resume_0004) e resolve_tenant_id_by_slug (public_0002).
-- A pergunta do gate passa a ser sempre a mesma, em qualquer role: "existe no
-- sistema ao menos um psicologo com crp_ativo = true?".
--
-- LIMITE CONHECIDO, deliberado: instrument e instrument_version sao tabelas
-- GLOBAIS (sem tenant_id, relrowsecurity = f) -- instrumento e catalogo
-- compartilhado, nao dado de tenant. Nao existe, portanto, tenant a que
-- amarrar a exigencia de CRP no instante da ativacao, e o gate so consegue
-- afirmar existencia global. A exigencia de vinculo POR TENANT (design spec
-- linha 40, "CRP vinculado") vive na camada de LEITURA, que e tenant-scoped:
-- result_grant e a policy Cerbos psych:report.read (Fase 4), que exige
-- crp_ativo do principal do proprio tenant. Se instrument_version algum dia
-- virar tenant-scoped, este gate deve passar a filtrar por NEW.tenant_id.
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

  IF tipo = 'teste_psicologico_satepsi'
     AND NOT EXISTS (SELECT 1 FROM psicologo_credencial WHERE crp_ativo IS TRUE) THEN
    RAISE EXCEPTION
      'instrument_version % é do trilho teste_psicologico_satepsi e nao pode ser ativada sem um psicologo com crp_ativo = true (Res. CFP 31/2022 art. 8)',
      NEW.id;
  END IF;

  RETURN NEW;
END
$fn$;

-- Higiene de SECURITY DEFINER (mesmo fecho de resume_0004): o corpo roda com
-- os privilegios do owner, entao a superficie de execucao fica explicita.
REVOKE ALL ON FUNCTION assert_trilho_b_requer_crp_ativo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assert_trilho_b_requer_crp_ativo() TO app_runtime;

-- ---------------------------------------------------------------------------
-- ACHADO #1 (ALTO): o GATE 2 era contornavel por UPDATE.
--
-- `alvo := COALESCE(NEW.block_id, OLD.block_id)` resolve para NEW.block_id em
-- UPDATE, entao so o bloco de DESTINO era revalidado; o bloco de ORIGEM nunca
-- era visitado. Mover a unica linha de valencia oposta de um bloco para outro
-- deixava o bloco de origem com chaveamento unico de forma permanente --
-- exatamente o ranking ipsativo que o gate existe para impedir -- por um
-- caminho de escrita plausivel (console de admin remontando/reordenando
-- blocos, script de migracao de dado). Um gate que so vale para INSERT e
-- DELETE nao e estrutural.
--
-- Reproduzido ao vivo antes deste fix: bloco A = (p1, p2, n1) e bloco
-- B = (p3, n2), ambos validos; `UPDATE block_item SET block_id = B WHERE
-- id = <n1>` retornou UPDATE 1 sem excecao e deixou o bloco A com 2 positivos
-- e 0 negativos.
--
-- Fix: validar TODOS os blocos tocados pela linha -- NEW.block_id e
-- OLD.block_id quando forem diferentes --, em vez de escolher um por COALESCE.
--
-- ACHADO #4 (baixo): faltava piso de tamanho de bloco.
--
-- O comentario de assessment_0003 declara "um bloco MFC precisa de 2 a 4
-- itens", mas o corpo so rejeitava n > 4 e so cobrava chaveamento oposto
-- quando n >= 2: um bloco com exatamente 1 item nao caia em nenhuma das tres
-- condicoes e virava um bloco de escolha forcada sem nada a escolher. A folga
-- do `>= 2` existia para "nao impedir a montagem item a item", mas quem
-- resolve isso e o CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED: a
-- validacao roda no COMMIT, com o bloco ja montado. No COMMIT, 1 item e
-- resultado final invalido, nao estado intermediario. O piso de 2 passa a ser
-- cobrado; 0 itens continua legitimo (bloco ainda nao montado, ou desmontado).
CREATE OR REPLACE FUNCTION assert_bloco_mfc_valido()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  alvos       uuid[];
  alvo        uuid;
  n_itens     integer;
  n_positivos integer;
  n_negativos integer;
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
    CONTINUE WHEN alvo IS NULL;

    SELECT count(*),
           count(*) FILTER (WHERE i.chave_valencia = 'positivo'),
           count(*) FILTER (WHERE i.chave_valencia = 'negativo')
      INTO n_itens, n_positivos, n_negativos
      FROM block_item bi
      JOIN item i ON i.id = bi.item_id
     WHERE bi.block_id = alvo;

    -- Bloco vazio e estado legitimo (ainda nao montado, ou desmontado).
    CONTINUE WHEN n_itens = 0;

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
  END LOOP;

  RETURN NULL;
END
$fn$;
