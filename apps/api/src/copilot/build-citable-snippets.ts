// apps/api/src/copilot/build-citable-snippets.ts
export type SecaoCitavel = 'experiencia' | 'formacao' | 'habilidade';

export interface CitableSnippet {
  fonteId: string; // "experiencia:0", "formacao:1", "habilidade:0"
  secao: SecaoCitavel;
  itemIndex: number;
  texto: string; // citacaoVerbatim do item de person_profile -- já verificado na Fase 1
}

interface ItemComOffset {
  citacaoVerbatim: string;
  offsetInicio: number | null;
}

export interface PersonProfileParaResumo {
  experiencias: ItemComOffset[];
  formacao: ItemComOffset[];
  habilidades: ItemComOffset[];
}

// Só entram trechos cujo offset já foi verificado na Fase 1 (parsing de
// currículo, resume-parsing.consumer.ts -> withOffset). Um item com
// offsetInicio null é, por definição, uma citação que a própria extração
// não conseguiu confirmar como verbatim no currículo bruto -- oferecê-lo
// aqui como fonte para o resumo de candidato repetiria a mesma alucinação
// não detectável num nível abaixo (05-ia-e-automacao.md §5.3, decisão 8
// do design spec desta fase).
export function construirTrechosCitaveis(profile: PersonProfileParaResumo): CitableSnippet[] {
  const secoes: { chave: SecaoCitavel; itens: ItemComOffset[] }[] = [
    { chave: 'experiencia', itens: profile.experiencias },
    { chave: 'formacao', itens: profile.formacao },
    { chave: 'habilidade', itens: profile.habilidades },
  ];

  const trechos: CitableSnippet[] = [];
  for (const { chave, itens } of secoes) {
    itens.forEach((item, itemIndex) => {
      if (item.offsetInicio !== null) {
        trechos.push({ fonteId: `${chave}:${itemIndex}`, secao: chave, itemIndex, texto: item.citacaoVerbatim });
      }
    });
  }
  return trechos;
}
