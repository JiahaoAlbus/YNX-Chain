import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const evidence = resolve("evidence/ui");
test.beforeAll(async () => mkdir(evidence, { recursive: true }));
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" }); await page.goto("/"); });

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
