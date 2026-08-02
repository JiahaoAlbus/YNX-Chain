import { expect, test } from "@playwright/test";

test("Pay Web/PWA shell is keyboard-operable and responsive", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByText("YNX Pay", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Invoice, Split, or service bill" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Pay Web/PWA applies Arabic RTL without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();

  const arabicChoices = page.getByRole("radio", { name: "العربية" });
  await expect(arabicChoices).toHaveCount(2);
  await arabicChoices.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("لغة التطبيق")).toBeVisible();
  expect(await page.locator("div").evaluateAll((nodes) =>
    nodes.some((node) => getComputedStyle(node).direction === "rtl"),
  )).toBe(true);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
