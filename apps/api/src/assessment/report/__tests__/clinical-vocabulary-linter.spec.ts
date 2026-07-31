import { classificarTermosClinicos } from '../clinical-vocabulary-linter';

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
