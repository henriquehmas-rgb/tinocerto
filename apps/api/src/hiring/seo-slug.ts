export function generateSeoSlug(titulo: string, disambiguator: string): string {
  const normalized = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ') // caracteres especiais viram espaço
    .trim()
    .replace(/\s+/g, '-') // espaços viram hífen
    .replace(/-+/g, '-'); // colapsa hífens repetidos

  const suffix = disambiguator.replace(/-/g, '').slice(-4);
  return `${normalized}-${suffix}`;
}
