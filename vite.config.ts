import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // Each SQL suite owns a WASM database; avoid exhausting memory on many-core hosts.
    maxWorkers: 1,
    // PGlite bootstrap грузит все миграции в каждом файле; запас под рост S2.
    hookTimeout: 60000,
    // PGlite-тесты под параллельной нагрузкой: дефолтные 5с дают ложные
    // таймауты (машина слабая, миграций уже 14). Лимит среды, не логики.
    testTimeout: 120000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      // Пороги не ставим: сначала собираем базу, гейт — следующим шагом.
    },
  },
  build: { chunkSizeWarningLimit: 1100 },
});
