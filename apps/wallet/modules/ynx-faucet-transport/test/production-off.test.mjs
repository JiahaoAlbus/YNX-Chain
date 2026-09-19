import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionFaucetTransport, faucetTransportReadiness } from '../index.ts';

test('production factory has no Fetch fallback when the native module is absent', () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error('Unexpected Fetch fallback'); };
  try {
    assert.equal(createProductionFaucetTransport(), null);
    assert.equal(createProductionFaucetTransport('legacy'), null);
    assert.equal(createProductionFaucetTransport('invalid'), null);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

test('native routes are fixed enums and never caller-controlled URLs', async () => {
  const calls = [];
  globalThis.expo = { modules: { YnxFaucetTransport: {
    reserveTask(route, purpose) { calls.push(['reserve', route, purpose]); return `${route}_task`; },
    request(input) { calls.push(['request', input.route, input.taskId]); return Promise.resolve({ url: input.route === 'primary' ? 'https://faucet-testnet.ynxweb4.com/request' : 'https://faucet.ynxweb4.com/request', redirected: false, status: 503, contentType: 'application/json', cacheControl: 'no-store', body: '{}' }); },
    cancel(route, taskId) { calls.push(['cancel', route, taskId]); },
  } } };
  const primary = createProductionFaucetTransport('primary');
  const legacy = createProductionFaucetTransport('legacy');
  assert.ok(primary); assert.ok(legacy);
  const primaryTask = primary.reserveTask('admit');
  await primary.request({ purpose: 'admit', taskId: primaryTask, requestId: 'x'.repeat(32), body: '{}' });
  primary.cancel(primaryTask);
  const legacyTask = legacy.reserveTask('rpc'); legacy.cancel(legacyTask);
  assert.deepEqual(calls, [
    ['reserve', 'primary', 'admit'], ['request', 'primary', 'primary_task'], ['cancel', 'primary', 'primary_task'],
    ['reserve', 'legacy', 'rpc'], ['cancel', 'legacy', 'legacy_task'],
  ]);
});

test('readiness cannot be mutated into broader platform acceptance claims', () => {
  assert.deepEqual(faucetTransportReadiness, {
    productionEnabled: true, iosNativeAcceptanceVerified: false, publicRuntimeVerified: false,
  });
  assert.throws(() => { faucetTransportReadiness.publicRuntimeVerified = true; }, TypeError);
});
