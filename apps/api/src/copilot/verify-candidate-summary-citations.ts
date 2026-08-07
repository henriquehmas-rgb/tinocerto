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

// Achado da revisão consolidada pós-Fase 4: o indexOf exato abaixo só
// prova que citacaoVerbatim é um trecho REAL do texto-fonte -- nunca que
// ela de fato SUSTENTA frase.texto (o que o recrutador realmente lê). Uma
// citacaoVerbatim curta e genérica ("de", "na", "com") quase sempre existe
// em qualquer trecho de currículo em português, então uma frase
// inteiramente fabricada ("Foi Diretor Executivo...") podia "citar" um
// desses fragmentos e passar pela verificação inteira -- exatamente a
// "alucinação não detectável" que 05-ia-e-automacao.md §5.3 (citando
// Mobley v. Workday) proíbe. As duas checagens abaixo (piso de tamanho +
// sobreposição lexical) fecham essa lacuna sem exigir uma segunda chamada
// de LLM: uma citação precisa ser substancial, E o CONTEÚDO DA FRASE (a
// alegação) precisa estar rastreável na citação -- não o contrário. A
// direção importa: citacaoVerbatim pode legitimamente conter mais
// detalhe do que a frase resume (ex.: citar "Analista Pleno na Empresa
// Exemplo Ltda" para sustentar só "foi Analista Pleno", sem repetir o
// nome da empresa) -- o que não pode acontecer é a frase alegar algo cujo
// conteúdo não está na citação.
const TAMANHO_MINIMO_CITACAO = 15;

function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function palavrasSignificativas(texto: string): string[] {
  return normalizarTexto(texto)
    .split(/[^a-z0-9]+/)
    .filter((palavra) => palavra.length >= 4);
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

    if (frase.citacaoVerbatim.trim().length < TAMANHO_MINIMO_CITACAO) {
      throw new CitacaoNaoVerificavelError(
        indice,
        `citacaoVerbatim tem menos de ${TAMANHO_MINIMO_CITACAO} caracteres -- curta demais para sustentar a frase (qualquer fragmento genérico seria "encontrado" no texto-fonte sem provar relação nenhuma)`,
      );
    }

    const palavrasFrase = palavrasSignificativas(frase.texto);
    const palavrasCitacao = new Set(palavrasSignificativas(frase.citacaoVerbatim));
    const sustentadas = palavrasFrase.filter((p) => palavrasCitacao.has(p));
    const minimoNecessario = Math.ceil(palavrasFrase.length * 0.3);
    if (palavrasFrase.length === 0 || sustentadas.length < minimoNecessario) {
      throw new CitacaoNaoVerificavelError(
        indice,
        `citacaoVerbatim não tem correspondência lexical suficiente com o conteúdo da frase -- a citação é um trecho real, mas não sustenta a alegação feita, sinal de alucinação desconectada da evidência`,
      );
    }
  });
}
