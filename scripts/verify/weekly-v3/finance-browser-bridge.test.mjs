import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {browserOrigin, browserRequestPolicy, validateLoopbackBase} from './finance-browser-bridge.mjs';

test('real DOM bridge pins all backend forwarding to explicit loopback root', () => {
  assert.equal(validateLoopbackBase('http://127.0.0.1:12345').origin, 'http://127.0.0.1:12345');
  for (const value of ['https://127.0.0.1:12345', 'http://localhost:12345', 'http://127.0.0.1',
    'http://user:pass@127.0.0.1:12345', 'http://127.0.0.1:12345/api', 'http://127.0.0.1:12345/?a=b',
    'https://broker-api.sandbox.alpaca.markets', 'http://127.0.0.1:12345/#x'])
    assert.throws(() => validateLoopbackBase(value), /loopback/);
});
test('real DOM bridge permits only exact immutable static paths', () => {
  for (const file of ['/', '/app.js', '/order-wallet.js', '/read-sources.js', '/styles.css'])
    assert.equal(browserRequestPolicy(browserOrigin + file).kind, 'static');
  for (const file of ['/app.js?patch=true', '/secret.env', '/../../../etc/passwd'])
    assert.equal(browserRequestPolicy(browserOrigin + file).kind, 'blocked');
  assert.equal(browserRequestPolicy(browserOrigin + '/app.js', 'POST').kind, 'blocked');
});
test('real DOM bridge permits AI start but blocks all provider/approval write entry points', () => {
  assert.equal(browserRequestPolicy(browserOrigin + '/api/ai/jobs', 'POST').kind, 'loopback');
  for (const endpoint of ['/api/broker/challenges', '/api/broker/callback', '/api/broker/submit',
    '/api/broker/execute', '/api/broker/cancel-request', '/api/ai/jobs/id/decision'])
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'])
      assert.equal(browserRequestPolicy(browserOrigin + endpoint, method).kind, 'blocked');
});
test('real DOM bridge rejects all external network and origin lookalikes', () => {
  for (const url of ['https://broker-api.sandbox.alpaca.markets/v1/accounts',
    'https://finance.ynxweb4.com.evil.invalid/api/ai/jobs', 'http://finance.ynxweb4.com/app.js',
    'https://user:pass@finance.ynxweb4.com/api/overview', 'https://rpc-testnet.ynxweb4.com/'])
    assert.equal(browserRequestPolicy(url).kind, 'blocked');
});
test('real DOM bridge preserves API query and dedicated scope authority fixture', () => {
  assert.deepEqual(browserRequestPolicy(browserOrigin + '/api/broker/assets?query=ACME'), {kind: 'loopback', target: '/api/broker/assets?query=ACME'});
  assert.equal(browserRequestPolicy(browserOrigin + '/wallet-auth.js').kind, 'authority-fixture');
  assert.equal(browserRequestPolicy(browserOrigin + '/wallet-auth.js?changed=1').kind, 'blocked');
});

test('execution browser mode permits only its exact selected order and no other write', () => {
  const order = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const route = `/api/broker/orders/${order}/execution-request`;
  assert.deepEqual(browserRequestPolicy(browserOrigin + route, 'POST', order), {kind: 'loopback', target: route});
  assert.equal(browserRequestPolicy(browserOrigin + route, 'POST').kind, 'blocked');
  for (const target of ['/api/ai/jobs', '/api/broker/challenges', route + '?override=true',
    route.replace('aaaaaaaa', 'bbbbbbbb'), route.replace('execution-request', 'cancel-request')])
    assert.equal(browserRequestPolicy(browserOrigin + target, 'POST', order).kind, 'blocked');
  for (const invalid of ['*', '../' + order, order.toUpperCase(), order.replace('-4', '-1')])
    assert.equal(browserRequestPolicy(browserOrigin + route, 'POST', invalid).kind, 'blocked');
  assert.equal(browserRequestPolicy('https://broker-api.sandbox.alpaca.markets' + route, 'POST', order).kind, 'blocked');
});

test('Chromium native FormData rejects DIV and accepts FORM without a product patch', {skip: !process.env.WEEKLY_FINANCE_ROOT}, async () => {
  // Dependency-only browser self-test; does not read/run any Finance product
  // HTML/script or issue HTTP. It is safe while the product owner is editing.
  const require = createRequire(path.join(process.env.WEEKLY_FINANCE_ROOT, 'apps/finance/package.json'));
  const {chromium} = require('playwright');
  const browser = await chromium.launch({headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const context = await browser.newContext({serviceWorkers: 'block'});
    await context.route('**/*', route => route.abort('blockedbyclient'));
    const page = await context.newPage();
    await page.setContent('<div id="bad"><input name="symbol" value="ACME"></div><form id="good"><input name="symbol" value="ACME"></form>');
    const result = await page.evaluate(() => {
      let rejected = false;
      try { new FormData(document.querySelector('#bad')); } catch (error) { rejected = error instanceof TypeError; }
      return {rejected, value: new FormData(document.querySelector('#good')).get('symbol'), native: String(FormData).includes('[native code]')};
    });
    assert.deepEqual(result, {rejected: true, value: 'ACME', native: true});
  } finally { await browser.close(); }
});
