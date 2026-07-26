import { generateLiaTemplate } from '../lia-template';

describe('generateLiaTemplate', () => {
  it('gera as três seções obrigatórias preenchidas com a finalidade declarada', () => {
    const lia = generateLiaTemplate({
      campoLabel: 'Disponibilidade para viagens frequentes',
      finalidade: 'Avaliar aderência a um cargo que exige viagens semanais',
    });

    expect(lia.testeNecessidade).toContain('Avaliar aderência a um cargo que exige viagens semanais');
    expect(lia.testeProporcionalidade).toContain('Disponibilidade para viagens frequentes');
    expect(lia.salvaguardas).toContain('minimiza');
  });
});
