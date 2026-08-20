import {test, expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

const evidence = '../../docs/handoffs/evidence/ui-audit-current';
const locales = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'id'];

test.beforeAll(async () => mkdir(evidence, {recursive: true}));

for (const viewport of [{name: 'desktop', width: 1440, height: 900}, {name: 'mobile', width: 390, height: 844}]) {
  test(`Resource Market ${viewport.name} responsive and accessible`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page).toHaveTitle('YNX Resource Market');
    await expect(page.getByRole('heading', {name: 'Quote composer'})).toBeVisible();
    await expect(page.locator('.network')).toContainText('6423');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.evaluate(() => document.activeElement?.blur());
    await page.screenshot({path: `${evidence}/resource-market-${viewport.name}.png`, fullPage: true});
  });
}

test('Resource Market saves pending capacity and reports honest AI failure', async ({page}) => {
  await page.goto('/');
  await page.locator('.nav[data-view="overview"]').click();
  await expect(page.getByText('No capacity evidence loaded.')).toBeVisible();
  await page.getByLabel('Requested capacity').fill('100');
  await page.getByLabel('Source reference').fill('staking-receipt:ui');
  await page.getByLabel('Expiry').fill('2027-07-15T09:00');
  await page.getByLabel('Fee per unit').fill('2');
  await page.getByLabel('Max per grant').fill('25');
  await page.getByRole('button', {name: 'Save pending supply draft'}).click();
  await expect(page.getByText('staking-receipt:ui')).toBeVisible();
  await expect(page.getByText('pending capacity evidence')).toBeVisible();
  await page.locator('.nav[data-view="ai"]').click();
  await page.getByRole('button', {name: 'Preview context and cost'}).click();
  await expect(page.locator('#ai-result')).toContainText('PRIVACY PREVIEW');
  await page.getByRole('button', {name: 'Allow explanation'}).click();
  await expect(page.locator('#ai-result')).toContainText('Provider failure');
});

test('all locales persist, Arabic keeps an LTR shell, and settlement text never blanks', async ({page}) => {
  await page.goto('/');
  for (const code of locales) {
    await page.locator('.locale-menu summary').click();
    await page.locator('.locale-select').selectOption(code);
    await expect(page.locator('[data-i18n="boundary"]')).not.toBeEmpty();
    expect(await page.locator('html').getAttribute('dir')).toBe(code === 'ar' ? 'rtl' : 'ltr');
    expect(await page.locator('.market-shell').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  }
  await page.reload();
  await page.locator('.locale-menu summary').click();
  await expect(page.locator('.locale-select')).toHaveValue('id');
});
