import { classificarTermosClinicos, TERMOS_CLINICOS } from '../clinical-vocabulary-linter';

describe('classificarTermosClinicos', () => {
  it.each([
    'O candidato apresenta transtorno de ansiedade.',
    'Sugere-se tratamento psicológico.',
    'Perfil compatível com quadro de depressão.',
    'O diagnóstico indica traços patológicos.',
    'Apresenta sintomas de estresse.',
    'Recomenda-se terapia.',
  ])('detecta vocabulário clínico em: %s', (texto) => {
    expect(classificarTermosClinicos(texto).length).toBeGreaterThan(0);
  });

  it.each([
    'No trabalho, tende a planejar tarefas com antecedência.',
    'Demonstra preferência por conduzir discussões em grupo.',
    'Mantém o ritmo de entrega sob prazos apertados.',
    'Escore bruto acima da mediana das candidaturas desta vaga.',
  ])('não acusa falso positivo em texto comportamental: %s', (texto) => {
    expect(classificarTermosClinicos(texto)).toEqual([]);
  });

  it('detecta independentemente de acento e caixa', () => {
    expect(classificarTermosClinicos('DIAGNOSTICO psicologico').length).toBeGreaterThan(0);
    expect(classificarTermosClinicos('Diagnóstico Psicológico').length).toBeGreaterThan(0);
  });

  it('não confunde "avaliação psicológica" do rodapé obrigatório com uso clínico', () => {
    // O rodapé legalmente exigido CONTÉM a expressão, negada. O linter roda
    // sobre o corpo do relatório, não sobre o rodapé -- ver report.service.
    const termos = classificarTermosClinicos('não constitui avaliação psicológica');
    expect(termos.length).toBeGreaterThan(0);
  });
});

// Uma frase por RAIZ da lista, escrita na flexão que um relatório real usaria
// -- não o literal da entrada. Sonda com o literal ('clinic') não provaria
// nada: o que precisa valer é que a palavra FLEXIONADA seja pega.
const SONDAS: Record<string, string> = {
  transtorno: 'Indica transtorno de conduta.',
  patolog: 'O quadro é patológico.',
  sintoma: 'Apresenta sintomas relevantes.',
  diagnostic: 'Sugere-se diagnóstico complementar.',
  depress: 'Traços depressivos foram observados.',
  ansiedade: 'Nível de ansiedade elevado.',
  ansios: 'Candidato ansioso sob pressão.',
  neuro: 'Comportamento neurótico.',
  psicolog: 'Recomenda-se avaliação psicológica.',
  psiquiatr: 'Encaminhar ao psiquiatra.',
  terapia: 'Está em terapia semanal.',
  tratamento: 'Segue tratamento contínuo.',
  doenca: 'Histórico de doença prolongada.',
  sindrome: 'Compatível com síndrome de burnout.',
  compulsi: 'Comportamento compulsivo.',
  fobia: 'Demonstra fobia social.',
  clinic: 'Recomenda-se avaliação clínica.',
  trauma: 'Relato de evento traumático.',
  medic: 'Faz uso de medicação controlada.',
};

describe('cobertura da lista de termos clínicos', () => {
  it('toda raiz da lista tem sonda, e toda sonda está na lista', () => {
    // Guarda de cobertura: sem isto, acrescentar uma raiz sem sonda (ou
    // truncar uma raiz errado) passa despercebido. Antes desta revisão, 7
    // das 16 entradas não tinham NENHUMA asserção.
    expect(Object.keys(SONDAS).sort()).toEqual([...TERMOS_CLINICOS].sort());
  });

  for (const [raiz, frase] of Object.entries(SONDAS)) {
    it(`pega a flexão de '${raiz}' em: ${frase}`, () => {
      expect(classificarTermosClinicos(frase)).toContain(raiz);
    });
  }

  it('não acusa texto comportamental legítimo', () => {
    // Contrapeso: a lista acima só é útil se não disparar no vocabulário que
    // o relatório de fato usa. Sem este caso, `TERMOS_CLINICOS = ['']`
    // passaria em todos os testes acima.
    const legitimo = [
      'Tende a planejar com antecedência e revisar entregas.',
      'Equilibra planejamento e flexibilidade conforme a demanda.',
      'Busca consenso antes de decidir e sustenta prazos sem cobrança.',
      'Prefere ambientes de troca frequente e trabalho em grupo.',
    ];
    for (const frase of legitimo) {
      expect(classificarTermosClinicos(frase)).toEqual([]);
    }
  });
});
