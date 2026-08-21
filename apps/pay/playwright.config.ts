import { defineConfig } from "@playwright/test";
const port=Number(process.env.PAY_WEB_PORT??4173);
const baseURL=`http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: {
    baseURL,
    browserName: "chromium",
    locale: "en-US",
  },
  webServer: {
    command: "node tests/serve.mjs",
    url: baseURL,
    reuseExistingServer: false,
  },
});
