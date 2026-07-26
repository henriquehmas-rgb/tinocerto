// Lei 8.213/91 art. 93 -- faixas fixas por tamanho de quadro.
export function calculatePcdQuotaPercent(totalEmpregados: number): number {
  if (totalEmpregados <= 99) return 0;
  if (totalEmpregados <= 200) return 2;
  if (totalEmpregados <= 500) return 3;
  if (totalEmpregados <= 1000) return 4;
  return 5;
}

// CLT art. 429 -- 5% a 15% das funções que demandam formação profissional.
// Aproximação deliberada: aplicamos o percentual sobre o total de
// empregados por não termos, nesta fase, um recorte de "funções que
// demandam formação" separado no cadastro do tenant.
export function calculateAprendizQuotaRange(totalEmpregados: number): { min: number; max: number } {
  return {
    min: Math.max(1, Math.round(totalEmpregados * 0.05)),
    max: Math.max(1, Math.round(totalEmpregados * 0.15)),
  };
}
