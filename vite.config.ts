import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  test: { include: ['tests/unit/**/*.test.ts'] },
  build: { chunkSizeWarningLimit: 1100 },
});
