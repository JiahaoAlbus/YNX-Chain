import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: [["line"]],
  use: { baseURL: "http://127.0.0.1:4199", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: "npm run preview -- --port 4199", url: "http://127.0.0.1:4199", reuseExistingServer: false, timeout: 30_000 },
});
