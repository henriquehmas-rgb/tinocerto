export function generateTenantSlug(razaoSocial: string, disambiguator: string): string {
  const normalized = razaoSocial
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  const suffix = disambiguator.replace(/-/g, '').slice(-4);
  return `${normalized}-${suffix}`;
}
