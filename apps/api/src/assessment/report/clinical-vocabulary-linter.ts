/**
 * Linter determinístico de vocabulário clínico para o relatório trilho A.
 *
 * O instrumento é comportamental NÃO-psicológico (Res. CFP 31/2022 --
 * teste psicológico é privativo de psicólogo com CRP). Se o relatório
 * entregue ao cliente usar linguagem clínica, o instrumento deixa de ser
 * defensavelmente não-psicológico na prática, por mais que o schema diga
 * `tipo_instrumento = nao_psicologico`.
 *
 * Determinístico e de lista fechada, mesmo padrão do linter de categoria
 * sensível da Fase 1a: é um gate que decide se algo publica ou não, então
 * precisa ser auditável termo a termo -- não um modelo probabilístico que
 * pode "discordar" num caso já normatizado.
 */
const TERMOS_CLINICOS = [
  'transtorno',
  'patolog',       // patologia, patológico
  'sintoma',
  'diagnostic',    // diagnóstico, diagnosticar
  'depressao',
  'ansiedade',
  'neuro',         // neurose, neurótico
  'psicolog',      // psicológico, psicologia
  'psiquiatr',
  'terapia',
  'tratamento',
  'doenca',
  'sindrome',
  'compulsi',
  'fobia',
  'clinico',
];

/** Remove acentos para casar 'diagnóstico' e 'diagnostico' na mesma regra. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function classificarTermosClinicos(texto: string): string[] {
  const alvo = normalizar(texto);
  return TERMOS_CLINICOS.filter((termo) => alvo.includes(termo));
}
