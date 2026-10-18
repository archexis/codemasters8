import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/cloud', outputDir:'test-results/cloud', workers: 1, timeout: 60000,
  use: { ...devices['Desktop Chrome'], baseURL:'http://127.0.0.1:5174', trace:'retain-on-failure' },
  webServer: { command:'npm run dev -- --port 5174 --strictPort',url:'http://127.0.0.1:5174',env:{VITE_SUPABASE_URL:'http://supabase.test',VITE_SUPABASE_ANON_KEY:'public-test-key'},reuseExistingServer:false },
});
