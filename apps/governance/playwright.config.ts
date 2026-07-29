import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './node_modules/.cache/playwright-results',
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:41731',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 41731',
    url: 'http://127.0.0.1:41731',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
