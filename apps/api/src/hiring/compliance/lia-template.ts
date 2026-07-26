export interface LiaTemplateContent {
  testeNecessidade: string;
  testeProporcionalidade: string;
  salvaguardas: string;
}

export function generateLiaTemplate(input: { campoLabel: string; finalidade: string }): LiaTemplateContent {
  return {
    testeNecessidade: `Finalidade declarada pelo recrutador: ${input.finalidade}. O tratamento do campo "${input.campoLabel}" é necessário para essa finalidade específica de seleção, e não há alternativa menos invasiva disponível para obter a mesma informação neste estágio do processo.`,
    testeProporcionalidade: `O campo "${input.campoLabel}" é proporcional à finalidade declarada porque sua coleta se limita ao estritamente necessário para a avaliação do candidato para esta vaga, sem uso secundário não declarado.`,
    salvaguardas: `O dado coletado neste campo minimiza a exposição do titular: fica restrito à candidatura específica, é criptografado em repouso e não é compartilhado fora do processo seletivo desta vaga.`,
  };
}
