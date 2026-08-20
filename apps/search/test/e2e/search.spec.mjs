import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const evidence = resolve("evidence/ui");
test.beforeAll(async () => mkdir(evidence, { recursive: true }));
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" }); await page.goto("/"); });

async function installDeterministicWallet(page, { reject = false } = {}) {
  await page.addInitScript(({ reject }) => {
    const account = "0x1111111111111111111111111111111111111111";
    const provider = {
      async request({ method }) {
        if (method === "eth_requestAccounts") {
          if (reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          return [account];
        }
        if (method === "eth_chainId") return "0x1917";
        throw Object.assign(new Error(`Unsupported deterministic method: ${method}`), { code: 4200 });
      },
      on() {},
      removeListener() {}
    };
    const detail = Object.freeze({
      info: Object.freeze({ uuid: reject ? "ynx-search-reject" : "ynx-search-approve", name: "YNX Test Wallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "com.ynxweb4.wallet.test" }),
      provider
    });
    addEventListener("eip6963:requestProvider", () => dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail })));
  }, { reject });
}

test("desktop success, filters, pagination and cited AI permission preview", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#query").fill("wallet authorization");
  await page.locator("#query").press("Enter");
  await expect(page.getByRole("heading", { name: "Review every Wallet authorization" })).toBeVisible();
  await expect(page.locator(".retrieval")).toContainText("Inference: no");
  await expect(page.locator(".result-meta")).toContainText("receipt");
  await expect(page.locator("#source")).toHaveValue("");
  await page.screenshot({ path: resolve(evidence, "search-desktop-light-success-1440x900.png") });
  await page.getByRole("button", { name: "Answer with cited AI" }).click();
  await expect(page.getByRole("dialog")).toContainText("Provider: unavailable");
  await expect(page.getByRole("button", { name: "Allow selected sources" })).toBeDisabled();
});

test("dark appearance remains legible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Change appearance" }).click();
  await page.locator("#query").fill("private browsing");
  await page.locator("#query").press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: resolve(evidence, "search-desktop-dark-success-1440x900.png") });
});

test("mobile empty state is explicit and never fabricates coverage", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#query").fill("no approved match phrase");
  await page.locator("#query").press("Enter");
  await expect(page.getByRole("heading", { name: "No indexed match" })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "search-mobile-empty-390x844.png") });
});

test("Arabic RTL layout and locale state", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator("#locale").selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ابحث");
  await page.screenshot({ path: resolve(evidence, "search-tablet-arabic-rtl-1024x768.png") });
});

test("large text reflows without horizontal clipping", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("html").evaluate(element => element.dataset.largeText = "true");
  await page.locator("#query").fill("wallet");
  await page.locator("#query").press("Enter");
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).resolves.toBe(true);
  await page.screenshot({ path: resolve(evidence, "search-mobile-large-text-390x844.png") });
});

test("service failure offers retry and preserves the query", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/search?**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "index temporarily unavailable", retryable: true }) }));
  await page.locator("#query").fill("wallet");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Search is unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.locator("#query")).toHaveValue("wallet");
  await page.screenshot({ path: resolve(evidence, "search-desktop-failure-retry-1440x900.png") });
});

test("deterministic YNX Wallet approval preserves guest Search and separates degraded private service", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
  const consoleErrors = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await installDeterministicWallet(page);
  await page.goto("/");
  await page.locator("#query").fill("wallet authorization");
  await page.locator("#query").press("Enter");
  await expect(page.getByRole("heading", { name: "Review every Wallet authorization" })).toBeVisible();
  await page.locator("#wallet-button").click();
  await expect(page.locator("#wallet-button")).toContainText("YNX Test Wallet");
  await expect(page.locator("#network")).toContainText("Standard Wallet connected on 0x1917");
  await page.locator("#private-wallet-button").click();
  await expect(page.locator("#network")).toContainText("remains connected");
  await expect(page.locator("#network")).toContainText("PRIVATE_SERVICE_DEGRADED");
  await expect(page.getByRole("heading", { name: "Review every Wallet authorization" })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "search-wallet-approved-private-degraded-1440x900.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);
  await page.close();
});

test("deterministic Wallet rejection creates no account and guest Search remains usable", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
  const consoleErrors = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await installDeterministicWallet(page, { reject: true });
  await page.goto("/");
  await page.locator("#query").fill("wallet authorization");
  await page.locator("#query").press("Enter");
  await page.locator("#wallet-button").click();
  await expect(page.locator("#wallet-button")).toHaveText("Connect Wallet");
  await expect(page.locator("#private-wallet-button")).toBeDisabled();
  await expect(page.locator("#wallet-recovery")).toBeVisible();
  await expect(page.locator("#wallet-recovery")).toContainText("Download YNX Wallet");
  await expect(page.locator("#wallet-recovery")).toContainText("Use MetaMask");
  await expect(page.locator("#network")).toContainText("User rejected the request");
  await expect(page.getByRole("heading", { name: "Review every Wallet authorization" })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "search-wallet-rejected-guest-search-1440x900.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);
  await page.close();
});
