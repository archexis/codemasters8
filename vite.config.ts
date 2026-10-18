import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // PGlite bootstrap грузит все миграции в каждом файле; запас под рост S2.
    hookTimeout: 60000,
    // PGlite-тесты под параллельной нагрузкой: дефолтные 5с дают ложные
    // таймауты (машина слабая, миграций уже 14). Лимит среды, не логики.
    testTimeout: 120000,
  },
  build: { chunkSizeWarningLimit: 1100 },
});
