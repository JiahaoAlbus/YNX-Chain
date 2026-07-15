import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const snapshot = { summary: { network:'ynx_6423-1', chainId:6423, nativeSymbol:'YNXT', latestHeight:41, indexedHeight:40, indexedTxCount:3, build:{release:'local-proof'} }, blocks:[{height:41,hash:'0xabc',timestamp:'2026-07-15T00:00:00Z'}], transactions:[{hash:'0xdef',type:'native_transfer',from:'ynx1sender',to:'ynx1receiver'}], validators:[] };
  await page.route('**/api/stream', route => route.fulfill({ status:200, contentType:'text/event-stream', body:`event: dashboard\ndata: ${JSON.stringify(snapshot)}\n\n` }));
  const payloads:Record<string,unknown>={summary:snapshot.summary,'blocks/latest':snapshot.blocks,txs:snapshot.transactions,validators:snapshot.validators};
  for (const [path,body] of Object.entries(payloads)) await page.route(`**/api/${path}`, route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) }));
});

test('renders real-source states and keyboard-accessible search', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name:/Every claim/ })).toBeVisible();
  await expect(page.getByRole('search')).toBeVisible();
  await expect(page.getByText('Indexer catching up')).toBeVisible();
  await page.screenshot({ path:`test-results/explorer-${testInfo.project.name}.png`, fullPage:true });
});

test('responsive product has no horizontal viewport overflow', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
