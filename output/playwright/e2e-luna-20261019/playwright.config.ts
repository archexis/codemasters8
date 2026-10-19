import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(process.cwd());

export default defineConfig({
  testDir: '.',
  testMatch: 'current-flow.spec.ts',
  outputDir: 'C:/Users/BIGra/codemasters8/test-results/e2e-luna-20261019/artifacts',
  fullyParallel: true,
  workers: 2,
  timeout: 60000,
  reporter: [['json', { outputFile: 'C:/Users/BIGra/codemasters8/test-results/e2e-luna-20261019/flow-report.json' }]],
  use: { baseURL: 'http://127.0.0.1:5176', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5176 --strictPort',
    cwd: root,
    url: 'http://127.0.0.1:5176',
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    reuseExistingServer: false,
  },
});
