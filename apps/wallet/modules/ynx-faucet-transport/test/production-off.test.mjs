import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionFaucetTransport, faucetTransportReadiness } from '../index.ts';

test('production factory has no runtime argument, global Fetch fallback or unverified native activation', () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error('Unexpected Fetch fallback'); };
  try {
    for (const argument of [undefined, true, { enabled: true, url: 'http://127.0.0.1' }]) {
      assert.equal(createProductionFaucetTransport(argument), null);
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

test('readiness cannot be mutated into an activation or platform acceptance claim', () => {
  assert.deepEqual(faucetTransportReadiness, {
    productionEnabled: false, iosNativeAcceptanceVerified: false, publicRuntimeVerified: true,
  });
  assert.throws(() => { faucetTransportReadiness.productionEnabled = true; }, TypeError);
  assert.equal(createProductionFaucetTransport(), null);
});

test('only the compiled enabled native module is wrapped with exact methods', async () => {
  const calls = [];
  globalThis.expo = { modules: { YnxFaucetTransport: {
    productionEnabled: true,
    reserveTask(purpose) { calls.push(["reserve", purpose]); return "task-1"; },
    async request(options) { calls.push(["request", options]); return { ok: true }; },
    cancel(taskId) { calls.push(["cancel", taskId]); },
  } } };
  try {
    const activated = await import(`../index.ts?activated=${Date.now()}`);
    assert.equal(activated.faucetTransportReadiness.productionEnabled, true);
    assert.equal(activated.faucetTransportReadiness.iosNativeAcceptanceVerified, false);
    const transport = activated.createProductionFaucetTransport();
    assert.ok(transport); assert.equal(transport.reserveTask("admit"), "task-1");
    assert.deepEqual(await transport.request({ purpose: "admit" }), { ok: true });
    transport.cancel("task-1");
    assert.deepEqual(calls, [["reserve", "admit"], ["request", { purpose: "admit" }], ["cancel", "task-1"]]);
    assert.throws(() => { transport.request = null; }, TypeError);
  } finally { delete globalThis.expo; }
});

test('an installed module with a disabled native gate cannot be activated from JavaScript', async () => {
  let calls = 0;
  globalThis.expo = { modules: { YnxFaucetTransport: {
    productionEnabled: false,
    reserveTask() { calls++; return "task-1"; },
    async request() { calls++; return {}; },
    cancel() { calls++; },
  } } };
  try {
    const disabled = await import(`../index.ts?disabled=${Date.now()}`);
    assert.equal(disabled.faucetTransportReadiness.productionEnabled, false);
    assert.equal(disabled.createProductionFaucetTransport(true), null);
    assert.equal(calls, 0);
  } finally { delete globalThis.expo; }
});
