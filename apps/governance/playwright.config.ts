import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const macChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const configuredBrowserPath = process.env.YNX_GOVERNANCE_BROWSER_EXECUTABLE;
const executablePath =
  configuredBrowserPath ||
  (process.platform === 'darwin' && existsSync(macChromePath) ? macChromePath : undefined);

export default defineConfig({
  testDir: './tests',
  outputDir: './node_modules/.cache/playwright-results',
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:41731',
    browserName: 'chromium',
    headless: true,
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 41731',
    url: 'http://127.0.0.1:41731',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
