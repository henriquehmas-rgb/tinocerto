-- consent.finalidade ganha 'processo_seletivo'.
--
-- Por que agora: ate esta migration NENHUM caminho de producao escrevia em
-- result_grant -- so fixtures de teste. A ponte de consentimento existia no
-- schema, o relatorio da Fase 2a exigia grant vivo, e o resultado pratico era
-- que GET de relatorio devolvia 404 para todo tenant, sempre. Com a rota de
-- leitura morta, o unico caminho vivo para theta era o retorno do POST de
-- conclusao: sem grant, sem revogacao e sem o rodape obrigatorio. A ponte
-- passa a nascer na conclusao do assessment (AssessmentService.concluir), e
-- para isso precisa de uma linha de `consent`, porque result_grant.consent_id
-- e NOT NULL.
--
-- Por que finalidade NOVA e nao uma das quatro existentes: `consent` e,
-- apesar do nome, o registro de BASE LEGAL da plataforma -- o comentario da
-- trust_0003 diz isso com todas as letras, e `base_legal` e texto livre
-- justamente porque consentimento nao e a unica base possivel (LGPD art. 7).
-- O caso que passa a ser gravado e o tenant lendo o resultado que ele mesmo
-- encomendou dentro do proprio processo seletivo. Isso nao e
-- 'reaproveitamento_resultado': reaproveitamento e REUSO por outro tenant, o
-- unico caso que depende de ato do titular. Gravar o primeiro sob o rotulo do
-- segundo envenenaria de forma irreversivel a pergunta que a LGPD obriga a
-- responder -- "quais titulares consentiram com o reaproveitamento do
-- resultado?" -- misturando nela toda aplicacao de assessment do produto.
-- Um rotulo errado numa base de consentimento nao e detalhe cosmetico.
--
-- O reuso entre tenants continua fora de escopo: ele exige ato do titular
-- (base_legal = 'consentimento') e nenhum caminho de codigo desta fase o cria.
--
-- A tabela esta vazia (0 linhas), entao a troca de CHECK nao precisa de
-- backfill nem de validacao em duas etapas.

ALTER TABLE consent DROP CONSTRAINT consent_finalidade_check;

ALTER TABLE consent ADD CONSTRAINT consent_finalidade_check
  CHECK (finalidade IN (
    'banco_talentos',
    'pesquisa_normativa',
    'reaproveitamento_resultado',
    'marketing',
    'processo_seletivo'
  ));
