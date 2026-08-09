import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  outputDir: "./test-results/playwright",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "test-results/playwright-report", open: "never" }]],
  use: { baseURL: "http://127.0.0.1:4314", trace: "retain-on-failure", screenshot: "only-on-failure", video: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "YNX_SEARCH_DATA_PATH=test/e2e/fixture.json PORT=4314 npm start", url: "http://127.0.0.1:4314/api/health", reuseExistingServer: false, timeout: 30_000 }
});
