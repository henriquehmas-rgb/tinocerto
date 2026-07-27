import { generateTenantSlug } from '../tenant-slug';

describe('generateTenantSlug', () => {
  it('normaliza razão social com acentos e espaços para kebab-case', () => {
    expect(generateTenantSlug('Empresa Exemplo Ltda.', '01j9xa1b2cde')).toBe('empresa-exemplo-ltda-2cde');
  });

  it('usa os últimos 4 caracteres do disambiguator como sufixo', () => {
    const a = generateTenantSlug('Mesma Empresa', 'aaaaaaaa-1111');
    const b = generateTenantSlug('Mesma Empresa', 'bbbbbbbb-2222');
    expect(a).not.toBe(b);
    expect(a.endsWith('1111')).toBe(true);
    expect(b.endsWith('2222')).toBe(true);
  });
});
