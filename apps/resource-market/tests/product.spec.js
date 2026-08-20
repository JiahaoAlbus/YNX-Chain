import {test, expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

const evidence = '../../docs/handoffs/evidence/ui-audit-current';
const locales = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'id'];

test.beforeAll(async () => mkdir(evidence, {recursive: true}));

for (const viewport of [{name: 'desktop', width: 1440, height: 900}, {name: 'mobile', width: 390, height: 844}]) {
  test(`Resource Market ${viewport.name} responsive and accessible`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page).toHaveTitle('YNX Resource Market — Verifiable Infrastructure Capacity');
    await expect(page.getByRole('heading', {name: 'Provider market'})).toBeVisible();
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
  await page.locator('#pool-form').getByLabel('Source reference').fill('staking-receipt:ui');
  await page.locator('#pool-form').getByLabel('Expiry', {exact: true}).fill('2027-07-15T09:00');
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

test('guest sees real Wallet choices and no missing-provider session is fabricated', async ({page}) => {
  await page.goto('/');
  await page.locator('#wallet-open').click();
  await expect(page.getByRole('button', {name: 'Connect YNX Wallet'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Use MetaMask'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Download YNX Wallet'})).toHaveAttribute('href', 'https://ynxweb4.com/dapp/download#wallet');
  await page.getByRole('button', {name: 'Connect YNX Wallet'}).click();
  await expect(page.locator('#wallet-result')).toContainText('not detected');
  await expect(page.locator('#wallet-result')).not.toContainText('session created');
});

test('EIP-6963 YNX Wallet connects while private Resource service stays degraded', async ({page}) => {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const account = '0x1111111111111111111111111111111111111111';
    const provider = {request: async ({method}) => {
      if (method === 'eth_requestAccounts') return [account];
      if (method === 'eth_chainId') return '0x1917';
      throw new Error(`unexpected wallet method ${method}`);
    }};
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: {info: {uuid: 'ynx-visible-test', name: 'YNX Wallet'}, provider},
    })));
  });
  await page.goto('/');
  await page.locator('#wallet-open').click();
  await page.getByRole('button', {name: 'Connect YNX Wallet'}).click();
  await expect(page.locator('#wallet-result')).toContainText('connected on 0x1917');
  await expect(page.locator('#wallet-result')).toContainText('private orders, provider operations and settlement are still degraded', {ignoreCase: true});
  await expect(page.locator('#wallet-open')).toContainText('0x111111');
  expect(errors).toEqual([]);
});

test('provider and buyer workspaces create verified offer, quote and accepted intent', async ({page}) => {
  await page.goto('/');
  await page.locator('.dev-identity summary').click();
  await page.getByLabel('Provider name').fill('UI Compute Provider');
  await page.getByLabel('Region', {exact: true}).fill('local-ui');
  await page.getByLabel('Hardware description').fill('UI test worker');
  await page.getByLabel('Security bond candidate').fill('100');
  await page.getByLabel('Evidence reference').fill('ynx-evidence://ui/provider');
  await page.getByRole('button', {name: 'Register provider'}).click();
  await expect(page.getByText('pending verification')).toBeVisible();

  await page.locator('#actor').fill('ui-verifier');
  await page.locator('#role').selectOption('resource_verifier');
  await page.getByRole('button', {name: 'Verify evidence'}).click();
  await expect(page.getByText('verified', {exact: true})).toBeVisible();

  await page.locator('#actor').fill('ynx1demo');
  await page.locator('#role').selectOption('user');
  await expect(page.locator('#offer-provider')).not.toHaveValue('');
  await page.locator('#offer-form').getByLabel('Resource').selectOption('cpu_compute');
  await page.locator('#offer-form').getByLabel('Unit price', {exact: true}).fill('2');
  await page.locator('#offer-form').getByLabel('Capacity', {exact: true}).fill('1000');
  await page.locator('#offer-form').getByLabel('Maximum order', {exact: true}).fill('500');
  await page.locator('#offer-form').getByLabel('Capacity evidence', {exact: true}).fill('ynx-evidence://ui/capacity');
  await page.getByRole('button', {name: 'Publish verified offer'}).click();

  await page.locator('#actor').fill('ui-buyer');
  await page.locator('#match-form').getByLabel('Resource').selectOption('cpu_compute');
  await page.locator('#match-form').getByLabel('Units', {exact:true}).fill('100');
  await page.getByRole('button', {name: 'Match providers'}).click();
  await page.getByRole('button', {name: 'Create quote'}).click();
  await expect(page.getByText('not reserved or settled')).toBeVisible();
  await page.getByRole('button', {name: 'Accept exact intent'}).click();
  await expect(page.getByText('accepted', {exact: true})).toBeVisible();
  await expect(page.getByText('asset settlement not confirmed')).toBeVisible();

  await page.locator('#actor').fill('ynx1demo');
  const lifecycle=page.locator('#lifecycle-form');
  await lifecycle.getByLabel('Operation').selectOption('reserve');
  await lifecycle.getByLabel('Evidence / Ed25519 integrity string').fill('ui-reservation-evidence');
  await lifecycle.getByRole('button', {name: 'Preview or submit operation'}).click();
  await expect(page.getByText('capacity reserved', {exact: true})).toBeVisible();
  await lifecycle.getByLabel('Operation').selectOption('start_service');
  await lifecycle.getByLabel('Evidence / Ed25519 integrity string').fill('ui-worker-start-evidence');
  await lifecycle.getByRole('button', {name: 'Preview or submit operation'}).click();
  await expect(page.getByText('service started', {exact: true})).toBeVisible();
  await lifecycle.getByLabel('Operation').selectOption('prepare_meter');
  await lifecycle.getByLabel('Quantity').fill('50');
  const usageWindow = await page.evaluate(() => {
    const localInput = (value) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
      .toISOString().slice(0, 16);
    const start = new Date(Date.now() + 60_000);
    return {start: localInput(start), end: localInput(new Date(start.getTime() + 5 * 60_000))};
  });
  await lifecycle.getByLabel('Usage start').fill(usageWindow.start);
  await lifecycle.getByLabel('Usage end').fill(usageWindow.end);
  await lifecycle.getByLabel('Meter source reference').fill('ynx-evidence://ui/meter');
  await lifecycle.getByRole('button', {name: 'Preview or submit operation'}).click();
  await expect(page.locator('#lifecycle-result')).toContainText('canonicalJson');
  await expect(page.locator('#lifecycle-result')).toContainText('Ed25519');

  const offerForm=page.locator('#offer-form');
  await offerForm.getByLabel('Resource').selectOption('cpu_compute');
  await offerForm.getByLabel('Pricing').selectOption('reverse_auction');
  await offerForm.getByLabel('Unit price', {exact:true}).fill('4');
  await offerForm.getByLabel('Capacity', {exact:true}).fill('500');
  await offerForm.getByLabel('Maximum order', {exact:true}).fill('200');
  await offerForm.getByLabel('Capacity evidence', {exact:true}).fill('ynx-evidence://ui/auction-capacity');
  await offerForm.getByRole('button', {name:'Publish verified offer'}).click();
  await expect(page.locator('#status')).toContainText('Offer published');
  await page.locator('#actor').fill('auction-ui-buyer');
  const auctionForm=page.locator('#auction-form');
  await auctionForm.getByLabel('Resource').selectOption('cpu_compute');
  await auctionForm.getByLabel('Auction units').fill('100');
  await auctionForm.getByLabel('Maximum unit price').fill('4');
  const closesAt=await page.evaluate(()=>{const d=new Date(Date.now()+120000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)});
  await auctionForm.getByLabel('Closes at').fill(closesAt);
  await auctionForm.getByLabel('Demand evidence URI').fill('ynx-evidence://ui/demand');
  await auctionForm.getByRole('button', {name:'Open evidenced auction'}).click();
  await expect(page.locator('#auction-list')).toContainText('reverse auction');
  await page.locator('#actor').fill('ynx1demo');
  await page.locator('#actor').press('Tab');
  const bidForm=page.locator('#auction-bid-form');
  await expect(bidForm.locator('#auction-bid-auction')).not.toHaveValue('');
  await expect(bidForm.locator('#auction-bid-offer')).not.toHaveValue('');
  await bidForm.getByLabel('Bid units').fill('100');
  await bidForm.getByLabel('Bid unit price').fill('3');
  await bidForm.getByLabel('Bid evidence URI').fill('ynx-evidence://ui/sealed-bid');
  await bidForm.getByRole('button', {name:'Seal immutable bid'}).click();
  await expect(page.locator('#status')).toContainText('sealed with commitment');
});

test('all locales cover the complete static market corpus, persist, and preserve direction', async ({page}) => {
  await page.goto('/');
  const corpus = await page.evaluate(() => Object.fromEntries(Object.entries(YNXMarketI18n.catalog).map(([code, values]) => [code, values.length])));
  expect(Object.keys(corpus)).toEqual(locales);
  for (const count of Object.values(corpus)) expect(count).toBe(143);
  for (const code of locales) {
    await page.locator('.locale-menu summary').click();
    await page.locator('.locale-select').selectOption(code);
    await expect(page.locator('[data-i18n="boundary"]')).not.toBeEmpty();
    const heading = page.locator('#market .provider-workspace h2').first();
    await expect(heading).not.toBeEmpty();
    expect(await heading.textContent()).toBe(YNXMarketI18nValue(code, corpus, await page.evaluate(() => YNXMarketI18n.catalog)));
    expect(await page.locator('html').getAttribute('dir')).toBe(code === 'ar' ? 'rtl' : 'ltr');
    expect(await page.locator('.market-shell').evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  }
  await page.reload();
  await page.locator('.locale-menu summary').click();
  await expect(page.locator('.locale-select')).toHaveValue('id');
});

test('all operator forms remain labelled and Arabic runtime errors do not leak server prose', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/');
  const formAudit = await page.evaluate(() => {
    const forms = [...document.querySelectorAll('#market form')];
    const missing = [];
    for (const form of forms) {
      for (const control of form.querySelectorAll('input, select, textarea, button')) {
        const label = control.labels?.[0]?.textContent?.trim()
          || control.getAttribute('aria-label')
          || control.textContent?.trim();
        if (!label) missing.push(`${form.id}:${control.tagName}:${control.getAttribute('name') || control.id}`);
      }
    }
    return {forms: forms.length, missing};
  });
  expect(formAudit.forms).toBeGreaterThanOrEqual(12);
  expect(formAudit.missing).toEqual([]);

  await page.locator('.locale-menu summary').click();
  await page.locator('.locale-select').selectOption('ar');
  await page.evaluate(() => document.querySelector('#text-size').click());
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('body')).toHaveClass(/large-text/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

  await page.route('**/api/market/state', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: {'X-Request-ID': 'req_runtime_localization'},
      body: JSON.stringify({
        error: 'INTERNAL ENGLISH DETAIL MUST NOT LEAK',
        code: 'market_unavailable',
        requestId: 'req_runtime_localization',
      }),
    });
  });
  await page.locator('#market-refresh').click();
  await expect(page.locator('#status')).toContainText('غير متاح');
  await expect(page.locator('#status')).toContainText('market_unavailable');
  await expect(page.locator('#status')).toContainText('req_runtime_localization');
  await expect(page.locator('#status')).not.toContainText('INTERNAL ENGLISH DETAIL MUST NOT LEAK');
});

function YNXMarketI18nValue(code, _counts, catalog) {
  return catalog[code][catalog.en.indexOf('Register verifiable capacity')];
}
