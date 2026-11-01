import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('./native-bridge.js', import.meta.url), 'utf8');
const VERSION = 'YNX-NETWORK-NATIVE-BRIDGE/v1', IPC = 'YNX-NETWORK-LOCAL-IPC/v1';
function fixture({ native = true, origin = 'http://127.0.0.1:15432', subframe = false, throwing = false } = {}) {
  const listeners = new Map(), messages = [], timers = new Map(), states = [];
  let next = 1;
  const window = { location: { origin }, crypto: webcrypto,
    addEventListener: (name, fn) => listeners.set(name, fn),
    dispatchEvent: event => { if (event.type === 'network:native-state') states.push(event.detail); listeners.get(event.type)?.(event); } };
  window.top = subframe ? {} : window;
  if (native) window.webkit = { messageHandlers: { networkNative: { postMessage: value => {
    messages.push(value); if (throwing && value.type === 'request') throw Error('delivered then lost acknowledgement');
  } } } };
  runInNewContext(source, { window, Uint8Array, TextEncoder, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) });
  const emit = (name, detail) => listeners.get(name)?.({ detail });
  const ready = (helperGeneration = '1', documentGeneration = '1', session = 'controlled-session-1') =>
    emit('network:native-session', { version: VERSION, origin, session, helperGeneration, documentGeneration, ready: true, code: 'NATIVE_READY' });
  function result(request, payload = { code: 'NOT_SUPPLIED', authority: false }, extra = {}) {
    const response = { version: IPC, id: request.id, code: 'OK', peer: { uid: 501, gid: 20, credentialSource: 'PUBLIC_CONTROLLED_FIXTURE', nativeIPCVerified: true, browserIdentityVerified: false },
      result: request.operation === 'status' ? { status: { service: 'YNX Network', nodeControl: 'unavailable', resourceContribution: 'disabled' } } : { payload } };
    emit('network:native-result', { version: VERSION, id: request.id, session: request.session, helperGeneration: request.helperGeneration,
      documentGeneration: request.documentGeneration, ok: true, response, ...extra });
  }
  return { api: window.NetworkNative, window, messages, timers, states, emit, ready, result,
    take: () => messages.filter(v => v.type === 'request').at(-1),
    fire: () => { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } } };
}
const rejected = (promise, code, outcome) => assert.rejects(promise, e => e.code === code && e.outcome === outcome);

test('ordinary browser, subframe and broadened loopback have no Native authority', async () => {
  for (const options of [{ native: false }, { origin: 'http://localhost:15432' }, { origin: 'https://127.0.0.1:15432' }, { origin: 'http://127.0.0.1:65536' }, { subframe: true }]) {
    const f = fixture(options); assert.equal(f.api.available, false); assert.equal(f.api.ready, false);
    await rejected(f.api.request('node_start', {}), 'NATIVE_REQUIRED', 'NOT_SENT');
    assert.equal(f.messages.length, 0);
  }
});

test('fixed handshake and bounded full original response preserve unsupported business DATA', async () => {
  const f = fixture(); assert.equal(f.api.available, true); assert.equal(f.api.ready, false);
  await rejected(f.api.request('status'), 'NATIVE_NOT_READY', 'NOT_SENT');
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0].type, 'hello');
  f.ready(); assert.equal(f.api.ready, true); assert.equal(f.states.at(-1).authority, false);
  const p = f.api.request('resource_status'); const request = f.take();
  assert.equal(request.version, VERSION); assert.match(request.id, /^n_[0-9a-f]{32}$/);
  assert.deepEqual(Object.keys(request).sort(), ['version', 'type', 'id', 'session', 'helperGeneration', 'documentGeneration', 'operation', 'payload'].sort());
  f.result(request, { code: 'NOT_SUPPLIED', productionEnabled: false, authority: false });
  const original = await p; assert.equal(original.result.payload.code, 'NOT_SUPPLIED');
  assert.equal(original.peer.browserIdentityVerified, false); assert.equal(f.timers.size, 0);
  assert.equal(f.messages.filter(v => v.type === 'request').length, 1);
});

test('status uses own typed empty payload at JS boundary and original status shape', async () => {
  const f = fixture(); f.ready(); const p = f.api.request('status', {}); const req = f.take();
  f.result(req); const response = await p;
  assert.equal(response.result.status.service, 'YNX Network'); assert.equal('payload' in response.result, false);
  await rejected(f.api.request('status', { uid: '501' }), 'NATIVE_INVALID_REQUEST', 'NOT_SENT');
});

test('exact operation enumeration and typed keys forbid command, identity and authority selection', async () => {
  const f = fixture(); f.ready();
  for (const operation of ['node_shell', 'resource_execute', 'participation_sign', 'request_permission', 'node_start_extra', '__proto__'])
    await rejected(f.api.request(operation, {}), 'NATIVE_OPERATION_DENIED', 'NOT_SENT');
  for (const payload of [{ path: '/bin/sh' }, { binary: '/bin/sh' }, { argv: [] }, { uid: '501' }, { allow: 'true' }, { RawE5: 'fixture' }])
    await rejected(f.api.request('resource_status', payload), 'NATIVE_INVALID_REQUEST', 'NOT_SENT');
  await rejected(f.api.request('participation_prepare', { requestId: 'bounded', owner: '0x' + '4'.repeat(40), action: 'withdraw', unbondingId: '3'.repeat(24), feeCapYnxt: '1', expiresAt: 'x'.repeat(13000) }), 'NATIVE_INVALID_REQUEST', 'NOT_SENT');
  await rejected(f.api.request('participation_submit', { id: '../other' }), 'NATIVE_INVALID_REQUEST', 'NOT_SENT');
  assert.equal(f.messages.filter(v => v.type === 'request').length, 0);
});

test('one inflight call, lost transport acknowledgement and timeout never replay', async () => {
  const f = fixture(); f.ready(); const p = f.api.request('resource_stop', {}); const first = f.take();
  await rejected(f.api.request('resource_status'), 'NATIVE_BUSY', 'NOT_SENT');
  assert.equal([...f.timers.values()][0].ms, 18000);
  f.fire(); await rejected(p, 'NATIVE_TIMEOUT', 'UNKNOWN');
  f.result(first); assert.equal(f.messages.filter(v => v.type === 'request').length, 1);
  const lost = fixture({ throwing: true }); lost.ready();
  await rejected(lost.api.request('participation_submit', { id: 'original-id' }), 'NATIVE_TRANSPORT_FAILED', 'UNKNOWN');
  assert.equal(lost.messages.filter(v => v.type === 'request').length, 1); assert.equal(lost.timers.size, 0);
});

test('helper/document replacement rejects old UI outcome and never accepts rollback or late callback', async () => {
  const f = fixture(); f.ready(); const p = f.api.request('participation_reconcile', { id: 'original-unknown' }); const old = f.take();
  f.ready('2', '3', 'controlled-session-2'); await rejected(p, 'NATIVE_DOCUMENT_CHANGED', 'UNKNOWN');
  const fresh = f.api.request('resource_status'); const req = f.take();
  f.ready('1', '1', 'controlled-session-1'); f.result(old); assert.equal(f.timers.size, 1);
  f.result(req, { code: 'OK', productionEnabled: false }); assert.equal((await fresh).result.payload.productionEnabled, false);
  const pending = f.api.request('participation_reconcile', { id: 'same-original' });
  f.emit('pagehide'); await rejected(pending, 'NATIVE_DOCUMENT_CHANGED', 'UNKNOWN');
  f.ready('2', '3', 'controlled-session-2'); assert.equal(f.api.ready, false);
});

test('wrong or malformed response is UNKNOWN, business UNKNOWN resolves unchanged', async () => {
  const f = fixture(); f.ready(); let p = f.api.request('resource_stop'); const req = f.take();
  f.result(req, {}, { response: { version: IPC, id: 'wrong' } });
  await rejected(p, 'NATIVE_RESPONSE_INVALID', 'UNKNOWN');
  p = f.api.request('participation_submit', { id: 'original-operation' }); f.result(f.take(), { code: 'UNKNOWN', entry: { state: 'UNKNOWN', id: 'original-operation' } });
  assert.equal((await p).result.payload.code, 'UNKNOWN');
  p = f.api.request('resource_review'); f.result(f.take(), { code: 'UNSIGNED_PREVIEW_ONLY', authority: false, previewBytes: '92' });
  assert.equal((await p).result.payload.authority, false);
});

test('node decisions and restart keep original budgets and accept no allow boolean', async () => {
  const f = fixture(); f.ready(); const intent = { managerId: 'manager-original', nodeId: 'observer-original', action: 'start', artifactSHA256: 'a'.repeat(64), generation: '7' };
  let p = f.api.request('node_start', intent); assert.equal([...f.timers.values()][0].ms, 76000);
  f.result(f.take(), { code: 'CONSENT_UNAVAILABLE', productionGrant: false }); assert.equal((await p).result.payload.productionGrant, false);
  await rejected(f.api.request('node_start', { ...intent, allow: 'true' }), 'NATIVE_INVALID_REQUEST', 'NOT_SENT');
  p = f.api.request('node_restart', {}); assert.equal([...f.timers.values()][0].ms, 146000);
  f.result(f.take(), { code: 'NOT_RUNNING', productionGrant: false }); assert.equal((await p).result.payload.code, 'NOT_RUNNING');
});

test('original participation cursor is opaque DATA and list limit is bounded integer only', async () => {
  const f = fixture(); f.ready();
  for (const bad of [null, '20', 0, 51, 1.5, true])
    await rejected(f.api.request('participation_list', { limit: bad }), 'NATIVE_INVALID_REQUEST', 'NOT_SENT');
  await rejected(f.api.request('participation_list', { cursor: 'x'.repeat(513) }), 'NATIVE_INVALID_REQUEST', 'NOT_SENT');
  await rejected(f.api.request('participation_list', { path: '/journal' }), 'NATIVE_INVALID_REQUEST', 'NOT_SENT');
  const p = f.api.request('participation_list', { cursor: 'opaque-original-cursor', limit: 50 });
  assert.equal(f.take().payload.cursor, 'opaque-original-cursor');
  f.result(f.take(), { code: 'OK', entries: [], authority: false, walletApproval: false, capabilities: { list: true, submit: false } });
  assert.equal((await p).result.payload.capabilities.submit, false);
});

test('resolve follows only original request alias and preserves first immutable intent without an effect request', async () => {
  const f = fixture(); f.ready(); const alias = 'p09.alias:' + 'A'.repeat(118);
  assert.equal(alias.length, 128);
  const p = f.api.request('participation_resolve', { requestId: alias }); const req = f.take();
  assert.equal(req.operation, 'participation_resolve'); assert.deepEqual(Object.keys(req.payload), ['requestId']);
  assert.equal(req.payload.requestId, alias);
  const original = { id: 'original-entry', intent: { request: { requestId: 'first-original-request' } }, state: 'UNKNOWN' };
  f.result(req, { code: 'OK', entry: original, resolvedRequestId: alias, walletApproval: false, authority: false });
  const got = (await p).result.payload;
  assert.equal(got.entry.id, original.id); assert.equal(got.entry.intent.request.requestId, 'first-original-request');
  assert.equal(got.resolvedRequestId, alias); assert.equal(got.authority, false);
  assert.equal(f.messages.filter(v => v.type === 'request').length, 1);
  const missing = f.api.request('participation_resolve', { requestId: 'missing.original:alias' });
  f.result(f.take(), { code: 'NOT_FOUND', resolvedRequestId: 'missing.original:alias', walletApproval: false, authority: false });
  assert.equal((await missing).result.payload.code, 'NOT_FOUND');
  assert.deepEqual(f.messages.filter(v => v.type === 'request').map(v => v.operation), ['participation_resolve', 'participation_resolve']);
});

test('resolve has exact reference grammar and no ID, signer, path, approval, prefix or retry fallback', async () => {
  const f = fixture(); f.ready();
  for (const payload of [{}, { id: 'original-entry' }, { requestId: '' }, { requestId: 'x'.repeat(129) },
    { requestId: 'parent/path' }, { requestId: '空' }, { requestId: 1 },
    { requestId: 'real', path: '/store' }, { requestId: 'real', allow: 'true' },
    { requestId: 'real', operationId: 'Main-UUID' }])
    await rejected(f.api.request('participation_resolve', payload), 'NATIVE_INVALID_REQUEST', 'NOT_SENT');
  await rejected(f.api.request('participation_resolve_extra', { requestId: 'real' }), 'NATIVE_OPERATION_DENIED', 'NOT_SENT');
  assert.equal(f.messages.filter(v => v.type === 'request').length, 0);
  const p = f.api.request('participation_resolve', { requestId: 'actual.alias:1' }); const req = f.take();
  f.result(req, {}, { response: { version: IPC, id: 'different-packet-id' } });
  await rejected(p, 'NATIVE_RESPONSE_INVALID', 'UNKNOWN');
  assert.equal(f.messages.filter(v => v.type === 'request').length, 1);
});

test('resolve retains normal Native gates and old-generation timeout never prepares or submits', async () => {
  const browser = fixture({ native: false });
  await rejected(browser.api.request('participation_resolve', { requestId: 'original' }), 'NATIVE_REQUIRED', 'NOT_SENT');
  const f = fixture(); f.ready(); const p = f.api.request('participation_resolve', { requestId: 'lost.prepare.alias' });
  const req = f.take(); f.ready('2', '2', 'new-document-session');
  await rejected(p, 'NATIVE_DOCUMENT_CHANGED', 'UNKNOWN'); f.result(req);
  const timeout = f.api.request('participation_resolve', { requestId: 'same.alias' }); f.fire();
  await rejected(timeout, 'NATIVE_TIMEOUT', 'UNKNOWN');
  assert.equal(f.messages.filter(v => v.type === 'request' && !['participation_resolve'].includes(v.operation)).length, 0);
});
