/**
 * ESCOPO DO INSTRUMENTO SEMEADO -- fonte ÚNICA para qualquer teste ou gate
 * que precise falar sobre "os itens do seed".
 *
 * NÃO USE `banco_id` PARA ISSO. `item` é tabela GLOBAL, sem tenant_id,
 * compartilhada por todos os arquivos de spec, e `banco_id` tem
 * DEFAULT 'ipip_contextualizado' (assessment_0001). Toda fixture ad hoc da
 * suíte (item-bank-schema, instrument-schema, structural-gates) insere em
 * `item` SEM informar banco_id e portanto cai no MESMO balde do seed -- uma
 * delas usa até o enunciado literal do item #1 daqui. Escopar por
 * `banco_id = 'ipip_contextualizado'` faz o teste depender do teardown dos
 * OUTROS arquivos: um `finally` que estoure, um DELETE barrado por FK ou uma
 * execução interrompida deixa uma linha solta e reprova casos por um motivo
 * que nada tem a ver com o seed. Reproduzido ao vivo inserindo UMA linha do
 * tipo que item-bank-schema.spec.ts legitimamente cria: 3 de 7 casos de
 * item-bank-seed.spec.ts ficavam vermelhos. E o inverso também é falho: uma
 * fixture futura inserida com banco_id explícito ESCAPARIA do linter.
 *
 * O identificador robusto é a pertinência ao instrumento conhecido: só o seed
 * (assessment_0005 + assessment_0012) monta blocos sob
 * INSTRUMENT_VERSION_SEMEADA.
 *
 * SÃO DOIS ESCOPOS, NÃO UM. O raciocínio acima está certo para asserções
 * ESTRUTURAIS ("exatamente 40 itens", "8 por domínio", "todo parâmetro é
 * provisório"): elas afirmam uma cardinalidade, então precisam de um conjunto
 * fechado, e qualquer linha estranha as reprova por um motivo alheio ao seed.
 * Mas o linter de vocabulário clínico tem o requisito OPOSTO. Ele não conta
 * nada -- afirma que NENHUM enunciado legível por candidato usa vocabulário
 * clínico (Res. CFP 31/2022). Escopá-lo ao instrumento semeado abre um buraco
 * permanente: item que exista no banco mas ainda não esteja blocado escapa, e
 * -- concretamente -- todo item do SEGUNDO instrument_version que a Task 10
 * (modo CAT) cria escapa. Um linter de conformidade que não enxerga metade do
 * banco dá uma garantia falsa, que é pior que garantia nenhuma.
 *
 * Por isso o linter usa TODOS_OS_ITENS: `item` inteira, sem predicado. É
 * seguro porque a direção do erro se inverte -- uma fixture vazada só pode
 * causar FALSO POSITIVO (um enunciado a mais para inspecionar), nunca falso
 * negativo, e os enunciados de fixture da suíte são benignos ('x', 'No
 * trabalho, eu planejo minhas tarefas com antecedência.'). E `maxWorkers: 1`
 * (jest.config.js) garante que não há spec concorrente com linha em voo.
 * Se algum dia uma fixture precisar de vocabulário clínico de propósito, o
 * linter reprovar é o comportamento CORRETO: quem escreve o teste declara a
 * exceção explicitamente, em vez de a exceção existir por omissão.
 *
 * ATENÇÃO AO GATE CONSOLIDADO DA FASE 2a (Task 13): o linter deve importar
 * TERMOS_CLINICOS e TODOS_OS_ITENS daqui. O plano escreve aquele passo como
 * `SELECT enunciado FROM item WHERE banco_id = 'ipip_contextualizado'` -- é
 * exatamente o predicado desmontado acima, e ainda por cima escaparia dos
 * itens que a assessment_0013 moveu para o banco 'seed_ipip_v1'.
 */

/** instrument_version criado pela assessment_0005. */
export const INSTRUMENT_VERSION_SEMEADA = 'a55e55e0-0000-4000-8000-000000000002';

/**
 * Fragmento SQL: as 40 linhas de `item` que pertencem ao instrumento semeado.
 * Uso: `WITH semeados AS (${ITENS_SEMEADOS}) SELECT ... FROM semeados`.
 */
export const ITENS_SEMEADOS = `
  SELECT DISTINCT i.*
    FROM item i
    JOIN block_item bi ON bi.item_id = i.id
    JOIN block b ON b.id = bi.block_id
   WHERE b.instrument_version_id = '${INSTRUMENT_VERSION_SEMEADA}'
`;

/**
 * Banco a que os 40 itens semeados pertencem, atribuído pela assessment_0013.
 * NÃO é o DEFAULT da coluna (que continua 'ipip_contextualizado'), então
 * nenhuma fixture o herda por omissão -- é um marcador de conteúdo de
 * produção de verdade, não um balde compartilhado.
 */
export const BANCO_SEMEADO = 'seed_ipip_v1';

/**
 * Fragmento SQL: TODO item do banco, sem predicado. Escopo do linter de
 * vocabulário clínico -- veja o bloco "SÃO DOIS ESCOPOS" no topo do arquivo
 * para por que este caso quer o conjunto aberto e os demais querem o fechado.
 */
export const TODOS_OS_ITENS = `
  SELECT i.* FROM item i
`;

/**
 * Vocabulário clínico proibido em qualquer string voltada ao usuário: o
 * instrumento é comportamental NÃO-psicológico (Res. CFP 31/2022).
 */
export const TERMOS_CLINICOS = [
  'transtorno',
  'patologia',
  'sintoma',
  'diagnostico',
  'diagnóstico',
  'depressao',
  'depressão',
  'ansiedade',
  'neurose',
  'psicologico',
  'psicológico',
  'tratamento',
  'terapia',
  'doenca',
  'doença',
];
