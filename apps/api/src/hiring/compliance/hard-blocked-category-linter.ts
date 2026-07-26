export type HardBlockedCategory =
  | 'gravidez'
  | 'esterilizacao'
  | 'estado_saude_filtro'
  | 'estado_civil_filtro'
  | 'antecedentes_criminais';

// Lei 9.029/95 -- diferente do linter de categoria sensível (Task 13), aqui
// NÃO existe base legal que libere a pergunta. Única exceção condicional é
// 'antecedentes_criminais', tratada à parte pelo JobCustomFieldService (lista
// fechada de natureza de cargo + justificativa obrigatória).
const HARD_BLOCK_PATTERNS: Record<HardBlockedCategory, RegExp[]> = {
  gravidez: [/gravid/i, /grávid/i, /planeja.*engravidar/i, /planejamento familiar/i],
  esterilizacao: [/esteriliza[cç][aã]o/i, /vasectomia/i, /laqueadura/i],
  estado_saude_filtro: [/teste de hiv/i, /exame de hiv/i, /portador de (defici[eê]ncia|doen[cç]a)/i, /atestado de sa[uú]de/i],
  estado_civil_filtro: [/estado civil/i, /[ée] casad[oa]/i, /pretende se casar/i],
  antecedentes_criminais: [/antecedentes criminais/i, /ficha criminal/i, /certid[aã]o de antecedentes/i],
};

export function classifyHardBlockedCategories(text: string): HardBlockedCategory[] {
  const matched: HardBlockedCategory[] = [];
  for (const [category, patterns] of Object.entries(HARD_BLOCK_PATTERNS) as [HardBlockedCategory, RegExp[]][]) {
    if (patterns.some((pattern) => pattern.test(text))) {
      matched.push(category);
    }
  }
  return matched;
}
