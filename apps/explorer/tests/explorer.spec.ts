import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const blocks = Array.from({ length:6 }, (_, index) => ({ height:41-index, hash:`0xblock${41-index}`, timestamp:`2026-07-15T00:00:0${index}Z` }));
  const transactions = Array.from({ length:6 }, (_, index) => ({ hash:`0xtx${6-index}`, type:'native_transfer', from:'ynx1sender', to:'ynx1receiver' }));
  const snapshot = { summary: { network:{ name:'YNX Testnet', chainId:6423, nativeCurrencySymbol:'YNXT' }, rpcHeight:41, indexedHeight:40, indexedTxCount:6, syncLagBlocks:1, nativeSymbol:'YNXT', build:{release:'local-proof'} }, blocks:blocks.slice(0,5), transactions:transactions.slice(0,5), validators:[] };
  await page.route('**/api/stream', route => route.fulfill({ status:200, contentType:'text/event-stream', body:`event: dashboard\ndata: ${JSON.stringify(snapshot)}\n\n` }));
  const payloads:Record<string,unknown>={summary:snapshot.summary,validators:snapshot.validators};
  for (const [path,body] of Object.entries(payloads)) await page.route(`**/api/${path}`, route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) }));
  await page.route(/\/api\/blocks\/latest(?:\?.*)?$/, route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    if (cursor && cursor !== 'signed-block-cursor') return route.fulfill({ status:400, contentType:'application/json', body:JSON.stringify({ error:'invalid_cursor' }) });
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ blocks:cursor?blocks.slice(5):blocks.slice(0,5), nextCursor:cursor?'':'signed-block-cursor', cursorVersion:1 }) });
  });
  await page.route(/\/api\/txs(?:\?.*)?$/, route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    if (cursor && cursor !== 'signed-transaction-cursor') return route.fulfill({ status:400, contentType:'application/json', body:JSON.stringify({ error:'invalid_cursor' }) });
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ transactions:cursor?transactions.slice(5):transactions.slice(0,5), nextCursor:cursor?'':'signed-transaction-cursor', cursorVersion:1 }) });
  });
  await page.route('**/api/search?**', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ query:'41', type:'block', path:'/api/blocks/41', truthfulStatus:'resolved-from-indexer' }) }));
  await page.route('**/api/evidence/block/41', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ schemaVersion:'explorer.public-evidence.v1', evidenceId:'ynx-evidence-sha256:block41', kind:'block', subject:'41', source:{authority:'01-chain-core',system:'ynx-chain',version:'not-declared-by-source',transportOwner:'12-explorer',transport:'ynx-indexer',transportVersion:'local-proof',path:'/api/blocks/41',upstreamPath:'/blocks/41',derivation:'none'}, observedAt:'2026-07-15T00:00:10Z', asOf:blocks[0].timestamp, asOfBasis:'source-event-time', freshness:{state:'partial',stale:false,offline:false,partial:true,rpcHeight:41,indexedHeight:40,lagBlocks:1,reason:'Indexer is 1 block behind the RPC source.'}, coverage:{status:'partial',scope:'requested-record',missing:['records-after-indexed-height']}, correction:{status:'not-declared-by-source'}, integrity:{algorithm:'sha256',digest:'block41'}, payload:blocks[0] }) }));
  await page.route('**/api/blocks/41', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(blocks[0]) }));
});

test('renders real-source states and keyboard-accessible search', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name:/Every claim/ })).toBeVisible();
  await expect(page.getByRole('search')).toBeVisible();
  await expect(page.getByText('Indexer catching up')).toBeVisible();
  await page.screenshot({ path:`test-results/explorer-${testInfo.project.name}.png`, fullPage:true });
});

test('search opens canonical evidence deep links and browser history restores the drawer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('search').getByRole('textbox').fill('41');
  await page.getByRole('button', { name:'Verify' }).click();
  await expect(page).toHaveURL(/\/block\/41$/);
  const drawer = page.locator('aside.drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('01-chain-core')).toBeVisible();
  await expect(drawer.getByText('12-explorer · ynx-indexer')).toBeVisible();
  await expect(drawer.getByText('HTTP 200 · PARTIAL')).toBeVisible();
  await expect(drawer.getByText(/records-after-indexed-height/)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('aside.drawer')).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(/\/block\/41$/);
  await expect(page.locator('aside.drawer')).toBeVisible();
});

test('block pagination sends the server-issued opaque cursor', async ({ page }) => {
  await page.goto('/');
  const blocks = page.locator('#blocks');
  await expect(blocks.getByText('#41')).toBeVisible();
  await blocks.getByRole('button', { name:'Next' }).click();
  await expect(blocks.getByText('#36')).toBeVisible();
  await expect(blocks.getByText('Page 2')).toBeVisible();
  await blocks.getByRole('button', { name:'Previous' }).click();
  await expect(blocks.getByText('#41')).toBeVisible();
});

test('responsive product has no horizontal viewport overflow', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('persists locale, supports RTL and exposes an installable shell',async({page,request})=>{await page.goto('/');await page.getByLabel('Language').selectOption('ar');await expect(page.locator('html')).toHaveAttribute('dir','rtl');await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','ar');expect((await request.get('/manifest.webmanifest')).ok()).toBe(true);const sw=await request.get('/sw.js');expect(await sw.text()).toContain("url.pathname.startsWith('/api/')");await expect.poll(()=>page.evaluate(async()=>Boolean(await navigator.serviceWorker.getRegistration()))).toBe(true)});
