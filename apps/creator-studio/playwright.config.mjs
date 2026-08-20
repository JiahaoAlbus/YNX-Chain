import{defineConfig,devices}from'@playwright/test';
export default defineConfig({testDir:'./test/browser',outputDir:'./test-results/playwright',fullyParallel:false,workers:1,timeout:30000,reporter:'list',use:{baseURL:'http://127.0.0.1:4317',screenshot:'only-on-failure',trace:'retain-on-failure'},projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}]});
