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
