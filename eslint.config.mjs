// ESLint flat config — КРУПНЫЙ недостаток #1 (lint отсутствует).
// Требуемые devDeps и скрипты см. в итоговом отчёте (package.json diff предложен,
// не применён: файл вне разрешённого скоупа). Установка:
//   npm i -D eslint @eslint/js typescript-eslint eslint-plugin-svelte eslint-config-prettier prettier
//   npm run lint
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'backend/.venv/**',
      'backend/.data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  // Отключает правила, конфликтующие с prettier. Должен идти последним.
  prettier,
  {
    rules: {
      // DEMO-инструменты и скрипты в tools/ пишут в stdout намеренно.
      'no-console': 'off',
    },
  },
];
