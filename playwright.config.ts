import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: true, workers: 2, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:5176', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: { command: 'npm run dev -- --port 5176 --strictPort', url: 'http://127.0.0.1:5176', env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }, reuseExistingServer: false },
});
