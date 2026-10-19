import { defineConfig, devices } from '@playwright/test';
const port=Number(process.env.SAQ_CLOUD_PORT || 5184);
export default defineConfig({
  testDir: './tests/cloud', outputDir:'test-results/cloud', workers: 1, timeout: 60000,
  use: { ...devices['Desktop Chrome'], baseURL:`http://127.0.0.1:${port}`, trace:'retain-on-failure' },
  webServer: { command:`npm run dev -- --port ${port} --strictPort`,url:`http://127.0.0.1:${port}`,env:{VITE_SUPABASE_URL:'http://supabase.test',VITE_SUPABASE_ANON_KEY:'public-test-key'},reuseExistingServer:false },
});
