import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPublicStorageRuntime} from '../scripts/verify-public-storage-runtime.mjs';

const commit = '1'.repeat(40);
const storage = {backend: 'postgresql', multiInstance: true, restartPersistent: true, productionDatabaseRequired: false};
function transport(change = () => {}, calls = []) {
  return async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, {Accept: 'application/json'});
    assert.ok(options.signal);
    const path = new URL(url).pathname;
    const payload = {productId: 'ynx-quant-lab', commit, storage: {...storage}, status: path.endsWith('/ready') ? 'ready' : 'ok', ready: true, liveFundsEnabled: false, mode: 'simulated_testnet_only'};
    const object = {payload, status: 200, type: 'application/json'};
    change(object, path);
    return new Response(object.body ?? JSON.stringify(object.payload), {status: object.status, headers: {'content-type': object.type}});
  };
}
test('exact public source and PostgreSQL readiness has three hashed GET receipts, no business promotion', async () => {
  const calls = [];
  const result = await verifyPublicStorageRuntime(commit, transport(undefined, calls));
  assert.equal(result.passed, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(url => url.startsWith('https://quant.ynxweb4.com/api/')));
  assert.ok(result.receipts.every(r => r.bytes > 0 && /^[0-9a-f]{64}$/.test(r.sha256)));
  for (const flag of ['walletApprovalVerified', 'tenantIsolationVerified', 'ordersVerified', 'transactionsVerified']) assert.equal(result[flag], false);
});
for (const [name, change] of [
  ['old source', object => { object.payload.commit = '2'.repeat(40); }],
  ['filesystem storage', object => { object.payload.storage.backend = 'filesystem_json_snapshot'; object.payload.storage.multiInstance = false; }],
  ['database requirement not fulfilled', object => { object.payload.storage.productionDatabaseRequired = true; }],
  ['503 readiness', (object, path) => { if (path.endsWith('/ready')) object.status = 503; }],
  ['health false readiness', (object, path) => { if (path.endsWith('/health')) object.payload.ready = false; }],
  ['live funds boundary', object => { object.payload.liveFundsEnabled = true; }],
  ['HTML fallback', object => { object.type = 'text/html'; object.body = '<html>not an API</html>'; }],
  ['oversized body', object => { object.body = 'x'.repeat(65537); }],
  ['invalid UTF8', object => { object.body = new Uint8Array([255]); }],
]) test(name + ' fails closed', async () => {
  const result = await verifyPublicStorageRuntime(commit, transport(change));
  assert.equal(result.passed, false);
  assert.ok(result.failures.length);
});
test('redirect or changed response URL fails closed', async () => {
  const result = await verifyPublicStorageRuntime(commit, async () => ({redirected: true}));
  assert.equal(result.passed, false);
  assert.equal(result.receipts.length, 0);
});
test('input source must be a full immutable commit before any fetch', async () => {
  let calls = 0;
  await assert.rejects(verifyPublicStorageRuntime('HEAD', async () => { calls++; }), /full_source_commit/);
  assert.equal(calls, 0);
});
