import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {registerHooks, syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';

const sdk = new URL('../src/pq-wallet-policy.js',import.meta.url).href;
const owner = '0x' + '1'.repeat(40), network = '16366ff25bcc73c6bb95d12733be74d1ac885d3daf518ddd0e4bd4438cff243f';
const originalRequest = https.request;
let nextHeight = 25, calls = [];
function response() {
  return {owner, executionHeight: String(nextHeight), ledgerNonce: '3', algorithmVersion: 'YNX-BATCH/v0.1', enabled: true,
    policyVersion: 'YNX-ACCOUNT-POLICY/v2', networkId: network, enableAt: '10', activeRevision: '1',
    records: [{algorithmVersion: 'YNX-BATCH/v0.1', owner, pkA: '11'.repeat(2592), pkB: '22'.repeat(64), revision: '1', registeredAt: '10', activeFrom: '20', ledgerNonce: '1'}],
    revocations: [{owner, authorizingRevision: '1', throughRevision: '1', registeredAt: '25', revokedFrom: '26', ledgerNonce: '3'}],
    policyView: 'next_execution', recordsView: 'includes_pending', source: 'authoritative_producer', recordsComplete: true,
    committedHeight: String(nextHeight - 1), committedBlockHash: String(nextHeight).padStart(64, '0'), committedAlgorithmVersion: 'YNX-BATCH/v0.1', committedActiveRevision: '1',
    checkpointStatus: 'durable', checkpointIntegrity: 'a'.repeat(64), globalPolicyVersion: 'YNX-ACCOUNT-POLICY/v2',
    authorizationStatus: nextHeight >= 26 ? 'revoked' : 'revocation_pending', pqSigningEnabled: nextHeight < 26,
    committedAuthorizationStatus: nextHeight === 25 ? 'active' : 'revocation_pending', committedPQSigningEnabled: true};
}
// PUBLIC HTTP instrumentation, not a real TLS certificate/operator checkpoint.
// Actual normal Source and transaction-resource code run unchanged. No network.
https.request = (url, options, callback) => {
  assert.equal(url.origin, 'https://rpc.ynxweb4.com');
  assert.equal(options.method, 'GET'); assert.equal(options.rejectUnauthorized, true); assert.equal(options.agent, false);
  calls.push(url.pathname);
  const req = new EventEmitter(); req.destroy = () => {};
  req.end = () => queueMicrotask(() => {
    const res = new EventEmitter(); res.destroy = () => {};
    res.statusCode = 200; res.headers = {'content-type': 'application/json', 'cache-control': 'no-store'};
    const body = url.pathname === '/status' ? {chainId: 6423, catchingUp: false, persistence: true, persistenceError: '',
      build: {commit: '65efa82e0615', release: 'ynx-network-surgical-65efa82e0615'}} :
      url.pathname === '/blocks/0' ? {height: 0, hash: network} : response();
    callback(res); res.emit('data', Buffer.from(JSON.stringify(body))); res.emit('end');
  });
  return req;
};
syncBuiltinESMExports();
const resource = await import('../native/policy-revocation-source-r35-20261018/source/policy-supplier/transaction-resource.mjs');
const policy = await import(sdk);
const {openNormalOperatorSource} = await import('../native/policy-revocation-source-r35-20261018/source/policy-supplier/operator-query.mjs');

test('R35 real normal factory -> Source RPC projection -> JSON -> real SDK reparse retains terminal identity', async () => {
  calls = []; nextHeight = 25;
  const request = {networkId: network, nativeChainId: '6423', owner, operation: 'transfer', at: new Date(Date.now() - 20).toISOString()};
  const r = await resource.acquireOriginalWalletTransactionPolicy(request);
  try {
    assert(resource.isOriginalWalletTransactionPolicy(r));
    const before = r.readOriginal();
    assert.equal(before.authorization.policyVersion, 'YNX-ACCOUNT-POLICY/v2');
    assert.equal(before.authorization.revocations.length, 1);
    assert.deepEqual(calls, ['/status', '/blocks/0', '/accounts/' + owner + '/authorization', '/status']);
    assert.equal(policy.inspectPQWalletActionPolicy(before.authorization, 'pq-native-transfer').mode, 'pq');
    assert.throws(() => policy.inspectPQWalletActionPolicy(before.authorization, 'pq-account-migration'), {code: 'PQ_TERMINAL_REVOCATION_PENDING'});
    nextHeight = 26;
    await assert.rejects(r.recheck(), {code: 'PQ_POLICY_CHANGED_REVIEW_REQUIRED'});
    const outcome = r.outcome();
    assert.equal(outcome.unknown, true);
    assert.equal(outcome.firstCause.code, 'PQ_POLICY_CHANGED_REVIEW_REQUIRED');
    assert.equal(outcome.original, before);
    const afterWire = JSON.parse(outcome.lastRecheckRaw);
    const after = policy.parsePQAccountAuthorization(afterWire.authorization, {chainId: network, nativeChainId: '6423', owner});
    assert.equal(after.policyVersion, 'YNX-ACCOUNT-POLICY/v2');
    assert.deepEqual(after.revocations, before.authorization.revocations);
    for (const action of ['pq-native-transfer', 'pq-account-migration', 'legacy-native-transfer', 'ethereum', 'dex', 'resource', 'delegation', 'recovery-authorization']) {
      assert.throws(() => policy.inspectPQWalletActionPolicy(after, action), {code: 'PQ_ACCOUNT_REVOKED'});
    }
    assert.equal(calls.length, 8);
  } finally { await r.close(); }
});
test('R35 actual session Source refuses tombstone rather than emitting fabricated Session-v1 legacy/PQ', async () => {
  nextHeight = 26; calls = [];
  const source = openNormalOperatorSource('session');
  try { await assert.rejects(source.readOriginal({networkId: network, owner}), {code: 'AUTH_POLICY_SESSION_REVOCATION_UNSUPPORTED'}); }
  finally { source.retire(); await source.join(); await source.close(); }
  assert.equal(calls.length, 4);
});
test.after(() => { https.request = originalRequest; syncBuiltinESMExports(); });
