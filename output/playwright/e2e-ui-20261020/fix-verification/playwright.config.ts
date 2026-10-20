import { defineConfig } from '@playwright/test';
import base from '../../../../playwright.config';

export default defineConfig({
  ...base,
  testDir: '../../../../tests/e2e',
  outputDir: './test-results',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5177' },
  webServer: {
    command: 'npm run dev -- --port 5177 --strictPort',
    cwd: '../../../..',
    url: 'http://127.0.0.1:5177',
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    reuseExistingServer: false,
  },
});
