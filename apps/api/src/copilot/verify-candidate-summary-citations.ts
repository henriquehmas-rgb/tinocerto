// apps/api/src/copilot/verify-candidate-summary-citations.ts
import { locateVerbatimOffset } from '../resume/locate-verbatim-offset';
import { CitableSnippet } from './build-citable-snippets';

export interface FraseGerada {
  texto: string;
  fonteId: string;
  citacaoVerbatim: string;
}

export class CitacaoNaoVerificavelError extends Error {
  constructor(
    public readonly indiceFrase: number,
    motivo: string,
  ) {
    super(`Frase ${indiceFrase}: ${motivo}`);
    this.name = 'CitacaoNaoVerificavelError';
  }
}

// Reutiliza EXATAMENTE o mesmo mecanismo já usado no parsing de currículo
// (locateVerbatimOffset -- indexOf exato, sem tolerância a paráfrase ou
// diferença de maiúscula/pontuação) -- não uma verificação nova e mais
// frouxa. Lança na PRIMEIRA frase inválida; o chamador
// (CandidateSummaryService.gerar) trata isso como rejeição do RESUMO
// INTEIRO, nunca descarte silencioso de uma frase só (decisão 7 do design
// spec: uma frase removida em silêncio ainda deixa um resumo
// aparentemente completo na tela do recrutador, sem sinal do corte).
export function verificarCitacoesResumoCandidato(frases: FraseGerada[], trechos: CitableSnippet[]): void {
  const porFonteId = new Map(trechos.map((t) => [t.fonteId, t]));
  frases.forEach((frase, indice) => {
    const trecho = porFonteId.get(frase.fonteId);
    if (!trecho) {
      throw new CitacaoNaoVerificavelError(
        indice,
        `fonteId "${frase.fonteId}" não corresponde a nenhum trecho verificado do perfil deste candidato`,
      );
    }
    const offset = locateVerbatimOffset(trecho.texto, frase.citacaoVerbatim);
    if (!offset) {
      throw new CitacaoNaoVerificavelError(
        indice,
        `citacaoVerbatim não é um trecho exato do texto já verificado de "${frase.fonteId}" -- possível alucinação`,
      );
    }
  });
}
