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
 if (id.endsWith('/product-session-router.js')) return { walletConnectionChoices: router.walletConnectionChoices };
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
test('R32 routing hint consumes actual SDK current request without undeclared public exports', async () => {
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

// R39 exercises actual Widget click/render/dispose with the real controller.
// Native factory/admission/SDK effects are scheduling fixtures; no grant runs.
for (const action of ['connect','restore','disconnect']) {
 test('R39 '+action+' claims its pending slot before close/reopen state listeners can retry', async () => {
  const f=await fixture();let first=true,observedOwner,replacement,reentered,blocked;
  const listener=state=>{if(!first||state.phase!=='approving')return;first=false;observedOwner=f.controller.inFlight;
   f.widget.dispose();replacement=new NativeWalletWidget(f.service);blocked=replacement.buttons[action].disabled;
   // Respect the actual rendered button state; no click through disabled UI.
   if(!blocked){replacement.buttons[action].click();reentered=f.operations[action];}
  };
  f.service.listeners.add(listener);
  try {
   f.widget.buttons[action].click();const original=f.operations[action];await original;if(reentered)await reentered;
   assert.equal(observedOwner,original);assert.equal(blocked,true);assert.equal(f.calls.includes('beginYNX'),false);assert.equal(f.calls.includes('restore'),false);assert.equal(f.calls.includes('disconnect'),false);
   assert.equal(f.controller.inFlight,undefined);assert.equal(f.controller.state.phase,'cancelled');assert.equal(f.controller.state.busy,false);assert.equal(replacement.buttons[action].disabled,false);
   replacement.buttons[action].click();await f.operations[action];
   assert.equal(f.calls.filter(x=>x===(action==='connect'?'beginYNX':action)).length,1);assert.equal(f.controller.inFlight,undefined);assert.equal(f.controller.state.busy,false);
   assert.equal(f.controller.state.phase,action==='connect'?'wallet-opened':'ready');assert.equal(f.controller.state.projectCapability,'not-supplied');
  }finally{f.service.listeners.delete(listener);replacement?.dispose();f.widget.dispose();await f.controller.dispose();}
 });
}
test('R39 normal Connect Cancel Guest buttons retain selected state and local guest branch',async()=>{
 const f=await fixture();try {
  f.widget.buttons.connect.click();await f.operations.connect;assert.equal(f.calls.filter(x=>x==='beginYNX').length,1);assert.equal(f.controller.state.awaitingCallback,true);assert.equal(f.controller.inFlight,undefined);assert.equal(f.widget.buttons.cancel.disabled,false);
  f.widget.buttons.cancel.click();await f.operations.cancel;assert.equal(f.controller.state.phase,'cancelled');assert.equal(f.controller.state.sessionCurrent,false);assert.equal(f.controller.state.awaitingCallback,false);
  assert.equal(f.widget.buttons.guest.disabled,false);f.widget.buttons.guest.click();await f.operations.guest;assert.equal(f.calls.filter(x=>x==='guest').length,1);assert.equal(f.controller.state.phase,'guest');assert.equal(f.controller.state.session.status,'guest');assert.equal(f.controller.state.projectCapability,'not-supplied');
 }finally{f.widget.dispose();await f.controller.dispose();}
});
test('R39 current UNKNOWN retains first error, frees slot and permits explicit Restore retry',async()=>{
 const f=await fixture(),original=Object.assign(Error('TEST_ONLY_original_UNKNOWN'),{code:'TEST_ONLY_OUTCOME_UNKNOWN'});let fail=true;
 f.controller.admission.assertCurrent=()=>{if(fail)throw original;return true;};
 try {f.widget.buttons.connect.click();await f.operations.connect;assert.equal(f.controller.state.failureCode,original.code);assert.equal(f.controller.state.message,original.message);assert.equal(f.controller.state.busy,false);assert.equal(f.controller.inFlight,undefined);
  fail=false;assert.equal(f.widget.buttons.restore.disabled,false);f.widget.buttons.restore.click();await f.operations.restore;assert.equal(f.calls.filter(x=>x==='restore').length,1);assert.equal(f.controller.state.phase,'ready');assert.equal(f.controller.inFlight,undefined);
 }finally{f.widget.dispose();await f.controller.dispose();}
});

// R40: only a completed original native cleanup may release the UI slot while
// the retired SDK promise drains. No private admission or SDK record is changed.
for(const outcome of ['success','error']){
 test('R40 confirmed Cancel permits retry while old '+outcome+' drains without changing new busy owner',async()=>{
  const f=await fixture(),oldGate=deferred(),entered=deferred(),freshGate=deferred(),freshEntered=deferred();let oldRun,newRun;
  f.runtime.connection.beginYNX=async()=>{entered.resolve();return oldGate.promise;};
  const fresh={connection:{...f.runtime.connection,beginYNX:async()=>{f.calls.push('TEST_ONLY_new_begin');freshEntered.resolve();return freshGate.promise;}},endNativeOperation:async()=>{f.calls.push('TEST_ONLY_new_end');}};
  try{
   f.widget.buttons.connect.click();oldRun=f.operations.connect;await entered.promise;
   f.widget.buttons.cancel.click();await f.operations.cancel;
   assert.equal(f.controller.inFlight,undefined);assert.equal(f.widget.buttons.connect.disabled,false);
   f.api.beginDeveloperWalletV2Connection=async()=>fresh;f.widget.buttons.connect.click();newRun=f.operations.connect;await freshEntered.promise;
   assert.equal(f.controller.state.busy,true);assert.equal(f.controller.inFlight,newRun);assert.equal(f.controller.runtime,fresh);
   if(outcome==='error')oldGate.reject(Object.assign(Error('TEST_ONLY_retired_UNKNOWN'),{code:'TEST_ONLY_OLD_UNKNOWN'}));else oldGate.resolve({status:'wallet-opened',sessionState:{status:'connecting'}});
   await oldRun;assert.equal(f.controller.inFlight,newRun);assert.equal(f.controller.runtime,fresh);assert.equal(f.controller.state.busy,true);assert.equal(f.controller.state.failureCode,undefined);assert.equal(f.calls.includes('TEST_ONLY_new_end'),false);
   freshGate.resolve({status:'wallet-opened',sessionState:{status:'connecting'}});await newRun;assert.equal(f.controller.inFlight,undefined);assert.equal(f.controller.state.awaitingCallback,true);assert.equal(f.controller.runtime,fresh);
  }finally{oldGate.resolve({status:'wallet-opened'});freshGate.resolve({status:'wallet-opened'});await oldRun;await newRun;f.widget.dispose();await f.controller.dispose();}
 });
}
test('R40 Cancel keeps exact request busy until native cleanup has actually resolved',async()=>{
 const f=await fixture(),sdk=deferred(),entered=deferred(),cleanup=deferred(),cleaning=deferred();let pending,cancelled;
 f.runtime.connection.beginYNX=async()=>{entered.resolve();return sdk.promise;};
 f.runtime.endNativeOperation=async()=>{cleaning.resolve();await cleanup.promise;};
 try{
  f.widget.buttons.connect.click();pending=f.operations.connect;await entered.promise;
  f.widget.buttons.cancel.click();cancelled=f.operations.cancel;await cleaning.promise;
  assert.equal(f.controller.inFlight,pending);assert.equal(f.widget.buttons.connect.disabled,true);assert.equal(f.controller.state.busy,true);
  cleanup.resolve();await cancelled;assert.equal(f.controller.inFlight,undefined);assert.equal(f.widget.buttons.connect.disabled,false);assert.equal(f.controller.state.phase,'cancelled');
 }finally{cleanup.resolve();sdk.resolve({status:'wallet-opened'});await cancelled;await pending;f.widget.dispose();await f.controller.dispose();}
});
test('R40 failed native cleanup cannot release admission slot for an overlapping retry',async()=>{
 const f=await fixture(),sdk=deferred(),entered=deferred();let pending;
 f.runtime.connection.beginYNX=async()=>{entered.resolve();return sdk.promise;};
 f.runtime.endNativeOperation=async()=>{throw Error('TEST_ONLY_native_cleanup_UNKNOWN');};
 try{f.widget.buttons.connect.click();pending=f.operations.connect;await entered.promise;f.widget.buttons.cancel.click();await f.operations.cancel;
  assert.equal(f.controller.inFlight,pending);assert.equal(f.widget.buttons.connect.disabled,true);assert.equal(f.controller.state.busy,true);
 }finally{sdk.resolve({status:'wallet-opened'});await pending;f.widget.dispose();await f.controller.dispose();}
});
test('R40 native acquisition without returned runtime remains owned until it is safely retired',async()=>{
 const f=await fixture(),native=deferred(),entered=deferred();let pending;
 f.api.beginDeveloperWalletV2Connection=async()=>{entered.resolve();return native.promise;};
 try{f.widget.buttons.connect.click();pending=f.operations.connect;await entered.promise;f.widget.buttons.cancel.click();await f.operations.cancel;
  assert.equal(f.controller.inFlight,pending);assert.equal(f.widget.buttons.connect.disabled,true);
  native.resolve(f.runtime);await pending;assert.equal(f.calls.includes('beginYNX'),false);assert.equal(f.calls.includes('end'),true);assert.equal(f.controller.inFlight,undefined);assert.equal(f.widget.buttons.connect.disabled,false);
 }finally{native.resolve(f.runtime);await pending;f.widget.dispose();await f.controller.dispose();}
});

test('R40 callback observed while confirmed Cancel drains remains explicit and visible',async()=>{
 const f=await callbackFixture(),sdk=deferred(),entered=deferred(),cleanup=deferred(),cleaning=deferred();let pending,cancelled;
 await f.controller.connect();const original=f.runtime.connection.handleReturn;
 f.runtime.connection.handleReturn=async url=>{entered.resolve();await sdk.promise;return original(url);};
 f.runtime.endNativeOperation=async()=>{cleaning.resolve();await cleanup.promise;};
 try{f.controller.receiveCallback(f.urls[0]);await entered.promise;pending=f.controller.inFlight;cancelled=f.controller.cancel();await cleaning.promise;
  f.controller.receiveCallback(f.urls[1]);cleanup.resolve();await cancelled;
  assert.equal(f.controller.inFlight,undefined);assert.equal(f.controller.returningCallback,undefined);assert.equal(f.controller.callback,f.urls[1]);assert.equal(f.controller.state.hasPendingReturn,true);assert.equal(f.controller.state.awaitingCallback,false);assert.equal(f.widget.buttons.returned.disabled,false);
  sdk.resolve();await pending;assert.equal(f.controller.callback,f.urls[1]);assert.equal(f.controller.state.hasPendingReturn,true);assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='return'&&x[1]===f.urls[1]).length,0);
 }finally{cleanup.resolve();sdk.resolve();await cancelled;await pending;f.widget.dispose();await f.controller.dispose();}
});

const flushReviewEnd=()=>new Promise(resolve=>setImmediate(resolve));
test('R41 ended local review lifetime leaves waiting UI without authorizing or erasing protected SDK state',async()=>{
 const f=await fixture(),finished=deferred(),saved={status:'connecting',request:{TEST_ONLY:'retained'}};
 f.runtime.finished=finished.promise;f.runtime.connection.current=saved;
 try{f.widget.buttons.connect.click();await f.operations.connect;assert.equal(f.controller.state.awaitingCallback,true);
  finished.resolve();await flushReviewEnd();
  assert.equal(f.controller.state.awaitingCallback,false);assert.equal(f.controller.state.sessionCurrent,false);assert.equal(f.controller.state.busy,false);assert.equal(f.controller.runtime,undefined);
  assert.equal(f.widget.buttons.connect.disabled,false);assert.equal(f.widget.buttons.restore.disabled,false);assert.equal(f.runtime.connection.current,saved);
  assert.equal(f.calls.filter(x=>x==='beginYNX').length,1);assert.equal(f.calls.includes('restore'),false);assert.equal(f.calls.includes('guest'),false);
 }finally{finished.resolve();f.widget.dispose();await f.controller.dispose();}
});
test('R41 already resolved local lifetime cannot leave a newly returned wallet-opened result stuck',async()=>{
 const f=await fixture();f.runtime.finished=Promise.resolve();
 try{f.widget.buttons.connect.click();await f.operations.connect;await flushReviewEnd();assert.equal(f.controller.state.awaitingCallback,false);assert.equal(f.widget.buttons.connect.disabled,false);assert.equal(f.controller.inFlight,undefined);}
 finally{f.widget.dispose();await f.controller.dispose();}
});
test('R41 old lifetime completion cannot overwrite a replacement request',async()=>{
 const f=await fixture(),oldFinished=deferred(),newFinished=deferred();f.runtime.finished=oldFinished.promise;
 const fresh={connection:{...f.runtime.connection},finished:newFinished.promise,endNativeOperation:async()=>{}};
 try{f.widget.buttons.connect.click();await f.operations.connect;f.widget.buttons.cancel.click();await f.operations.cancel;
  f.api.beginDeveloperWalletV2Connection=async()=>fresh;f.widget.buttons.connect.click();await f.operations.connect;const state=f.controller.state;
  oldFinished.resolve();await flushReviewEnd();assert.equal(f.controller.state,state);assert.equal(f.controller.runtime,fresh);assert.equal(f.controller.state.awaitingCallback,true);
 }finally{oldFinished.resolve();newFinished.resolve();f.widget.dispose();await f.controller.dispose();}
});
test('R41 ordinary completed Restore remains SDK result rather than local lifetime cancellation',async()=>{
 const f=await fixture(),finished=deferred();f.runtime.finished=finished.promise;
 try{f.widget.buttons.restore.click();await f.operations.restore;const state=f.controller.state;finished.resolve();await flushReviewEnd();
  assert.equal(f.controller.state,state);assert.equal(state.phase,'ready');assert.equal(state.sessionCurrent,true);assert.equal(state.awaitingCallback,false);assert.equal(f.calls.filter(x=>x==='restore').length,1);
 }finally{finished.resolve();f.widget.dispose();await f.controller.dispose();}
});
test('R41 return after local review ends remains explicit and reaches original public rejection route only on click',async()=>{
 const f=await callbackFixture(),finished=deferred();f.runtime.finished=finished.promise;
 try{f.widget.buttons.connect.click();await f.operations.connect;finished.resolve();await flushReviewEnd();f.controller.receiveCallback(f.urls[0]);
  assert.equal(f.controller.state.awaitingCallback,false);assert.equal(f.controller.state.hasPendingReturn,true);assert.equal(f.widget.buttons.returned.disabled,false);assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='return').length,0);
  const fresh={...f.runtime,connection:{...f.runtime.connection},finished:new Promise(()=>{}),endNativeOperation:async()=>{}};
  f.api.beginDeveloperWalletV2Connection=async()=>fresh;f.widget.buttons.returned.click();await f.operations.resumeCallback;
  assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='return'&&x[1]===f.urls[0]).length,1);assert.equal(f.controller.state.session.status,'disconnected');assert.equal(f.controller.state.awaitingCallback,false);assert.equal(f.controller.state.phase,'ready');
 }finally{finished.resolve();f.widget.dispose();await f.controller.dispose();}
});

test('R41 unknown rejected lifetime is not treated as permission to retire waiting UI',async()=>{
 const f=await fixture(),finished=deferred();f.runtime.finished=finished.promise;
 try{f.widget.buttons.connect.click();await f.operations.connect;const state=f.controller.state;
  finished.reject(Error('TEST_ONLY_local_lifetime_UNKNOWN'));await flushReviewEnd();assert.equal(f.controller.state,state);assert.equal(f.controller.state.awaitingCallback,true);assert.equal(f.controller.runtime,f.runtime);assert.equal(f.calls.includes('restore'),false);
 }finally{f.widget.dispose();await f.controller.dispose();}
});
