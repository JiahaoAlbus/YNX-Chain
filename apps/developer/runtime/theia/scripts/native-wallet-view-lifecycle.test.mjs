import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NativeWalletController } = require('../../ynx-workbench/lib/native-wallet-controller.js');
const localization = require('../../ynx-workbench/lib/native-wallet-localization.js');
const source = await readFile(new URL('../../ynx-workbench/lib/native-wallet-view.js', import.meta.url), 'utf8');
// Local Theia/DOM stand-ins instantiate the actual Widget and invoke its real
// registered click callback. No browser GUI, SDK grant, device or network runs.
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
class Node {
 constructor(document) { this.ownerDocument = document; this.children = []; this.listeners = new Map(); }
 append(...nodes) { this.children.push(...nodes); }
 setAttribute() {}
 addEventListener(type, listener) { this.listeners.set(type, listener); }
 focus() {}
 click() { this.listeners.get('click')(); }
}
const document = { createElement: () => new Node(document) };
class BaseWidget {
 constructor() { this.node = new Node(document); this.title = {}; this.toDispose = []; }
 dispose() { for (const disposable of this.toDispose.splice(0)) disposable.dispose(); }
 onActivateRequest() {}
}
const loaded = { exports: {} };
vm.runInNewContext(source, { module: loaded, require: name => {
 if (name === '@theia/core/lib/browser/widgets') return { BaseWidget };
 if (name === '@theia/core/lib/browser/common-menus') return { CommonMenus: { VIEW_VIEWS: [] } };
 if (name === '@theia/core/lib/common/nls') return { nls: { localize: (_key, text) => text } };
 if (name === './native-wallet-controller') return { NativeWalletController };
 if (name === './native-wallet-localization') return localization;
 if (name === './native-wallet-sdk.generated') return {};
 throw Error('Unexpected view dependency ' + name);
} });
const { NativeWalletWidget } = loaded.exports;
async function fixture() {
 const calls = [], listeners = new Set();
 const session = { status: 'disconnected', message: 'TEST_ONLY' };
 const runtime = { connection: {
  connectionBinding: { productId: 'developer', platform: 'macos', applicationId: 'com.ynxweb4.developer.testnetpreview' }, current: session,
  async beginYNX() { calls.push('beginYNX'); return { status: 'wallet-opened', sessionState: session }; },
  async restore() { calls.push('restore'); return { status: 'session-state', sessionState: session }; },
  async disconnect() { calls.push('disconnect'); return { status: 'session-state', sessionState: session }; },
  async handleReturn(url) { calls.push(['return', url]); return { status: 'session-state', sessionState: session }; },
 }, async endNativeOperation() { calls.push('end'); } };
 const api = { DEVELOPER_WALLET_V2_SOURCE: { gatewayOrigin: 'TEST_ONLY_no_network' },
  subscribeDeveloperWalletCallbacks: () => () => {}, inspectDeveloperWalletV2Runtime: async () => ({ available: false }),
  beginDeveloperWalletV2Connection: async () => runtime,
  enterDeveloperWalletV2Guest: async () => { calls.push('guest'); return { available: true, sessionState: { status: 'guest', message: 'TEST_ONLY local guest' } }; },
 };
 const controller = new NativeWalletController(api, state => { for (const listener of listeners) listener(state); }, { assertCurrent: () => true });
 const operations = {};
 for (const method of ['guest', 'connect', 'restore', 'disconnect', 'cancel', 'resumeCallback']) {
  const original = controller[method].bind(controller);
  controller[method] = (...args) => { operations[method] = original(...args); return operations[method]; };
 }
 const service = { controller, listeners }, widget = new NativeWalletWidget(service);
 await controller.inspect();
 return { controller, service, widget, api, runtime, calls, operations };
}

// R30 uses the original SDK's public request/router for read-only correlation.
// Only rejection callbacks are constructed: no approval, signature or Native grant.
const router = await import('../../../vendor/wallet-auth-c5/src/product-session-router.js');
const { createProductSessionRequest } = await import('../../../vendor/wallet-auth-c5/src/product-session-v2.js');
const registry = JSON.parse(await readFile(new URL('../../../vendor/wallet-auth-c5/product-session-registry.json', import.meta.url), 'utf8'));
const typescript = require('../../../services/language-service/node_modules/typescript/lib/typescript.js');
const helperSource = await readFile(new URL('../../../frontend/src/wallet/product-session-v2.ts', import.meta.url), 'utf8');
const transpiled = typescript.transpileModule(helperSource, { compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 }, reportDiagnostics: true });
assert.equal(transpiled.diagnostics.length, 0);
const helperExports = {};
vm.runInNewContext(transpiled.outputText, { exports: helperExports, URL, require: id => {
 if (id === './transport') return {};
 if (id.endsWith('/product-wallet-connection.js')) return { PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN: 'https://wallet-auth.ynxweb4.com' };
 if (id.endsWith('/product-session-router.js')) return router;
 if (id.endsWith('/product-session-recovery.js')) return {};
 if (id.endsWith('/product-session-registry.json')) return { default: registry };
 throw Error('Unexpected callback helper dependency ' + id);
} });
async function callbackFixture() {
 const f = await fixture(); let attempts = 0;
 const request = byte => createProductSessionRequest(registry, { productId: 'developer', platform: 'macos', deviceId: 'TEST_ONLY_device_id', deviceKey: 'A2sX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKW', scopes: ['account:read', 'developer:deploy'], purpose: 'TEST_ONLY public rejection routing', nonce: Buffer.alloc(32, byte).toString('base64url'), state: Buffer.alloc(32, byte + 1).toString('base64url') });
 f.requests = [request(1), request(3)]; f.urls = f.requests.map(r => router.createProductSessionReturnURL(registry, r, { result: 'rejected', reason: 'user_rejected' }));
 f.api.classifyDeveloperWalletV2Return = helperExports.classifyDeveloperWalletV2Return;
 f.runtime.connection.beginYNX = async () => { f.calls.push('beginYNX'); const selected = f.requests[Math.min(attempts++, 1)]; f.runtime.connection.current = { status: 'connecting', request: selected }; return { status: 'wallet-opened', sessionState: f.runtime.connection.current }; };
 f.runtime.connection.handleReturn = async url => { const selected = f.runtime.connection.current.request || f.requests[0]; assert.equal(router.parseProductSessionReturnURL(registry, selected, url).status, router.WALLET_ROUTE_STATUS.USER_REJECTED); f.calls.push(['return', url]); return { status: 'session-state', sessionState: { status: 'disconnected' } }; };
 return f;
}

for (const newer of ['connect', 'cancel', 'close-reopen']) {
 test('Widget old Guest rejection cannot overwrite newer ' + newer, async () => {
  const f = await fixture(), entered = deferred(), reply = deferred();
  f.api.enterDeveloperWalletV2Guest = () => { entered.resolve(); return reply.promise; };
  f.widget.buttons.guest.click(); await entered.promise;
  let replacement;
  if (newer === 'connect') await f.controller.connect();
  else if (newer === 'cancel') await f.controller.cancel();
  else { f.widget.dispose(); replacement = new NativeWalletWidget(f.service); await f.controller.connect(); }
  const state = f.controller.state, runtime = f.controller.runtime;
  reply.reject(Object.assign(Error('TEST_ONLY stale Guest failure'), { code: 'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN' }));
  await f.operations.guest.catch(() => {});
  assert.equal(f.controller.state, state, 'Old click catch must not publish into new state');
  assert.equal(f.controller.runtime, runtime, 'New runtime ownership must remain unchanged');
  assert.notEqual(f.controller.state.phase, 'error');
  replacement?.dispose(); f.widget.dispose(); await f.controller.dispose();
 });
}
test('Widget current Guest rejection remains visible once with original public message', async () => {
 const f = await fixture(); let errors = 0; f.service.listeners.add(state => { if (state.phase === 'error') ++errors; });
 f.api.enterDeveloperWalletV2Guest = async () => { throw Error('TEST_ONLY current Guest failure'); };
 f.widget.buttons.guest.click(); await f.operations.guest.catch(() => {});
 assert.equal(f.controller.state.phase, 'error'); assert.equal(f.controller.state.message, 'TEST_ONLY current Guest failure'); assert.equal(errors, 1);
 f.widget.dispose(); await f.controller.dispose();
});
test('Widget original buttons retain normal routing', async t => {
 for (const [button, method] of Object.entries({ connect: 'connect', restore: 'restore', disconnect: 'disconnect', returned: 'resumeCallback', cancel: 'cancel', guest: 'guest' })) {
  await t.test(button, async () => {
   const f = await fixture(); if (button === 'returned') f.controller.receiveCallback('ynxdeveloper://wallet-auth/callback?TEST_ONLY');
   f.widget.buttons[button].click(); assert.ok(f.operations[method]); await f.operations[method];
   if (button === 'guest') assert.equal(f.controller.state.phase, 'guest');
   if (button === 'cancel') assert.equal(f.controller.state.phase, 'cancelled');
   if (button === 'connect') assert.equal(f.controller.state.awaitingCallback, true);
   f.widget.dispose(); await f.controller.dispose();
  });
 }
});

test('Disposed Widget queued click cannot dispatch into a replacement view', async () => {
 const f = await fixture(); f.widget.dispose(); const replacement = new NativeWalletWidget(f.service);
 await f.controller.connect(); const state = f.controller.state, runtime = f.controller.runtime, previousGuest = f.operations.guest;
 f.widget.buttons.guest.click(); assert.equal(f.operations.guest, previousGuest); assert.equal(f.controller.state, state); assert.equal(f.controller.runtime, runtime);
 replacement.dispose(); await f.controller.dispose();
});

test('R30 retained old callback cannot consume the runtime of a fresh Connect', async () => {
 const f = await callbackFixture(); await f.controller.connect(); await f.controller.cancel();
 const [oldURL, newURL] = f.urls; f.controller.receiveCallback(oldURL); await f.controller.connect();
 if (f.controller.inFlight) await f.controller.inFlight;
 assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'return' && call[1] === oldURL), false);
 assert.equal(f.controller.runtime, f.runtime); assert.equal(f.controller.state.awaitingCallback, true);
 f.controller.receiveCallback(newURL); if (f.controller.inFlight) await f.controller.inFlight;
 assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'return' && call[1] === newURL), true);
 f.widget.dispose(); await f.controller.dispose();
});
test('R30 late old callback is ignored without releasing fresh runtime', async () => {
 const f = await callbackFixture(); await f.controller.connect(); await f.controller.cancel(); await f.controller.connect();
 const runtime = f.controller.runtime, before = f.calls.length; f.controller.receiveCallback(f.urls[0]);
 assert.equal(f.calls.length, before); assert.equal(f.controller.runtime, runtime); assert.equal(f.controller.state.awaitingCallback, true);
 f.controller.receiveCallback(f.urls[1]); await f.controller.inFlight;
 assert.deepEqual(f.calls.filter(c => Array.isArray(c) && c[0] === 'return'), [['return', f.urls[1]]]); f.widget.dispose(); await f.controller.dispose();
});
test('R30 early old and current returns wait for the actual SDK request', async () => {
 const f = await callbackFixture(), gate = deferred(), entered = deferred();
 f.api.beginDeveloperWalletV2Connection = () => { entered.resolve(); return gate.promise; };
 const pending = f.controller.connect(); await entered.promise;
 f.controller.receiveCallback(f.urls[1]); f.controller.receiveCallback(f.urls[0]); gate.resolve(f.runtime); await pending;
 if (f.controller.inFlight) await f.controller.inFlight;
 assert.deepEqual(f.calls.filter(c => Array.isArray(c) && c[0] === 'return'), [['return', f.urls[0]]]);
 f.widget.dispose(); await f.controller.dispose();
});
test('R30 duplicate entered callback is delivered once and keeps original URL', async () => {
 const f = await callbackFixture(), gate = deferred(), entered = deferred(); await f.controller.connect();
 f.runtime.connection.handleReturn = async url => { f.calls.push(['return', url]); entered.resolve(); await gate.promise; return { status: 'session-state', sessionState: { status: 'disconnected' } }; };
 f.controller.receiveCallback(f.urls[0]); await entered.promise; f.controller.receiveCallback(f.urls[0]); f.controller.receiveCallback(f.urls[1]); gate.resolve(); await f.controller.inFlight;
 assert.deepEqual(f.calls.filter(c => Array.isArray(c) && c[0] === 'return'), [['return', f.urls[0]]]); f.widget.dispose(); await f.controller.dispose();
});
test('R30 current UNKNOWN keeps original evidence and allows a new exact callback after reconnect', async () => {
 const f = await callbackFixture(); await f.controller.connect(); const original = Object.assign(Error('TEST_ONLY original return UNKNOWN'), { code: 'ORIGINAL_PRIVATE_OUTCOME_UNKNOWN' });
 const valid = f.runtime.connection.handleReturn; f.runtime.connection.handleReturn = async () => { throw original; };
 f.controller.receiveCallback(f.urls[0]); await f.controller.inFlight;
 assert.equal(f.controller.state.failureCode, original.code); assert.equal(f.controller.state.message, original.message); assert.equal(f.controller.callback, f.urls[0]);
 f.runtime.connection.handleReturn = valid; await f.controller.connect(); if (f.controller.inFlight) await f.controller.inFlight;
 f.controller.receiveCallback(f.urls[1]); await f.controller.inFlight;
 assert.deepEqual(f.calls.filter(c => Array.isArray(c) && c[0] === 'return'), [['return', f.urls[1]]]); f.widget.dispose(); await f.controller.dispose();
});
test('R30 cold callback requires explicit original native approval, no automatic SDK action', async () => {
 const f = await callbackFixture(); f.controller.receiveCallback(f.urls[0]); assert.equal(f.calls.length, 0);
 f.widget.buttons.returned.click(); await f.operations.resumeCallback;
 assert.deepEqual(f.calls.filter(c => Array.isArray(c) && c[0] === 'return'), [['return', f.urls[0]]]); f.widget.dispose(); await f.controller.dispose();
});
test('R30 routing hint uses original SDK target and public request identity without authorizing payload', async () => {
 const f = await callbackFixture(); await f.controller.connect();
 const classify = url => helperExports.classifyDeveloperWalletV2Return(f.runtime, url);
 assert.equal(classify(f.urls[0]), 'current'); assert.equal(classify(f.urls[1]), 'mismatch');
 assert.equal(classify(f.urls[0] + '&nonce=' + f.requests[0].nonce), 'mismatch');
 const invalid = f.urls[0].replace('user_rejected', 'not_rejected');
 assert.equal(classify(invalid), 'current', 'Correlation is not approval or payload validation');
 assert.equal(router.parseProductSessionReturnURL(registry, f.requests[0], invalid).status, router.WALLET_ROUTE_STATUS.CALLBACK_MISMATCH);
 f.widget.dispose(); await f.controller.dispose();
});

test('R30 request-matching return arriving before opener reply keeps that original runtime', async () => {
 const f = await callbackFixture(); await f.controller.connect(); await f.controller.cancel();
 const gate = deferred(), entered = deferred(), begin = f.runtime.connection.beginYNX;
 f.runtime.connection.beginYNX = async () => { const result = await begin(); entered.resolve(); await gate.promise; return result; };
 const pending = f.controller.connect(); await entered.promise; f.controller.receiveCallback(f.urls[0]); f.controller.receiveCallback(f.urls[1]);
 assert.equal(f.calls.filter(c => Array.isArray(c) && c[0] === 'return').length, 0); gate.resolve(); await pending; if (f.controller.inFlight) await f.controller.inFlight;
 assert.deepEqual(f.calls.filter(c => Array.isArray(c) && c[0] === 'return'), [['return', f.urls[1]]]); f.widget.dispose(); await f.controller.dispose();
});
test('R30 callback observed while cancelled return drains remains explicit until new request', async () => {
 const f = await callbackFixture(), entered = deferred(), gate = deferred(); await f.controller.connect();
 const valid = f.runtime.connection.handleReturn; f.runtime.connection.handleReturn = async url => { f.calls.push(['return', url]); entered.resolve(); await gate.promise; return { status: 'session-state', sessionState: { status: 'disconnected' } }; };
 f.controller.receiveCallback(f.urls[0]); await entered.promise; const old = f.controller.inFlight; await f.controller.cancel();
 f.controller.receiveCallback(f.urls[1]); gate.resolve(); await old;
 assert.equal(f.controller.state.phase, 'cancelled'); assert.equal(f.controller.state.awaitingCallback, false); assert.equal(f.controller.callback, f.urls[1]);
 f.runtime.connection.handleReturn = valid; await f.controller.connect(); if (f.controller.inFlight) await f.controller.inFlight;
 assert.deepEqual(f.calls.filter(c => Array.isArray(c) && c[0] === 'return'), [['return', f.urls[0]], ['return', f.urls[1]]]); f.widget.dispose(); await f.controller.dispose();
});
