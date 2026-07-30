/**
 * Config mínima de ESLint para @tinocerto/web.
 *
 * Mesmo problema (e mesma correção) que `apps/api/.eslintrc.cjs` resolveu na
 * Fase 0 Task 17: o script `lint` existia no package.json sem nenhuma config
 * de ESLint atrás dele. No caso do web era pior que "eslint: not found" --
 * o script era `next lint`, que no Next 15 está depreciado e, sem config,
 * abre um PROMPT INTERATIVO ("How would you like to configure ESLint?").
 * Num terminal isso trava; no CI, que é não-interativo, o prompt é cancelado
 * e o comando sai com código 1.
 *
 * Como `ci.yml` roda `pnpm lint` na RAIZ (recursivo, sem --filter), esse
 * exit 1 derrubava o job inteiro de CI -- e, como `deploy.yml` só roda se o
 * CI passar, o pipeline de deploy ficou bloqueado desde que apps/web foi
 * criado (Fase 1b Task 15). O `lint` de apps/api estava limpo o tempo todo,
 * o que fazia o problema passar despercebido em qualquer verificação feita
 * dentro de apps/api.
 *
 * Correção: trocar `next lint` por uma invocação direta de eslint (igual ao
 * apps/api) e dar a ele esta config. Baseline apenas com os recommended sets
 * + JSX habilitado; regras específicas de React/Next ficam para uma task
 * futura dedicada, mesma decisão registrada na config do apps/api.
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
    node: true,
    es2022: true,
  },
  globals: {
    // Tipos globais do React usados em anotação (ex.: React.ReactNode) sem
    // import explícito, padrão do App Router com a nova JSX transform.
    React: 'readonly',
    JSX: 'readonly',
  },
  rules: {
    // Componentes de página do App Router são default-export sem nome de
    // tipo explícito; `any` aqui seria erro real, então fica em warn como
    // no apps/api, não off.
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
