// The standard cloud port 5174 may belong to another project. Same test suite,
// same mock-HTTP boundary, independent origin; never reuse an unknown server.
import { defineConfig } from '@playwright/test';
import config from '../playwright.cloud.config';
export default defineConfig({
  ...config, testDir: '../tests/cloud', outputDir: '../test-results/s5-entry-cloud',
  use: { ...config.use, baseURL: 'http://127.0.0.1:5184' },
  webServer: { ...config.webServer, command: 'npm run dev -- --port 5184 --strictPort', url: 'http://127.0.0.1:5184' },
});
