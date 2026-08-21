import {test, expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

const evidence = '../../docs/handoffs/evidence/ui-audit-current';
const visibleEvidence = 'evidence/visible';
const locales = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'id'];
const digest = 'a'.repeat(64);

test.beforeAll(async () => {
  await mkdir(evidence, {recursive: true});
  await mkdir(visibleEvidence, {recursive: true});
});

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

test('Trust Center keeps guest access and fails private intake closed', async ({page}) => {
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
  await page.locator('#case-form button[type="submit"]').click();
  await expect(page.locator('#status')).toContainText('App Gateway is unavailable');
  await expect(page.locator('#case-list')).toContainText('No accessible cases');
  await expect(page.locator('body')).not.toContainText('Local test identity');
});

test('accepted SDK connects a standard 0x account while private service stays degraded', async ({page}) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    const provider = {
      request: async ({method}) => {
        if (method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
        if (method === 'eth_chainId') return '0x1917';
        throw Object.assign(new Error('unsupported'), {code: 4200});
      },
      on() {}
    };
    addEventListener('eip6963:requestProvider', () => dispatchEvent(new CustomEvent('eip6963:announceProvider', {detail: {info: {uuid: 'ynx-test-provider', name: 'YNX Wallet'}, provider}})));
  });
  await page.goto('/');
  await page.locator('#wallet-open').click();
  await page.locator('#wallet-connect').click();
  await expect(page.locator('#wallet-standard-state')).toHaveText('CONNECTED · 0x1917');
  await expect(page.locator('#wallet-private-state')).toContainText('DEGRADED');
  await expect(page.locator('#wallet-result')).toContainText('did not remove it');
  await expect(page.getByText('No accessible cases')).toBeVisible();
  await page.screenshot({path: `${visibleEvidence}/trust-wallet-approved-private-degraded-1440x900.png`, fullPage: true});
  expect(consoleErrors).toEqual(['Failed to load resource: the server responded with a status of 401 (Unauthorized)']);
});

test('rejected standard Wallet creates no account and public Trust data remains available', async ({page}) => {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    const provider = {
      request: async ({method}) => {
        if (method === 'eth_requestAccounts') throw Object.assign(new Error('User rejected the request'), {code: 4001});
        if (method === 'eth_chainId') return '0x1917';
        throw Object.assign(new Error('unsupported'), {code: 4200});
      },
      on() {}
    };
    addEventListener('eip6963:requestProvider', () => dispatchEvent(new CustomEvent('eip6963:announceProvider', {detail: {info: {uuid: 'ynx-reject-provider', name: 'YNX Wallet'}, provider}})));
  });
  await page.goto('/');
  await page.locator('#wallet-open').click();
  await page.locator('#wallet-connect').click();
  await expect(page.locator('#wallet-result')).toContainText('WALLET_USER_REJECTED');
  await expect(page.locator('#wallet-standard-state')).not.toContainText('CONNECTED');
  await expect(page.locator('#wallet-account')).toHaveText('Not connected');
  await expect(page.getByText('No accessible cases')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Local test identity');
  await page.screenshot({path: `${visibleEvidence}/trust-wallet-rejected-public-data-1440x900.png`, fullPage: true});
  expect(consoleErrors).toEqual(['Failed to load resource: the server responded with a status of 401 (Unauthorized)']);
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
