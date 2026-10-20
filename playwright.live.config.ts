import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/live', outputDir:'test-results/live', workers:1, timeout:60000,
  use:{...devices['Desktop Chrome'],baseURL:'http://127.0.0.1:5175',trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --port 5175 --strictPort',url:'http://127.0.0.1:5175',env:{VITE_API_URL:process.env.SAQ_LIVE_API_URL || 'http://127.0.0.1:8005',VITE_SUPABASE_URL:process.env.SAQ_LIVE_SUPABASE_URL || 'http://127.0.0.1:54321',VITE_SUPABASE_ANON_KEY:process.env.SAQ_LIVE_SUPABASE_KEY || ''},reuseExistingServer:false},
});
