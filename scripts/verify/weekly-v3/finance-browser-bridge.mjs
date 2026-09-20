// Real DOM acceptance adapter. Finance HTML/scripts, native FormData, click
// handlers and the loopback Finance HTTP/store are real. ONLY the signed-in
// session authority is synthetic; the Gateway/provider remain local fixtures.
// No product DOM repair, job injection, FormData shim or remote request allowed.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

export const browserOrigin = 'https://finance.ynxweb4.com';
const staticAssets = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/order-wallet.js', ['order-wallet.js', 'text/javascript']],
  ['/read-sources.js', ['read-sources.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']], ['/ynx-logo.png', ['ynx-logo.png', 'image/png']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
]);
export function validateLoopbackBase(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Exact isolated HTTP loopback root required');
  return url;
}
const orderIDPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function browserRequestPolicy(value, method = 'GET', executionOrderID = '') {
  const url = new URL(value);
  if (url.origin !== browserOrigin || url.username || url.password) return {kind: 'blocked'};
  if (method === 'GET' && !url.search && staticAssets.has(url.pathname))
    return {kind: 'static', asset: staticAssets.get(url.pathname)};
  if (method === 'GET' && url.pathname === '/wallet-auth.js' && !url.search) return {kind: 'authority-fixture'};
  if ((method === 'GET' && (url.pathname.startsWith('/api/') || url.pathname === '/health')) ||
      (method === 'POST' && !executionOrderID && url.pathname === '/api/ai/jobs' && !url.search) ||
      (method === 'POST' && orderIDPattern.test(executionOrderID) &&
       url.pathname === `/api/broker/orders/${executionOrderID}/execution-request` && !url.search))
    return {kind: 'loopback', target: url.pathname + url.search};
  return {kind: 'blocked'};
}

export async function runFinanceBrowserFlow(input, financeRoot) {
  const base = validateLoopbackBase(input.base);
  const mode = input.mode ?? 'draft';
  if (!['draft', 'execution'].includes(mode) || (mode === 'execution' && !orderIDPattern.test(input.orderID)))
    throw new Error('Known browser mode and exact canonical execution order required');
  const executionOrderID = mode === 'execution' ? input.orderID : '';
  if (!financeRoot || !path.isAbsolute(financeRoot)) throw new Error('Exact absolute Finance checkpoint path required');
  const require = createRequire(path.join(financeRoot, 'apps/finance/package.json'));
  const {chromium} = require('playwright');
  const browser = await chromium.launch({headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const result = {scope: 'real-headless-DOM-loopback-Finance-HTTP-synthetic-session-and-Gateway', requests: [], blocked: [], pageErrors: [], officialSandboxVerified: false, realModelGenerationVerified: false};
  try {
    const context = await browser.newContext({serviceWorkers: 'block'});
    let count = 0;
    await context.route('**/*', async route => {
      const request = route.request(), method = request.method(), policy = browserRequestPolicy(request.url(), method, executionOrderID);
      try {
        if (++count > 128) throw new Error('Browser fixture request budget exceeded');
        if (policy.kind === 'blocked') {
          result.blocked.push({url: request.url(), method});
          return await route.abort('blockedbyclient');
        }
        if (policy.kind === 'static') {
          const [asset, contentType] = policy.asset;
          return await route.fulfill({status: 200, contentType, body: fs.readFileSync(path.join(financeRoot, 'apps/finance/web', asset))});
        }
        if (policy.kind === 'authority-fixture') {
          return await route.fulfill({status: 200, contentType: 'text/javascript', body: `window.YNXFinanceWallet={ready:Promise.resolve(),connected:()=>true,getRevision:()=>0,requireProof:async scope=>({proofHeader:scope,requestId:'local-browser-scope-fixture'}),reportPrivateFailure:()=>{}};`});
        }
        const headers = {};
        for (const key of ['content-type', 'x-ynx-product-session-proof-v2', 'x-request-id']) {
          const value = request.headers()[key]; if (value) headers[key] = value;
        }
        headers.Origin = browserOrigin;
        const body = request.postData();
        if (body && Buffer.byteLength(body) > 65536) throw new Error('Oversized browser fixture request');
        const response = await fetch(new URL(policy.target, base), {method, headers, body: body ?? undefined, redirect: 'error', signal: AbortSignal.timeout(10000)});
        const responseBody = await response.text();
        if (Buffer.byteLength(responseBody) > 2 * 1024 * 1024) throw new Error('Oversized Finance fixture response');
        result.requests.push({path: policy.target, method, status: response.status, proofScope: headers['x-ynx-product-session-proof-v2'] ?? '', body, responseBody});
        await route.fulfill({status: response.status, contentType: response.headers.get('content-type') || 'text/plain', body: responseBody});
      } catch (error) {
        result.pageErrors.push(`route: ${error.message}`);
        await route.abort('failed').catch(() => {});
      }
    });
    const page = await context.newPage();
    page.on('pageerror', error => result.pageErrors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.goto(`${browserOrigin}/#${mode === 'execution' ? 'broker-sandbox' : 'assistant'}`, {waitUntil: 'domcontentloaded'});
    if (mode === 'execution') {
      await page.locator('#broker-local-orders .row').first().waitFor({state: 'visible'});
      const button = page.locator(`[data-broker-order-execute="${executionOrderID}"]`);
      if (input.expectExecution !== false) await button.waitFor({state: 'visible'});
      result.executionAvailable = await button.count() === 1 && await button.isEnabled();
      result.dialogs = [];
      if (result.executionAvailable) {
        await Promise.all([
          page.waitForEvent('dialog').then(async dialog => {
            result.dialogs.push({type: dialog.type(), message: dialog.message(), accepted: input.confirm === true});
            if (input.confirm === true) await dialog.accept(); else await dialog.dismiss();
          }),
          button.click(),
        ]);
        if (input.confirm === true)
          await page.waitForFunction(() => document.querySelector('#broker-local-orders').textContent.includes('execution_requested'));
      }
      result.statusText = await page.locator('#broker-local-orders').textContent();
      result.notice = await page.locator('#notice').textContent();
      return result;
    }
    await page.locator('#ai-start').waitFor({state: 'visible'});
    await page.selectOption('#ai-kind', 'draft_broker_order');
    result.intentTag = await page.locator('#ai-order-intent').evaluate(element => element.tagName);
    result.nativeFormData = await page.evaluate(() => Function.prototype.toString.call(FormData).includes('[native code]'));
    await page.locator('#ai-order-intent [name=symbol]').fill('ACME');
    await page.locator('#ai-order-intent [name=side]').selectOption('buy');
    await page.locator('#ai-order-intent [name=qty]').fill('2');
    await page.locator('#ai-order-intent [name=limitPrice]').fill('125.34');
    result.activityCount = await page.locator('#ai-records input').count();
    if (input.selectOwnedActivity === true) {
      for (const checkbox of await page.locator('#ai-records input').all()) await checkbox.check();
    }
    await page.locator('#ai-consent').check();
    await page.locator('#ai-start').click();
    try {
      await page.locator('[data-ai="use-order"]').waitFor({state: 'visible', timeout: 15000});
      result.requestsBeforeCopy = result.requests.length;
      await page.locator('[data-ai="use-order"]').click();
      result.form = await page.locator('#broker-order-form').evaluate(form => Object.fromEntries(new FormData(form)));
      result.assetQuery = await page.locator('#broker-asset-search [name=query]').inputValue();
      result.copied = true;
    } catch (error) {
      result.copied = false;
      result.failure = error.message;
    }
    result.notice = await page.locator('#notice').textContent();
    result.statusText = await page.locator('#ai-status').textContent();
    return result;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  process.stdout.write(JSON.stringify(await runFinanceBrowserFlow(input, process.env.WEEKLY_FINANCE_ROOT)));
}
