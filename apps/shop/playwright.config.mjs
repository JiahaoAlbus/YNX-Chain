import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'./test/browser',outputDir:'./test-results/playwright',workers:1,fullyParallel:false,timeout:30000,reporter:'list',
  use:{baseURL:'http://127.0.0.1:4317',serviceWorkers:'block',screenshot:'only-on-failure',trace:'retain-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
});
