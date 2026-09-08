import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionFaucetTransport, faucetTransportReadiness } from '../index.ts';

test('production factory has no runtime argument that enables a native or Fetch transport', () => {
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
    productionEnabled: false, iosNativeAcceptanceVerified: false, publicRuntimeVerified: false,
  });
  assert.throws(() => { faucetTransportReadiness.productionEnabled = true; }, TypeError);
  assert.equal(createProductionFaucetTransport(), null);
});
