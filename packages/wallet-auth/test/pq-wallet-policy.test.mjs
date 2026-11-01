import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parsePQAccountAuthorization, inspectPQWalletActionPolicy, assertPQAuthorizationCurrent,
  planPQNativeTransfer, planPQAccountMigration, pqRegisteredPublicBinding, classifyPQRegistration} from '../src/pq-wallet-policy.js';
import {pqPublicBindingToRegistrationKeys} from '../src/pq-wallet-authorization.js';
const vector = JSON.parse(await readFile(new URL('../testdata/pq-wallet-wire-r1.json', import.meta.url)));
// Public synthetic policy DTOs only. No real node, enrolled account or approval.
const network = {chainId: vector.transfer.fields.chainId, nativeChainId: '6423', owner: vector.transfer.fields.from};
const row = () => ({algorithmVersion: 'YNX-BATCH/v0.1', owner: network.owner, pkA: vector.registration.fields.pkA, pkB: vector.registration.fields.pkB,
  revision: '1', registeredAt: '10', activeFrom: '20', ledgerNonce: '1'});
const raw = () => ({owner: network.owner, executionHeight: '20', ledgerNonce: '11', algorithmVersion: 'YNX-BATCH/v0.1', enabled: true,
  records: [row()], policyVersion: 'YNX-ACCOUNT-POLICY/v1', networkId: network.chainId, enableAt: '10', activeRevision: '1'});
test('active account dispatches only typed PQ actions; all legacy and unsupported entrances refuse', () => {
  const snapshot = parsePQAccountAuthorization(raw(), network);
  assert.equal(inspectPQWalletActionPolicy(snapshot, 'pq-native-transfer').mode, 'pq');
  for (const action of ['legacy-native-transfer', 'ethereum', 'dex', 'resource', 'delegation', 'recovery-authorization']) {
    assert.throws(() => inspectPQWalletActionPolicy(snapshot, action), {code: 'PQ_ACTIVE_ACCOUNT_LEGACY_ENTRY_REFUSED'});
  }
  assert.throws(() => inspectPQWalletActionPolicy(snapshot, 'other'), {code: 'PQ_ACTION_UNSUPPORTED'});
  assert.throws(() => inspectPQWalletActionPolicy({...snapshot}, 'pq-native-transfer'), {code: 'PQ_POLICY_SNAPSHOT_REQUIRED'});
});
test('configuration installed is distinct from enableAt and a pending migration cannot be overwritten', () => {
  const future = {...raw(), records: [], algorithmVersion: 'legacy', enableAt: '30'}; delete future.activeRevision;
  const disabled = parsePQAccountAuthorization(future, network);
  assert.equal(inspectPQWalletActionPolicy(disabled, 'ethereum').mode, 'legacy');
  assert.throws(() => inspectPQWalletActionPolicy(disabled, 'pq-account-migration'), {code: 'PQ_ADMISSION_DISABLED'});
  const pending = {...raw(), records: [{...row(), activeFrom: '30'}], algorithmVersion: 'legacy'}; delete pending.activeRevision;
  const snapshot = parsePQAccountAuthorization(pending, network);
  assert.throws(() => planPQAccountMigration(snapshot, {...vector.registration.fields, priorRevision: '1', newRevision: '2', ledgerNonce: '12', activateAt: '40'}), {code: 'PQ_PENDING_MIGRATION_REFUSED'});
});
test('activeRevision and algorithm must match the highest revision active at execution height', () => {
  const legacyLie = {...raw(), algorithmVersion: 'legacy'}; delete legacyLie.activeRevision;
  assert.throws(() => parsePQAccountAuthorization(legacyLie, network), {code: 'PQ_POLICY_ACTIVE_MISMATCH'});
  assert.throws(() => parsePQAccountAuthorization({...raw(), activeRevision: '2'}, network), {code: 'PQ_POLICY_ACTIVE_MISMATCH'});
  assert.throws(() => parsePQAccountAuthorization({...raw(), records: []}, network), {code: 'PQ_POLICY_ACTIVE_MISMATCH'});
  assert.throws(() => parsePQAccountAuthorization({...raw(), networkId: '72'.repeat(32)}, network), {code: 'PQ_POLICY_NETWORK_INVALID'});
});
test('revision fence permits ordinary monotonic height advancement but refuses activation/nonce changes', () => {
  const old = parsePQAccountAuthorization(raw(), network);
  assert.equal(assertPQAuthorizationCurrent(old, parsePQAccountAuthorization({...raw(), executionHeight: '21'}, network)), undefined);
  assert.throws(() => assertPQAuthorizationCurrent(old, parsePQAccountAuthorization({...raw(), ledgerNonce: '12'}, network)), {code: 'PQ_POLICY_CHANGED_REVIEW_REQUIRED'});
  const before = {...raw(), executionHeight: '19', algorithmVersion: 'legacy'}; delete before.activeRevision;
  assert.throws(() => assertPQAuthorizationCurrent(parsePQAccountAuthorization(before, network), old), {code: 'PQ_POLICY_CHANGED_REVIEW_REQUIRED'});
});
test('snapshot and public-key encoding are immutable; unknown fields and getters fail without invocation', () => {
  const input = raw(), parsed = parsePQAccountAuthorization(input, network); input.records[0].pkB = '00'.repeat(64);
  assert.equal(parsed.records[0].pkB, vector.registration.fields.pkB);
  const roundTrip = pqPublicBindingToRegistrationKeys(pqRegisteredPublicBinding(parsed));
  assert.equal(roundTrip.pkA, vector.registration.fields.pkA); assert.equal(roundTrip.pkB, vector.registration.fields.pkB);
  assert(Object.isFrozen(parsed.records)); assert(Object.isFrozen(parsed.records[0]));
  let invoked = false;
  assert.throws(() => parsePQAccountAuthorization({...raw(), get enabled() { invoked = true; return true; }}, network), {code: 'PQ_POLICY_SNAPSHOT_INVALID'});
  assert.equal(invoked, false);
  assert.throws(() => parsePQAccountAuthorization({...raw(), guessedAuthority: true}, network), {code: 'PQ_SCHEMA_INVALID'});
});
test('exact nonce/fee, exhausted U64 and fresh-pair migration rules are enforced before signing', () => {
  const s = parsePQAccountAuthorization(raw(), network);
  assert.equal(planPQNativeTransfer(s, {...vector.transfer.fields, nonce: '12'}).policy.nextNonce, '12');
  assert.throws(() => planPQNativeTransfer(s, {...vector.transfer.fields, nonce: '13'}), {code: 'PQ_TRANSFER_REVIEW_MISMATCH'});
  assert.throws(() => planPQNativeTransfer(s, {...vector.transfer.fields, nonce: '12', fee: '0'}), {code: 'PQ_TRANSFER_REVIEW_MISMATCH'});
  const exhausted = parsePQAccountAuthorization({...raw(), ledgerNonce: '18446744073709551615'}, network);
  assert.throws(() => inspectPQWalletActionPolicy(exhausted, 'pq-native-transfer'), {code: 'PQ_LEDGER_NONCE_EXHAUSTED'});
  const proposed = {...vector.registration.fields, priorRevision: '1', newRevision: '2', ledgerNonce: '12', activateAt: '30', pkA: '00'.repeat(2592), pkB: '00'.repeat(64)};
  assert.equal(planPQAccountMigration(s, proposed).policy.mode, 'pq');
  assert.throws(() => planPQAccountMigration(s, {...proposed, pkA: row().pkA}), {code: 'PQ_NEW_KEY_REUSE_REFUSED'});
  assert.throws(() => planPQAccountMigration(s, {...proposed, activateAt: '20'}), {code: 'PQ_MIGRATION_REVIEW_MISMATCH'});
});
test('read-only registration reconciliation reports pending/active/superseded without authorizing replay', () => {
  const intent = {...vector.registration.fields, priorRevision: '0', newRevision: '1', ledgerNonce: '1', activateAt: '20'};
  assert.equal(classifyPQRegistration(parsePQAccountAuthorization(raw(), network), intent).status, 'active');
  const before = {...raw(), executionHeight: '19', algorithmVersion: 'legacy'}; delete before.activeRevision;
  assert.equal(classifyPQRegistration(parsePQAccountAuthorization(before, network), intent).status, 'registered_pending_activation');
  const newer = {...raw(), executionHeight: '31', activeRevision: '2', records: [row(), {...row(), revision: '2', registeredAt: '25', activeFrom: '30', ledgerNonce: '2', pkA: '00'.repeat(2592), pkB: '00'.repeat(64)}]};
  const result = classifyPQRegistration(parsePQAccountAuthorization(newer, network), intent);
  assert.equal(result.status, 'superseded'); assert.equal(result.retryAuthorized, false);
  const empty = {...raw(), algorithmVersion: 'legacy', records: []}; delete empty.activeRevision;
  assert.equal(classifyPQRegistration(parsePQAccountAuthorization(empty, network), intent).status, 'not_found');
  assert.equal(classifyPQRegistration(parsePQAccountAuthorization(empty, network), intent).retryAuthorized, false);
  assert.throws(() => classifyPQRegistration(parsePQAccountAuthorization(raw(), network), {...intent, activateAt: '21'}), {code: 'PQ_REGISTERED_ORIGINAL_MISMATCH'});
});
