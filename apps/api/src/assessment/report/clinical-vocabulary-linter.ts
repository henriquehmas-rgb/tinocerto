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
/**
 * Raízes truncadas, não palavras inteiras: o objetivo é pegar a FLEXÃO toda
 * com uma entrada só. Exportada para o spec conseguir exigir que cada entrada
 * tenha uma sonda -- sem isso uma entrada podia ser truncada errado, ou
 * sumir, e a suíte seguir verde.
 *
 * Quatro entradas foram corrigidas depois de a revisão da Task 11 mostrar que
 * a lista traía a própria convenção: `clinico` pegava "perfil clínico" e
 * deixava passar "avaliação clínica" -- a forma feminina do MESMO termo que
 * já estava na lista. Mesma classe em depressao/ansiedade, que não pegavam
 * "depressivo" nem "ansioso", e trauma/medicação faltavam por completo.
 */
export const TERMOS_CLINICOS = [
  'transtorno',
  'patolog',       // patologia, patológico
  'sintoma',
  'diagnostic',    // diagnóstico, diagnosticar
  'depress',       // depressão, depressivo, depressiva
  'ansiedade',
  'ansios',        // ansioso, ansiosa -- 'ansiedade' não cobre a flexão
  'neuro',         // neurose, neurótico
  'psicolog',      // psicológico, psicologia
  'psiquiatr',
  'terapia',
  'tratamento',
  'doenca',
  'sindrome',
  'compulsi',
  'fobia',
  'clinic',        // clínico, clínica, clínicas
  'trauma',        // trauma, traumático, traumatizado
  'medic',         // medicação, medicamento, médico, médica
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
