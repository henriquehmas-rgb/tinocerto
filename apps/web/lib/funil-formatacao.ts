const ROTULO_ASSESSMENT: Record<'convidado' | 'iniciado' | 'concluido', string> = {
  convidado: 'Assessment enviado',
  iniciado: 'Assessment iniciado',
  concluido: 'Assessment concluído',
};

// Canais conhecidos ganham rótulo em linguagem de recrutador. Canal novo
// aparece cru em vez de sumir: é melhor o recrutador ver 'feira_de_empregos'
// do que não ver origem nenhuma.
const ROTULO_ORIGEM: Record<string, string> = {
  site_carreiras: 'Site de carreiras',
  indicacao: 'Indicação',
  importacao: 'Importação',
};

const UM_DIA_EM_MS = 24 * 60 * 60 * 1000;

export function idadeRelativa(criadoEm: string, agora: Date): string {
  const dias = Math.floor((agora.getTime() - new Date(criadoEm).getTime()) / UM_DIA_EM_MS);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'há 1 dia';
  return `há ${dias} dias`;
}

export interface CandidaturaParaChips {
  assessmentStatus: 'convidado' | 'iniciado' | 'concluido' | null;
  origemCanal: string | null;
  criadoEm: string;
}

export function montarChips(candidatura: CandidaturaParaChips, agora: Date): { rotulo: string }[] {
  const chips: { rotulo: string }[] = [];
  if (candidatura.assessmentStatus) {
    chips.push({ rotulo: ROTULO_ASSESSMENT[candidatura.assessmentStatus] });
  }
  if (candidatura.origemCanal) {
    chips.push({ rotulo: ROTULO_ORIGEM[candidatura.origemCanal] ?? candidatura.origemCanal });
  }
  chips.push({ rotulo: idadeRelativa(candidatura.criadoEm, agora) });
  return chips;
}

/**
 * Etapa para onde a candidatura deve ir, ou `null` quando não há movimento:
 * soltar na coluna de origem, ou candidatura desconhecida.
 */
export function resolverDestino(
  funil: Record<string, { id: string }[]>,
  applicationId: string,
  chaveDestino: string,
): string | null {
  const origem = Object.keys(funil).find((etapa) => funil[etapa].some((c) => c.id === applicationId));
  if (origem === undefined) return null;
  if (origem === chaveDestino) return null;
  return chaveDestino;
}
