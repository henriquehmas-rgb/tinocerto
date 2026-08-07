// apps/api/src/copilot/__tests__/verify-candidate-summary-citations.spec.ts
import { CitableSnippet, construirTrechosCitaveis } from '../build-citable-snippets';
import { CitacaoNaoVerificavelError, verificarCitacoesResumoCandidato } from '../verify-candidate-summary-citations';

describe('verificarCitacoesResumoCandidato', () => {
  const trechos: CitableSnippet[] = [
    { fonteId: 'experiencia:0', secao: 'experiencia', itemIndex: 0, texto: 'Analista Pleno na Empresa Exemplo Ltda, de janeiro de 2020 a março de 2023.' },
    { fonteId: 'habilidade:0', secao: 'habilidade', itemIndex: 0, texto: 'Excel avançado' },
  ];

  it('passa quando citacaoVerbatim é um trecho exato do fonteId referenciado', () => {
    expect(() =>
      verificarCitacoesResumoCandidato(
        [{ texto: 'O candidato foi Analista Pleno.', fonteId: 'experiencia:0', citacaoVerbatim: 'Analista Pleno na Empresa Exemplo Ltda' }],
        trechos,
      ),
    ).not.toThrow();
  });

  // Prova de mutação central desta fase: uma citação plausível mas que NÃO
  // é substring exata (aqui, parafraseada -- "Analista Sênior" em vez de
  // "Analista Pleno", o tipo de alucinação sutil que um recrutador lendo o
  // resumo não teria como detectar sozinho) precisa ser rejeitada. Se
  // alguém trocar locateVerbatimOffset por uma comparação frouxa (ex.:
  // includes case-insensitive, similaridade aproximada), este teste é o
  // que detecta a regressão.
  it('rejeita quando citacaoVerbatim não é um trecho exato -- citação fabricada/parafraseada', () => {
    expect(() =>
      verificarCitacoesResumoCandidato(
        [{ texto: 'O candidato foi Analista Sênior.', fonteId: 'experiencia:0', citacaoVerbatim: 'Analista Sênior na Empresa Exemplo Ltda' }],
        trechos,
      ),
    ).toThrow(CitacaoNaoVerificavelError);
  });

  it('rejeita quando fonteId não existe no universo citável', () => {
    expect(() =>
      verificarCitacoesResumoCandidato([{ texto: 'x', fonteId: 'formacao:0', citacaoVerbatim: 'qualquer coisa' }], trechos),
    ).toThrow(CitacaoNaoVerificavelError);
  });

  it('rejeita mesmo que outras frases da lista sejam válidas -- nunca descarta em silêncio só a ruim', () => {
    expect(() =>
      verificarCitacoesResumoCandidato(
        [
          { texto: 'Frase válida.', fonteId: 'habilidade:0', citacaoVerbatim: 'Excel avançado' },
          { texto: 'Frase inventada.', fonteId: 'experiencia:0', citacaoVerbatim: 'Diretor Executivo global' },
        ],
        trechos,
      ),
    ).toThrow(CitacaoNaoVerificavelError);
  });
});

describe('construirTrechosCitaveis', () => {
  it('exclui itens cujo offsetInicio é null -- nunca oferece como fonte uma citação que a Fase 1 não verificou', () => {
    const trechos = construirTrechosCitaveis({
      experiencias: [
        { citacaoVerbatim: 'Analista Pleno', offsetInicio: 10 },
        { citacaoVerbatim: 'trecho não verificado', offsetInicio: null },
      ],
      formacao: [],
      habilidades: [],
    });
    expect(trechos).toHaveLength(1);
    expect(trechos[0].fonteId).toBe('experiencia:0');
  });

  it('devolve lista vazia quando nenhum item tem offset verificado', () => {
    const trechos = construirTrechosCitaveis({
      experiencias: [{ citacaoVerbatim: 'x', offsetInicio: null }],
      formacao: [],
      habilidades: [],
    });
    expect(trechos).toHaveLength(0);
  });
});
