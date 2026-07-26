/**
 * Config mínima de ESLint para @tinocerto/api.
 *
 * Descoberta durante a Task 17 (CI/CD): o script `lint` já existia no
 * package.json, mas eslint nunca tinha sido adicionado como dependência
 * nem configurado — `pnpm lint` falhava com "eslint: not found" mesmo
 * localmente, fora do CI. Isso bloqueava o step `pnpm lint` do pipeline
 * de CI (ci.yml), então essa config foi adicionada como parte da Task 17
 * para o pipeline funcionar de verdade. Usa apenas os recommended sets
 * (ESLint core + @typescript-eslint) como baseline; regras específicas do
 * time ficam para uma task futura dedicada a padrões de lint.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    jest: true,
    es2022: true,
  },
  rules: {
    // Rebaixado para warn (não off): src/authz/cerbos.service.ts usa
    // `Record<string, any>` de propósito, para casar com a assinatura do
    // SDK @cerbos/http na fronteira com uma lib externa. Esse arquivo já
    // passou por múltiplas rodadas de revisão adversarial de segurança
    // (Task 10) — não é escopo da Task 17 (CI/CD) alterar código de authz
    // já revisado só para satisfazer uma regra de lint introduzida agora.
    // `warn` mantém o alerta visível no log de CI sem quebrar o pipeline.
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
