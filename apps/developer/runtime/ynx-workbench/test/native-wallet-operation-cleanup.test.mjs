import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire, stripTypeScriptTypes } from 'node:module';
const { NativeWalletController } = createRequire(import.meta.url)('../lib/native-wallet-controller');
// Exercise the existing TS release closure as well as the production caller.
// This public failure injection supplies no Native admission or session grant.
const source = fs.readFileSync(new URL('../../../frontend/src/wallet/product-session-v2.ts', import.meta.url), 'utf8');
const start = source.indexOf('  let active = grantedDevice !== undefined;');
const end = source.indexOf('  const sdk = createProductWalletConnection({', start);
assert.ok(start >= 0 && end > start);
const makeLifecycle = Function(stripTypeScriptTypes('function lifecycle(grantedDevice,bridge,owner,sdk,developerWalletV2Bridge,journal) { let explicitNativeOwner=owner;\n'
  + source.slice(start, end) + '\nreturn {endNativeOperation,finished}; }', { mode: 'strip' }) + ';return lifecycle;')();
const unknown = Object.assign(Error('TEST_ONLY_NATIVE_RELEASE_UNKNOWN'), { code: 'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN' });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture({ stage = 'method', release = async () => { throw unknown; } } = {}) {
  const count = { factory: 0, method: 0, release: 0, admission: 0 };
  const runtimeGate = deferred();
  const binding = { productId: 'developer', platform: 'macos', applicationId: 'com.ynxweb4.developer.testnetpreview' };
  const api = {
    DEVELOPER_WALLET_V2_SOURCE: { gatewayOrigin: 'https://wallet-auth.ynxweb4.com' },
    subscribeDeveloperWalletCallbacks: () => () => {},
    async beginDeveloperWalletV2Connection() {
      count.factory++;
      if (stage === 'late-factory') await runtimeGate.promise;
      const bridge = { async endConnection() { count.release++; await release(); } };
      const lifecycle = makeLifecycle({}, bridge, Symbol('PUBLIC_FAULT_ONLY'), { setNetworkAvailable() {} }, () => bridge);
      const invoke = async () => { count.method++; if (stage === 'method') throw Error('TEST_ONLY_SDK_FAILURE'); return { status: 'session-state', sessionState: { status: 'disconnected' } }; };
      return { ...lifecycle, connection: { connectionBinding: binding, beginYNX: invoke, restore: invoke, disconnect: invoke } };
    },
  };
  const controller = new NativeWalletController(api, () => {}, { async assertCurrent() {
    count.admission++; if (stage === 'admission' && count.admission === 2) throw Error('TEST_ONLY_REVOKED');
  } });
  return { controller, count, runtimeGate };
}
for (const stage of ['method', 'admission', 'completed-method']) test(`${stage} failure retains unknown native cleanup and refuses a second acquisition`, async () => {
  const f = fixture({ stage });
  await f.controller.connect();
  assert.equal(f.controller.state.busy, true);
  assert.ok(f.controller.cancelling?.runtime, 'original cleanup runtime must remain owned');
  assert.equal(f.controller.state.cleanupStatus, 'unknown');
  assert.equal(f.controller.state.sessionCurrent, false);
  assert.equal(f.controller.state.projectCapability, 'not-supplied');
  assert.equal(f.controller.inFlight, undefined, 'finished SDK caller is distinct from unresolved native cleanup');
  await f.controller.connect(); await f.controller.restore(); await f.controller.disconnect(); await f.controller.cancel();
  assert.equal(f.count.factory, 1); assert.equal(f.count.release, 1);
  if (stage === 'admission') assert.equal(f.count.method, 0);
  await f.controller.dispose(); assert.equal(f.count.release, 1);
});
test('cancel before a late factory cannot lose an unknown release or enter the SDK', async () => {
  const f = fixture({ stage: 'late-factory' });
  const operation = f.controller.connect();
  while (!f.count.factory) await Promise.resolve();
  await f.controller.cancel(); f.runtimeGate.resolve(); await operation;
  assert.equal(f.controller.state.phase, 'cancelled'); assert.equal(f.controller.state.busy, true);
  assert.equal(f.controller.state.cleanupStatus, 'unknown');
  assert.ok(f.controller.cancelling?.runtime); assert.equal(f.count.method, 0);
  await f.controller.connect(); assert.equal(f.count.factory, 1); assert.equal(f.count.release, 1);
  await f.controller.dispose();
});
test('confirmed cleanup after SDK failure allows explicit retry with a new runtime', async () => {
  const f = fixture({ release: async () => {} });
  await f.controller.connect(); assert.equal(f.controller.state.busy, false); assert.equal(f.controller.cancelling, undefined);
  await f.controller.connect(); assert.equal(f.count.factory, 2); assert.equal(f.count.method, 2); assert.equal(f.count.release, 2);
  await f.controller.dispose();
});
test('cancel during error cleanup joins the exact release and retains unknown outcome', async () => {
  const entered = deferred(), gate = deferred();
  const f = fixture({ release: async () => { entered.resolve(); await gate.promise; throw unknown; } });
  const operation = f.controller.connect(); await entered.promise;
  const cancellation = f.controller.cancel(); gate.resolve(); await Promise.all([operation, cancellation]);
  assert.equal(f.count.release, 1); assert.equal(f.controller.state.busy, true); assert.ok(f.controller.cancelling?.runtime);
  assert.equal(f.controller.state.cleanupStatus, 'unknown');
  await f.controller.connect(); assert.equal(f.count.factory, 1); await f.controller.dispose();
});
test('unknown cleanup UI cannot suggest retry or keep a nonfunctional Cancel button enabled', () => {
  const require = createRequire(import.meta.url), module = { exports: {} };
  const locale = require('../lib/native-wallet-localization');
  const code = fs.readFileSync(new URL('../lib/native-wallet-view.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, { module, require: name => name === '@theia/core/lib/browser/widgets' ? { BaseWidget: class {} }
    : name === '@theia/core/lib/browser/common-menus' ? { CommonMenus: { VIEW_VIEWS: [] } }
    : name === '@theia/core/lib/common/nls' ? { nls: { localize: (_key, text) => text } }
    : name === './native-wallet-localization' ? locale : name === './native-wallet-controller' ? { NativeWalletController } : {} });
  const widget = { status: {}, session: {}, detail: {}, source: {}, buttons: Object.fromEntries(['connect','restore','disconnect','returned','cancel','guest'].map(key => [key, {}])) };
  module.exports.NativeWalletWidget.prototype.renderState.call(widget, {
    phase: 'error', cleanupStatus: 'unknown', busy: true, session: { status: 'disconnected' }, serviceConfiguration: 'unverified', message: '/private/native-unknown',
  });
  assert.match(widget.status.textContent, /cleanup.*not confirmed/i);
  assert.doesNotMatch(widget.detail.textContent, /retry|private|native-unknown/i);
  assert.equal(widget.buttons.connect.disabled, true); assert.equal(widget.buttons.cancel.disabled, true);
  for (const key of ['cleanupUnknown', 'cleanupUnknownDetail']) assert.ok(locale.ZH[key] && locale.EN[key]);
});
