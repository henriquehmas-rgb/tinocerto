export function locateVerbatimOffset(texto: string, citacao: string): { offsetInicio: number; offsetFim: number } | null {
  const offsetInicio = texto.indexOf(citacao);
  if (offsetInicio === -1) return null;
  return { offsetInicio, offsetFim: offsetInicio + citacao.length };
}
