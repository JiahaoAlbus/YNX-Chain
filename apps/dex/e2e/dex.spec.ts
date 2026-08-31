import { expect, test, type Page, type Route } from "@playwright/test";

const HASH = `0x${"a".repeat(64)}`;
const ASSET = {
  id: "ynx-usd-test",
  symbol: "YUSDT",
  name: "YNX USD Test",
  decimals: 0,
  issuer: "ynx1issuer000000000000000000",
  maxSupply: 1_000_000,
  totalSupply: 100_000,
  blockHeight: 11,
  txHash: HASH,
  auditHash: "b".repeat(64),
};
const POOL = {
  id: "dex_ynxt_yusdt",
  kind: "constant-product",
  asset0: "YNXT",
  asset1: ASSET.id,
  reserve0: 1_000,
  reserve1: 2_000,
  feeBps: 30,
  totalShares: 1_000,
  blockHeight: 12,
  updatedAt: "2026-08-10T03:00:00.000Z",
  txHash: HASH,
  auditHash: "c".repeat(64),
};
async function consensusFixture(
  page: Page,
  options: { delayed?: boolean; failure?: boolean } = {},
) {
  await page.route("**/*", async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== "/v1/native-snapshot") return route.continue();
    if (options.delayed)
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (options.failure) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ failure: true, error: "fixture unavailable" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: "authoritative chain-native YNX Testnet state",
        updatedAt: new Date().toISOString(),
        assets: [ASSET],
        pools: [POOL],
        events: [],
      }),
    });
  });
}

test("quotes committed v13 reserves and keeps transaction signing behind Wallet", async ({
  page,
}) => {
  await consensusFixture(page);
  await page.goto("/");
  await expect(page.getByLabel("You pay token")).toHaveValue("ynxt");
  await page.getByLabel("You pay amount").fill("10");
  await expect(
    page.getByText("Price impact is 5% or higher. Review size and route."),
  ).toBeVisible();
  await expect(page.getByLabel("You receive amount")).toHaveValue("17");
  await page.getByRole("button", { name: "Review swap" }).click();
  const review = page.getByRole("dialog", { name: "Review swap" });
  await expect(review.getByText(POOL.id, { exact: true })).toBeVisible();
  await expect(review.getByText("dex_swap_exact_input")).toBeVisible();
  await expect(
    review.getByRole("button", { name: "Connect Wallet to continue" }),
  ).toBeEnabled();
});

test("exposes the committed pool and real add/remove review forms without fabricated positions", async ({
  page,
}) => {
  await consensusFixture(page);
  await page.goto("/#pools");
  await page.getByRole("button", { name: "YNXT / YUSDT" }).click();
  const detail = page.getByRole("dialog", { name: "YNXT / YUSDT" });
  await expect(detail.getByText(POOL.id)).toBeVisible();
  await detail.getByRole("tab", { name: "Remove liquidity" }).click();
  await expect(
    detail.getByRole("button", { name: "Connect Wallet to remove" }),
  ).toBeEnabled();
  await expect(
    detail.getByText(/exact owned shares and minimum token outputs/i),
  ).toBeVisible();
});

test("mobile layout has no horizontal overflow and keeps primary routes reachable", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "mobile project only");
  await consensusFixture(page);
  await page.goto("/");
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBe(widths.client);
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Pools" })
    .click();
  await expect(page.getByRole("heading", { name: "Pools" })).toBeVisible();
});

test("consensus gateway failure is explicit and fail-closed", async ({
  page,
}) => {
  await consensusFixture(page, { failure: true });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("fixture unavailable");
  await expect(
    page.getByRole("button", { name: "Review swap" }),
  ).toBeDisabled();
});
