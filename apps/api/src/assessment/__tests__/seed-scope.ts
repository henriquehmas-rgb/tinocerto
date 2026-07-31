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
 * ATENÇÃO AO GATE CONSOLIDADO DA FASE 2a (Task 13): o linter de vocabulário
 * clínico deve importar TERMOS_CLINICOS e ITENS_SEMEADOS daqui. O plano
 * escreve aquele passo como `SELECT enunciado FROM item WHERE banco_id =
 * 'ipip_contextualizado'` -- é exatamente o predicado desmontado acima.
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
