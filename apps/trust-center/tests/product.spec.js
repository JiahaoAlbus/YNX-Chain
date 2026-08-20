import {test, expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

const evidence = '../../docs/handoffs/evidence/ui-audit-current';
const locales = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'id'];
const digest = 'a'.repeat(64);

test.beforeAll(async () => mkdir(evidence, {recursive: true}));

for (const viewport of [{name: 'desktop', width: 1440, height: 900}, {name: 'mobile', width: 390, height: 844}]) {
  test(`Trust Center ${viewport.name} responsive and accessible`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page).toHaveTitle('YNX Trust Center');
    await expect(page.getByRole('heading', {name: 'Request desk'})).toBeVisible();
    await expect(page.getByText('No direct control')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.evaluate(() => document.activeElement?.blur());
    await page.screenshot({path: `${evidence}/trust-center-${viewport.name}.png`, fullPage: true});
  });
}

test('Trust Center runs bounded intake and honest AI failure', async ({page}) => {
  await page.goto('/');
  await expect(page.getByText('No accessible cases')).toBeVisible();
  await page.locator('.nav[data-view="submit"]').click();
  await page.getByLabel('Subject account').fill('ynx1subject');
  await page.getByLabel('Requester').fill('ynx1reporter');
  await page.getByLabel('Authority').fill('YNX Governance Review Unit');
  await page.getByLabel('Jurisdiction').fill('YNX Testnet / case-specific');
  await page.getByLabel('Request expiry').fill('2027-07-15T09:00');
  await page.getByLabel('Purpose').fill('Request one bounded independent review');
  await page.getByLabel('Request scope').fill('one account, one event, one date range');
  await page.getByLabel('Requested outcome').fill('human review and advisory explanation');
  await page.getByLabel('Packet digest').fill(digest);
  await page.getByLabel('Source', {exact: true}).fill('signed record');
  await page.getByLabel('Source digest').fill(digest);
  await page.getByLabel('Source hash').fill(digest);
  await page.getByLabel('Evidence scope').fill('one signed event');
  await page.getByLabel('Evidence expiry').fill('2027-07-15T09:00');
  await page.locator('#case-form').getByLabel('Evidence summary').fill('Evidence summary visible to the subject.');
  await page.getByRole('button', {name: 'Submit for independent review'}).click();
  await expect(page.locator('#case-detail').getByText('governance review', {exact: true})).toBeVisible();
  await page.locator('.nav[data-view="ai"]').click();
  await page.getByRole('button', {name: 'Preview context and cost'}).click();
  await expect(page.locator('#ai-result')).toContainText('Privacy preview');
  await page.getByRole('button', {name: 'Allow explanation'}).click();
  await expect(page.locator('#ai-result')).toContainText('AI provider unavailable');
});

test('all locales persist, Arabic keeps an LTR shell, and due-process text never blanks', async ({page}) => {
  await page.goto('/');
  for (const code of locales) {
    await page.locator('.locale-menu summary').click();
    await page.locator('.locale-select').selectOption(code);
    await expect(page.locator('[data-i18n="boundaryBody"]')).not.toBeEmpty();
    expect(await page.locator('html').getAttribute('dir')).toBe(code === 'ar' ? 'rtl' : 'ltr');
    expect(await page.locator('.app-shell').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  }
  await page.reload();
  await page.locator('.locale-menu summary').click();
  await expect(page.locator('.locale-select')).toHaveValue('id');
});
