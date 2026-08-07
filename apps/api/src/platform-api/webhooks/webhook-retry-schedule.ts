// apps/api/src/platform-api/webhooks/webhook-retry-schedule.ts
//
// Exatamente os 8 valores de 04-api-e-webhooks.md §4 ("imediata, 5s, 5min,
// 30min, 2h, 5h, 10h, +10h") -- ver design spec decisão 3 sobre a
// divergência aritmética entre estes intervalos e a anotação "≈42h35min"
// do próprio doc (soma real dos 7 intervalos ≈27h35min). Implementados os
// intervalos LITERAIS, não o total resumido.
export const MAX_ATTEMPTS = 8;

// Índice 0 = atraso entre tentativa 1 e 2; índice 6 = atraso entre
// tentativa 7 e 8. 7 entradas para 8 tentativas.
export const RETRY_SCHEDULE_MS: readonly number[] = [
  5_000, // 5s
  5 * 60_000, // 5min
  30 * 60_000, // 30min
  2 * 3_600_000, // 2h
  5 * 3_600_000, // 5h
  10 * 3_600_000, // 10h
  10 * 3_600_000, // +10h
];
