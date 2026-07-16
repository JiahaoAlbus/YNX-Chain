import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', timeout: 90_000, workers: 1, expect:{timeout:15_000}, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4673', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4673', reuseExistingServer: true, timeout: 30_000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', channel: 'chrome' } }
  ]
});
