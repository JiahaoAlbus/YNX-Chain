import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildNativeWalletConsumer } from '../../ynx-workbench/scripts/build-native-wallet-consumer.mjs';
import { PRODUCT_SESSION_CLIENT_STATE as STATES } from '../../../vendor/wallet-auth/src/product-session-recovery.js';
const require = createRequire(import.meta.url); require('reflect-metadata');
const { NativeWalletController, publicSessionState, PAUSED_WALLET_ADMISSION } = require('../../ynx-workbench/lib/native-wallet-controller.js');
const actual = require('../../ynx-workbench/lib/native-wallet-sdk.generated.js');
const binding = { productId: 'developer', platform: 'macos', applicationId: 'com.ynxweb4.developer.testnetpreview' };
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function fixture() {
 const calls = []; let listener;
 const connection = { connectionBinding: binding, current: { status: STATES.DISCONNECTED },
  async beginYNX() { calls.push('beginYNX'); return { status: 'wallet-opened', sessionState: { status: STATES.CONNECTING } }; },
  async handleReturn(url) { calls.push(['handleReturn', url]); return { status: 'session-state', sessionState: { status: STATES.RETRY_REQUIRED } }; },
  async restore() { calls.push('restore'); return { status: 'session-state', sessionState: { status: STATES.DISCONNECTED } }; },
  async disconnect() { calls.push('disconnect'); return { status: 'session-state', sessionState: { status: STATES.DISCONNECTED } }; } };
 const runtime = { connection, source: actual.DEVELOPER_WALLET_V2_SOURCE, async endNativeOperation() { calls.push('end'); } };
 const api = { ...actual, async beginDeveloperWalletV2Connection() { calls.push('native-approval'); return runtime; }, subscribeDeveloperWalletCallbacks(callback) { listener = callback; return () => calls.push('unsubscribe'); } };
 const admission = { assertCurrent(request) { calls.push(['admit', request.operation]); } };
 const controller = new NativeWalletController(api, () => {}, admission);
 return { api, runtime, controller, calls, admission, callback: url => listener(url) };
}
test('actual retained SDK Guest is local without native device or business transport', async () => {
 const saved = globalThis.fetch; globalThis.fetch = () => { throw Error('network forbidden'); };
 try { const controller = new NativeWalletController({ ...actual, subscribeDeveloperWalletCallbacks: () => () => {} });
  await controller.guest(); assert.equal(controller.state.session.status, STATES.GUEST); assert.equal(controller.state.projectCapability, 'not-supplied'); await controller.dispose();
 } finally { globalThis.fetch = saved; }
});
test('missing production supplier: Connect, Restore and Disconnect stop before native factory/network', async () => {
 const f = fixture(), controller = new NativeWalletController(f.api);
 await controller.connect(); await controller.restore(); await controller.disconnect(); assert.equal(controller.state.phase, 'dependency-missing'); assert.equal(controller.state.serviceConfiguration, 'not-supplied'); assert.ok(!f.calls.includes('native-approval')); await controller.dispose();
});
test('repeat Connect deduplicates and the exact callback uses the original runtime then releases capability', async () => {
 const f = fixture(), gate = deferred(); f.api.beginDeveloperWalletV2Connection = async () => { f.calls.push('native-approval'); await gate.promise; return f.runtime; };
 const first = f.controller.connect(); await Promise.resolve(); await f.controller.connect(); gate.resolve(); await first;
 assert.equal(f.calls.filter(call => call === 'native-approval').length, 1); assert.equal(f.controller.state.awaitingCallback, true);
 const url = 'ynxdeveloper://wallet-auth/callback?response=controlled-test-boundary'; f.callback(url); await f.controller.inFlight;
 assert.deepEqual(f.calls.find(call => Array.isArray(call) && call[0] === 'handleReturn'), ['handleReturn', url]); assert.equal(f.controller.state.hasPendingReturn, false); assert.equal(f.controller.state.session.status, STATES.RETRY_REQUIRED); assert.ok(f.calls.includes('end')); await f.controller.dispose();
});
test('cancel during native approval fences the late runtime and never begins Wallet review', async () => {
 const f = fixture(), gate = deferred(); f.api.beginDeveloperWalletV2Connection = async () => { await gate.promise; return f.runtime; };
 const pending = f.controller.connect(); await Promise.resolve(); await f.controller.cancel(); gate.resolve(); await pending;
 assert.ok(!f.calls.includes('beginYNX')); assert.ok(f.calls.includes('end')); assert.equal(f.controller.state.phase, 'cancelled'); assert.equal(f.controller.state.busy, false); await f.controller.dispose();
});
test('unmount cleanup remains permitted after service admission revocation and does not revoke the session implicitly', async () => {
 const f = fixture(); await f.controller.connect(); f.admission.assertCurrent = () => { throw Error('revoked'); }; await f.controller.dispose(); assert.ok(f.calls.includes('end')); assert.ok(f.calls.includes('unsubscribe')); assert.ok(!f.calls.includes('disconnect'));
});
test('cold callback/navigation recovery requires explicit approval, never automatic restore', async () => {
 const f = fixture(); f.callback('ynxdeveloper://wallet-auth/callback?response=waiting'); assert.ok(!f.calls.includes('native-approval')); assert.equal(f.controller.state.hasPendingReturn, true);
 await f.controller.resumeCallback(); assert.ok(f.calls.includes('native-approval')); assert.ok(!f.calls.includes('restore')); await f.controller.restore(); assert.ok(f.calls.includes('restore')); await f.controller.dispose();
});
test('admission is rechecked after native confirmation; substituted product rejects before SDK work', async () => {
 const f = fixture(); let checks = 0; f.admission.assertCurrent = () => { if (++checks === 2) throw Error('revoked'); }; await f.controller.connect(); assert.ok(!f.calls.includes('beginYNX')); assert.ok(f.calls.includes('end')); assert.equal(f.controller.state.sessionCurrent, false);
 f.admission.assertCurrent = () => {}; f.runtime.connection.connectionBinding = { ...binding, productId: 'social' }; await f.controller.connect(); assert.ok(!f.calls.includes('beginYNX')); await f.controller.dispose();
});
test('public SDK state projection does not expose request, proof, native key or protected Session object', () => {
 const state = { status: STATES.CONNECTED, message: 'observed', request: { secret: true }, session: { account: 'public', deviceKey: 'hidden', sessionToken: 'hidden', expiresAt: 'time' } };
 assert.deepEqual(Object.keys(publicSessionState({ sessionState: state })).sort(), ['account', 'expiresAt', 'message', 'status']);
});
test('existing native callback EventTarget really reaches the consumer without auto-approval', async () => {
 const old = globalThis.window; globalThis.window = new EventTarget();
 try { const f = fixture(); f.api.subscribeDeveloperWalletCallbacks = actual.subscribeDeveloperWalletCallbacks; const controller = new NativeWalletController(f.api, () => {}, f.admission);
  globalThis.window.dispatchEvent(new CustomEvent('ynx-wallet-callback', { detail: 'ynxdeveloper://wallet-auth/callback?response=not-auto-approved' }));
  assert.equal(controller.state.hasPendingReturn, true); assert.ok(!f.calls.includes('native-approval')); await controller.dispose(); await f.controller.dispose();
 } finally { globalThis.window = old; }
});
test('actual CommandRegistry and menu contribution open/reuse the registered Widget identity', async () => {
 const source = await readFile(new URL('../../ynx-workbench/lib/native-wallet-view.js', import.meta.url), 'utf8'), module = { exports: {} };
 vm.runInNewContext(source, { module, require: name => name === '@theia/core/lib/browser/widgets' ? { BaseWidget: class {} } : name === '@theia/core/lib/browser/common-menus' ? { CommonMenus: { VIEW_VIEWS: ['menubar', 'view', '2_views'] } } : name === '@theia/core/lib/common/nls' ? { nls: { localize: (_key, text) => text } } : name.endsWith('native-wallet-controller') ? { NativeWalletController } : name.endsWith('native-wallet-localization') ? require('../../ynx-workbench/lib/native-wallet-localization') : actual });
 const { NativeWalletContribution, NATIVE_WALLET_ID } = module.exports, { CommandRegistry } = require('@theia/core/lib/common/command');
 const widget = { id: NATIVE_WALLET_ID }, calls = []; let attached = false;
 const contribution = new NativeWalletContribution({ getOrCreateWidget: async id => { assert.equal(id, widget.id); return widget; } }, { getTabBarFor: () => attached, addWidget: (_widget, options) => { attached = true; calls.push(options.area); }, activateWidget: id => calls.push(id) });
 const commands = new CommandRegistry(); contribution.registerCommands(commands); let menu;
 contribution.registerMenus({ registerMenuAction: (path, action) => { menu = { path, action }; } }); assert.equal(menu.action.commandId, 'ynx.workbench.wallet');
 await commands.executeCommand(menu.action.commandId); await commands.executeCommand(menu.action.commandId); assert.deepEqual(calls, ['left', widget.id, widget.id]);
});
test('source pin verifies the single original TS/vendor/crypto closure and full legal notices', async () => {
 const pin = await buildNativeWalletConsumer({ verify: true }); assert.deepEqual(pin.licenseInputs.map(item => item.path).sort(), ['node_modules/@noble/curves/LICENSE', 'node_modules/@noble/hashes/LICENSE', 'vendor/wallet-auth-c5/package.json', 'vendor/wallet-auth/package.json'].sort()); assert.ok(pin.licenseInputs.some(item => item.name === '@ynx-chain/wallet-auth' && item.license === 'UNLICENSED'));
 const notices = await readFile(new URL('../../ynx-workbench/NOTICE.native-wallet-consumer.txt', import.meta.url), 'utf8'); assert.match(notices, /@noble\/curves 2\.2\.0 MIT/); assert.match(notices, /@noble\/hashes 2\.2\.0 MIT/);
});

test('actual LocalizationProvider loads every Wallet view key for zh-cn and retains English fallback', async () => {
 const { LocalizationProvider } = require('@theia/core/lib/node/i18n/localization-provider');
 const { nls } = require('@theia/core/lib/common/nls');
 const source = await readFile(new URL('../../ynx-workbench/lib/native-wallet-localization.js', import.meta.url), 'utf8'), module = { exports: {} };
 vm.runInNewContext(source, { module, require, Object });
 const { EN, ZH, registerNativeWalletLocalizations } = module.exports;
 const previous = nls.localization, provider = new LocalizationProvider(), registration = registerNativeWalletLocalizations(provider);
 try {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(ZH).sort());
  nls.localization = await provider.loadLocalization('zh-cn');
  for (const key of Object.keys(EN)) assert.equal(nls.localize('ynx/nativeWallet/' + key, EN[key]), ZH[key]);
  nls.localization = undefined; assert.equal(nls.localize('ynx/nativeWallet/connect', EN.connect), 'Connect YNX Wallet');
 } finally { nls.localization = previous; registration.dispose(); }
});
test('explicit trusted supplier pause stays separate from missing service; cleanup still works', async () => {
 const f = fixture(), controller = new NativeWalletController(f.api, () => {}, PAUSED_WALLET_ADMISSION);
 await controller.connect(); assert.equal(controller.state.phase, 'paused'); assert.equal(controller.state.serviceConfiguration, 'paused');
 assert.ok(!f.calls.includes('native-approval')); await controller.dispose(); await f.controller.dispose();
});
test('old account is historical during restore; a new SDK observation replaces it without project authority', async () => {
 const f = fixture();
 f.runtime.connection.restore = async () => ({ sessionState: { status: STATES.CONNECTED, session: { account: 'first-account' } } });
 await f.controller.restore(); assert.equal(f.controller.state.session.account, 'first-account');
 const gate = deferred(); f.runtime.connection.restore = async () => { await gate.promise; return { sessionState: { status: STATES.CONNECTED, session: { account: 'second-account' } } }; };
 const restoring = f.controller.restore(); assert.equal(f.controller.state.sessionCurrent, false); gate.resolve(); await restoring;
 assert.equal(f.controller.state.session.account, 'second-account'); assert.equal(f.controller.state.projectCapability, 'not-supplied');
 f.runtime.connection.restore = async () => { const error = Error('revoked'); error.code = 'SESSION_REVOKED'; throw error; };
 await f.controller.restore(); assert.equal(f.controller.state.sessionCurrent, false); assert.equal(f.controller.state.failureCode, 'SESSION_REVOKED');
 assert.ok(f.calls.includes('end')); await f.controller.dispose();
});
test('a false/null admission assertion never triggers native or SDK actions', async () => {
 for (const result of [false, null, {}, 'true']) { const f = fixture(); f.admission.assertCurrent = () => result; await f.controller.connect(); assert.equal(f.controller.state.serviceConfiguration, 'unverified'); assert.ok(!f.calls.includes('native-approval')); await f.controller.dispose(); }
});
test('real retained SDK rejects caller endpoint/registry flags and unsupported native platform', async () => {
 const { parseProductSessionRegistry, productPlatformBinding } = await import('../../../vendor/wallet-auth/src/product-session-registry.js');
 const { createProductWalletConnection } = await import('../../../vendor/wallet-auth/src/product-wallet-connection.js');
 const registry = JSON.parse(await readFile(new URL('../../../vendor/wallet-auth/product-session-registry.json', import.meta.url), 'utf8'));
 assert.throws(() => parseProductSessionRegistry({ ...registry, enabled: true }), /fields|schema/i);
 const parsed = parseProductSessionRegistry(registry); assert.equal(productPlatformBinding(parsed, 'developer', 'macos').applicationId, binding.applicationId);
 assert.throws(() => productPlatformBinding(parsed, 'developer', 'linux'), /platform/i);
 const config = Object.fromEntries(['registry', 'productId', 'platform', 'walletInstalled', 'schemeRegistered', 'gatewayTimeoutMs', 'storage', 'device', 'scope', 'discoveryWaitMs', 'openWallet', 'openTimeoutMs'].map(key => [key, undefined]));
 assert.throws(() => createProductWalletConnection({ ...config, endpoint: 'https://example.invalid' }), /fields|schema/i);
});
test('actual Cocoa Wallet script plus original TS-generated inspection does not call native, storage, availability or fetch', async () => {
 const cocoa = await readFile(new URL('../../../desktop/macos/main.m', import.meta.url), 'utf8');
 const scripts = [...cocoa.matchAll(/NSString\s*\*\s*(\w+)\s*=\s*@"((?:\\.|[^"\\])*)";/g)];
 const native = scripts.find(match => match[2].includes("Object.defineProperty(window,'ynxDesktopWallet'")); assert.ok(native, 'Actual native root Wallet script must exist.');
 const script = JSON.parse('"' + native[2] + '"'), target = new EventTarget(), messages = [];
 target.webkit = { messageHandlers: { wallet: { postMessage: message => messages.push(message) } } };
 vm.runInNewContext(script, { window: target, location: { pathname: '/' }, crypto: globalThis.crypto, addEventListener: target.addEventListener.bind(target), setTimeout, clearTimeout });
 const previousWindow = globalThis.window, previousFetch = globalThis.fetch; let fetches = 0;
 globalThis.window = target; globalThis.fetch = () => { ++fetches; throw Error('Passive inspection must never fetch.'); };
 try {
  const result = await actual.inspectDeveloperWalletV2Runtime();
  assert.equal(result.available, true); assert.equal(result.bridgeContract, 'present'); assert.equal(result.deviceStatus, 'not-observed'); assert.equal(result.authoritative, false); assert.equal(result.options, undefined);
  const controller = new NativeWalletController(actual); await controller.inspect(); assert.equal(controller.state.available, true); assert.equal(controller.state.bridgeContract, 'present'); assert.equal(controller.state.sessionCurrent, false);
  await controller.connect(); assert.equal(controller.state.phase, 'dependency-missing'); await controller.dispose();
  assert.deepEqual(messages, []); assert.equal(fetches, 0);
 } finally { globalThis.window = previousWindow; globalThis.fetch = previousFetch; }
});
test('passive inspection distinguishes absent/invalid bridge from an unobserved device without invoking any capability', async () => {
 const saved = globalThis.window; let calls = 0; const never = () => { ++calls; throw Error('No native calls permitted.'); };
 try {
  globalThis.window = new EventTarget(); let result = await actual.inspectDeveloperWalletV2Runtime(); assert.equal(result.available, false); assert.equal(result.bridgeContract, 'missing');
  globalThis.window.ynxDesktopWallet = { openAuthorization: never, device: never, beginConnection: never, endConnection: never, walletAvailability: never, protectedStorage: { securityLevel: 'os-protected', get: never, set: never } };
  result = await actual.inspectDeveloperWalletV2Runtime(); assert.equal(result.available, false); assert.equal(result.bridgeContract, 'missing');
  globalThis.window.ynxDesktopWallet.protectedStorage.remove = never;
  result = await actual.inspectDeveloperWalletV2Runtime(); assert.equal(result.available, true); assert.equal(result.deviceStatus, 'not-observed'); assert.equal(calls, 0);
 } finally { globalThis.window = saved; }
});
test('real view rendering keeps bridge presence, unobserved device and explicit operation failure separate', async () => {
 const source = await readFile(new URL('../../ynx-workbench/lib/native-wallet-view.js', import.meta.url), 'utf8'), module = { exports: {} };
 vm.runInNewContext(source, { module, require: name => name === '@theia/core/lib/browser/widgets' ? { BaseWidget: class {} } : name === '@theia/core/lib/browser/common-menus' ? { CommonMenus: { VIEW_VIEWS: [] } } : name === '@theia/core/lib/common/nls' ? { nls: { localize: (_key, text) => text } } : name.endsWith('native-wallet-localization') ? require('../../ynx-workbench/lib/native-wallet-localization') : name.endsWith('native-wallet-controller') ? { NativeWalletController } : actual });
 const widget = { status: {}, session: {}, detail: {}, source: {}, buttons: Object.fromEntries(['connect', 'restore', 'disconnect', 'returned', 'cancel', 'guest'].map(key => [key, {}])) };
 const state = { phase: 'idle', available: true, bridgeContract: 'present', deviceStatus: 'not-observed', serviceConfiguration: 'not-supplied', session: { status: 'disconnected' } };
 module.exports.NativeWalletWidget.prototype.renderState.call(widget, state); assert.match(widget.detail.textContent, /have not been checked/); assert.doesNotMatch(widget.detail.textContent, /unavailable/);
 module.exports.NativeWalletWidget.prototype.renderState.call(widget, { ...state, phase: 'error', message: '/private/internal/keychain error' }); assert.match(widget.detail.textContent, /operation failed/); assert.doesNotMatch(widget.detail.textContent, /private|Keychain|interface is unavailable/);
 module.exports.NativeWalletWidget.prototype.renderState.call(widget, { ...state, available: false, bridgeContract: 'missing' }); assert.match(widget.detail.textContent, /interface is unavailable/);
});
