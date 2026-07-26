import { generateSeoSlug } from '../seo-slug';

describe('generateSeoSlug', () => {
  it('normaliza título com acentos e espaços para kebab-case', () => {
    const slug = generateSeoSlug('Analista de Operações Pleno', '01j9xa1b2cde');
    expect(slug).toBe('analista-de-operacoes-pleno-2cde');
  });

  it('remove caracteres especiais', () => {
    const slug = generateSeoSlug('Vaga (Urgente!) — Dev.Sr/Pleno', '01j9xa1b2cdf');
    expect(slug).toBe('vaga-urgente-dev-sr-pleno-2cdf');
  });

  it('usa os últimos 4 caracteres do disambiguator como sufixo', () => {
    const slugA = generateSeoSlug('Mesmo Título', 'aaaaaaaa-1111');
    const slugB = generateSeoSlug('Mesmo Título', 'bbbbbbbb-2222');
    expect(slugA).not.toBe(slugB);
    expect(slugA.endsWith('1111')).toBe(true);
    expect(slugB.endsWith('2222')).toBe(true);
  });
});
