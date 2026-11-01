import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
// Only TEST resolution. Production Source keeps the sole package export.
const sdk = new URL('../src/pq-wallet-policy.js',import.meta.url).href;
const {inspectOperatorProjection, assertSessionProjectionSupported, CANONICAL_NETWORK_ID} =
  await import('../native/policy-revocation-source-r35-20261018/source/policy-supplier/operator-projection.mjs');
const owner = '0x' + '1'.repeat(40);
const v1 = 'YNX-ACCOUNT-POLICY/v1', v2 = 'YNX-ACCOUNT-POLICY/v2';
const record = (revision, registeredAt, activeFrom, ledgerNonce) => ({algorithmVersion: 'YNX-BATCH/v0.1', owner,
  pkA: revision.repeat(5184), pkB: revision.repeat(128), revision, registeredAt, activeFrom, ledgerNonce});
const tombstone = () => ({owner, authorizingRevision: '1', throughRevision: '2', registeredAt: '25', revokedFrom: '26', ledgerNonce: '3'});
function rpc(next = '25') {
  const height = BigInt(next), committed = height - 1n;
  return {owner, executionHeight: next, ledgerNonce: '3', algorithmVersion: 'YNX-BATCH/v0.1', enabled: true,
    records: [record('1', '10', '20', '1'), record('2', '22', '30', '2')], policyVersion: v2,
    networkId: CANONICAL_NETWORK_ID, enableAt: '10', activeRevision: height >= 30n ? '2' : '1',
    policyView: 'next_execution', recordsView: 'includes_pending', source: 'authoritative_producer',
    committedHeight: committed.toString(), committedBlockHash: 'a'.repeat(64), committedAlgorithmVersion: 'YNX-BATCH/v0.1',
    committedActiveRevision: committed >= 30n ? '2' : '1', checkpointStatus: 'durable', checkpointIntegrity: 'b'.repeat(64), recordsComplete: true,
    revocations: [tombstone()], globalPolicyVersion: v2,
    authorizationStatus: height >= 26n ? 'revoked' : 'revocation_pending', pqSigningEnabled: height < 26n,
    committedAuthorizationStatus: committed >= 26n ? 'revoked' : committed >= 25n ? 'revocation_pending' : 'active',
    committedPQSigningEnabled: committed < 26n};
}
test('R35 actual SDK pending/terminal tombstone kept; next and committed have distinct heights', () => {
  for (const height of ['25', '26', '30', '31']) {
    const raw = rpc(height), result = inspectOperatorProjection(raw, owner);
    assert.equal(result.authorization.policyVersion, v2);
    assert.deepEqual(result.authorization.revocations, [tombstone()]);
    assert.equal(result.nextView.authorizationStatus, raw.authorizationStatus);
    assert.equal(result.nextView.pqSigningEnabled, raw.pqSigningEnabled);
    assert.equal(result.committedView.authorizationStatus, raw.committedAuthorizationStatus);
    assert.equal(result.committedRecord.revision, raw.committedActiveRevision);
    assert(Object.isFrozen(result.authorization.revocations[0]));
  }
});
test('R35 global v2 unaffected owner retains v1 only after actual empty tombstone and metadata equality', () => {
  const raw = rpc(); raw.policyVersion = v1; raw.revocations = [];
  raw.authorizationStatus = raw.committedAuthorizationStatus = 'active';
  const result = inspectOperatorProjection(raw, owner);
  assert.equal(result.authorization.policyVersion, v1);
  assert.equal(Object.hasOwn(result.authorization, 'revocations'), false);
  assert.doesNotThrow(() => assertSessionProjectionSupported(result));
  raw.revocations = [tombstone()];
  assert.throws(() => inspectOperatorProjection(raw, owner), {code: 'AUTH_POLICY_QUERY_REVOCATION_MISMATCH'});
});
test('R35 additive statuses may not claim active/signing when committed or next is revoked', () => {
  for (const key of ['authorizationStatus', 'pqSigningEnabled', 'committedAuthorizationStatus', 'committedPQSigningEnabled']) {
    const raw = rpc('30'); raw[key] = key.endsWith('Enabled') ? true : 'active';
    assert.throws(() => inspectOperatorProjection(raw, owner), {code: 'AUTH_POLICY_QUERY_REVOCATION_STATUS_MISMATCH'});
  }
});
test('R35 owner/global versions, complete metadata, exact keys and final tombstone cannot be silently downgraded', () => {
  for (const change of [r => r.globalPolicyVersion = v1, r => r.revocations = [],
    r => r.revocations.push(tombstone()), r => r.revocations[0].owner = '0x' + '2'.repeat(40),
    r => delete r.authorizationStatus, r => r.extra = true,
    r => r.executionHeight = '025', r => r.committedHeight = '23',
    r => r.committedActiveRevision = '2', r => r.recordsComplete = false,
    r => r.revocations[0].registeredAt = '26', r => r.revocations[0].ledgerNonce = '2']) {
    const raw = rpc(); change(raw); assert.throws(() => inspectOperatorProjection(raw, owner));
  }
});
test('R35 existing Session v1 explicitly refuses pending AND effective terminal revocations', () => {
  for (const height of ['25', '26', '30']) {
    const view = inspectOperatorProjection(rpc(height), owner);
    assert.throws(() => assertSessionProjectionSupported(view), {code: 'AUTH_POLICY_SESSION_REVOCATION_UNSUPPORTED'});
  }
});
test('R35 old v1 response is unchanged; nil-policy new metadata is not a fabricated network activation', () => {
  const raw = rpc(); raw.policyVersion = v1;
  for (const key of ['revocations', 'authorizationStatus', 'pqSigningEnabled', 'committedAuthorizationStatus', 'committedPQSigningEnabled', 'globalPolicyVersion']) delete raw[key];
  assert.equal(inspectOperatorProjection(raw, owner).authorization.policyVersion, v1);
  const nil = {owner, enabled: false, records: [], algorithmVersion: 'legacy', ledgerNonce: '0', executionHeight: '2',
    policyView: 'next_execution', recordsView: 'includes_pending', source: 'authoritative_producer', committedHeight: '1',
    committedBlockHash: 'a'.repeat(64), committedAlgorithmVersion: 'legacy', checkpointStatus: 'durable',
    checkpointIntegrity: 'b'.repeat(64), recordsComplete: true, revocations: [], globalPolicyVersion: '',
    authorizationStatus: 'legacy', pqSigningEnabled: false, committedAuthorizationStatus: 'legacy', committedPQSigningEnabled: false};
  assert.equal(inspectOperatorProjection(nil, owner).authorization.enabled, false);
  nil.globalPolicyVersion = v2;
  assert.throws(() => inspectOperatorProjection(nil, owner), {code: 'AUTH_POLICY_QUERY_REVOCATION_MISMATCH'});
});
test('R35 accessors, hidden metadata and number-coerced decimal reject before use', () => {
  const accessor = rpc(); Object.defineProperty(accessor, 'pqSigningEnabled', {get() { throw Error('getter executed'); }, enumerable: true});
  assert.throws(() => inspectOperatorProjection(accessor, owner), {code: 'AUTH_POLICY_QUERY_SCHEMA'});
  const hidden = rpc(); Object.defineProperty(hidden, 'untrusted', {value: true});
  assert.throws(() => inspectOperatorProjection(hidden, owner), {code: 'AUTH_POLICY_QUERY_SCHEMA'});
  const number = rpc(); number.committedHeight = 24;
  assert.throws(() => inspectOperatorProjection(number, owner), {code: 'AUTH_POLICY_QUERY_U64'});
});
