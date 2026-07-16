import { expect, test } from "@playwright/test";
test("authenticates operator and renders operations-specific responsive UI", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("operator");
  await page.getByLabel("Password").fill("operator-local");
  await page.getByRole("button", { name: "Enter Monitor" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("No historical uptime inferred")).toHaveCount(1);
  await page.getByRole("button", { name: /^Alerts(?: \d+)?$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Alerts", level: 1 }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/monitor-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
test("viewer cannot see operator incident mutation", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("viewer");
  await page.getByLabel("Password").fill("viewer-local");
  await page.getByRole("button", { name: "Enter Monitor" }).click();
  await page.getByRole("button", { name: "Incidents", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Record incident" }),
  ).toHaveCount(0);
});
test("persists locale, supports RTL and never caches operations evidence", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.locator(".login-locales select").first().selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  expect((await request.get("/manifest.webmanifest")).ok()).toBe(true);
  const sw = await request.get("/sw.js");
  expect(await sw.text()).toContain("url.pathname.startsWith('/ops/')");
  await expect.poll(()=>page.evaluate(async()=>Boolean(await navigator.serviceWorker.getRegistration()))).toBe(true);
});
