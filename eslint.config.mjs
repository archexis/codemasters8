// ESLint flat config — КРУПНЫЙ недостаток #1 (lint отсутствует).
// Требуемые devDeps и скрипты см. в итоговом отчёте (package.json diff предложен,
// не применён: файл вне разрешённого скоупа). Установка:
//   npm i -D eslint @eslint/js typescript-eslint eslint-plugin-svelte eslint-config-prettier prettier
//   npm run lint
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
      'backend/.venv/**',
      'backend/.data/**',
      // Сгенерированное и чужие артефакты: playwright traces, worktrees,
      // graphify-кэш. Линтуем только свой исходный код.
      '.playwright-cli/**',
      '.worktrees/**',
      'graphify-out/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  // Отключает правила, конфликтующие с prettier. Должен идти последним.
  prettier,
  {
    // Браузерный код: src, тесты, supabase functions.
    files: ['src/**/*', 'tests/**/*', 'supabase/functions/**/*', 'playwright*.config.ts', 'vite.config.ts', 'svelte.config.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    // Node-скрипты и конфиги.
    files: ['tools/**/*', 'eslint.config.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Legacy CJS-фикстуры: require() здесь единственно верный импорт.
    files: ['**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      // DEMO-инструменты и скрипты в tools/ пишут в stdout намеренно.
      'no-console': 'off',
      // any в тестах и доменных кастах — постепенно чистим, пока warn.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // svelte-check (tsc) уже покрывает типы .svelte; eslint-процессор под
    // Svelte 5 runes ($props/$state) — отдельным шагом, пока исключаем.
    ignores: ['**/*.svelte'],
  },
];
