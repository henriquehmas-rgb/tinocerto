export type SensitiveCategory = 'saude' | 'conviccao_politica' | 'religiao' | 'raca' | 'vida_sexual' | 'biometria';

// Padrões por categoria -- ver 02-requisitos-e-compliance.md §3.2. Cada
// padrão é testado case-insensitive contra o texto completo da pergunta.
// Lista NÃO exaustiva de propósito (linter determinístico, não modelo de
// linguagem) -- expandir esta lista é a forma correta de "consertar" um
// falso negativo achado em produção, nunca trocar por um LLM sem manter
// este piso determinístico como base.
const PATTERNS: Record<SensitiveCategory, RegExp[]> = {
  saude: [
    /humor/i,
    /dificuldade para dormir/i,
    /ansiedade/i,
    /depress[aã]o/i,
    /transtorno/i,
    /condi[cç][aã]o de sa[uú]de/i,
    /doen[cç]a/i,
    /medicamento/i,
  ],
  conviccao_politica: [
    /critica.*autoridade/i,
    /autoridade.*discorda/i,
    /posicionamento pol[ií]tico/i,
    /partido pol[ií]tico/i,
    /vota(r|ção)/i,
  ],
  religiao: [/religi[aã]o/i, /cren[cç]a espiritual/i, /religios[ao]/i],
  raca: [/ra[cç]a/i, /\bcor\b.*ibge/i, /etnia/i],
  vida_sexual: [/orienta[cç][aã]o sexual/i, /vida sexual/i, /identidade de g[eê]nero/i],
  biometria: [/reconhecimento facial/i, /biometria/i, /impress[aã]o digital/i, /captura de v[ií]deo/i],
};

export function classifySensitiveCategories(text: string): SensitiveCategory[] {
  const matched: SensitiveCategory[] = [];
  for (const [category, patterns] of Object.entries(PATTERNS) as [SensitiveCategory, RegExp[]][]) {
    if (patterns.some((pattern) => pattern.test(text))) {
      matched.push(category);
    }
  }
  return matched;
}
