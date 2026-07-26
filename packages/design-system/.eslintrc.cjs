/**
 * Config mínima de ESLint para @tinocerto/design-system.
 *
 * Mesmo racional do apps/api/.eslintrc.cjs (ver comentário lá): o script
 * `lint` existia mas eslint nunca tinha sido instalado/configurado.
 * Adicionado como parte da Task 17 (CI/CD) para o step `pnpm lint` do
 * pipeline funcionar de verdade. JSX habilitado no parser porque este
 * pacote tem componentes .tsx (React).
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    browser: true,
    es2022: true,
  },
  rules: {},
};
