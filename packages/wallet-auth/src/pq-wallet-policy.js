// Interprets an independently obtained, trusted-node snapshot. These objects
// are immutable data/dispatch plans, NOT user approval or chain authority.
import {VERSION, decodeMember} from '@ynx/batch-v01-candidate';
import {sha256} from '@noble/hashes/sha2.js';
import {exactPQRecord, pqError, validatePQPublicBinding, pqBase64url, PQ_SUITE} from './pq-wallet-contract.js';
import {PQ_POLICY_VERSION, PQ_U64_MAX, pqU64, pqHex, pqCanonicalAddress,
  normalizePQNativeTransfer, normalizePQRegistrationIntent, decodePQMigrationRequest, encodePQRegistrationIntent,
  encodePQMigrationRequest, preparePQMigrationTransport} from './pq-wallet-authorization.js';
export const PQ_MAX_POLICY_RECORDS = 1024;
const snapshots = new WeakMap();
const decimal = value => {
  if (typeof value !== 'string') throw pqError('PQ_POLICY_DECIMAL_REQUIRED');
  return pqU64(value);
};
const allowed = new Set(['pq-native-transfer', 'pq-account-migration', 'legacy-native-transfer', 'ethereum', 'dex', 'resource', 'delegation', 'recovery-authorization']);
function state(snapshot) {
  const s = snapshots.get(snapshot);
  if (!s) throw pqError('PQ_POLICY_SNAPSHOT_REQUIRED');
  return s;
}
export function parsePQAccountAuthorization(value, expected) {
  exactPQRecord(expected, ['chainId', 'nativeChainId', 'owner']);
  const network = Object.freeze({chainId: pqHex(expected.chainId, 32).toString('hex'), nativeChainId: pqU64(expected.nativeChainId).toString(), owner: pqCanonicalAddress(expected.owner)});
  if (pqU64(network.nativeChainId) === 0n || pqU64(network.nativeChainId) > (1n << 63n) - 1n) throw pqError('PQ_POLICY_NETWORK_INVALID');
  const enabled = value && Object.getOwnPropertyDescriptor(value, 'enabled');
  const algorithm = value && Object.getOwnPropertyDescriptor(value, 'algorithmVersion');
  if (!enabled || !Object.hasOwn(enabled, 'value') || !algorithm || !Object.hasOwn(algorithm, 'value') ||
      (enabled.value !== true && enabled.value !== false)) throw pqError('PQ_POLICY_SNAPSHOT_INVALID');
  const fields = ['owner', 'executionHeight', 'ledgerNonce', 'algorithmVersion', 'enabled', 'records'];
  if (enabled.value) fields.push('policyVersion', 'networkId', 'enableAt');
  if (algorithm.value === VERSION) fields.push('activeRevision');
  exactPQRecord(value, fields);
  const height = decimal(value.executionHeight), nonce = decimal(value.ledgerNonce);
  if (value.owner !== network.owner || !['legacy', VERSION].includes(value.algorithmVersion) || !Array.isArray(value.records) || value.records.length > PQ_MAX_POLICY_RECORDS) throw pqError('PQ_POLICY_SNAPSHOT_INVALID');
  if (!value.enabled && (value.algorithmVersion !== 'legacy' || value.records.length)) throw pqError('PQ_POLICY_SNAPSHOT_INVALID');
  let enableAt = 0n, active = null, revision = 0n;
  if (value.enabled) {
    enableAt = decimal(value.enableAt);
    if (!enableAt || value.policyVersion !== PQ_POLICY_VERSION || pqHex(value.networkId, 32).toString('hex') !== network.chainId) throw pqError('PQ_POLICY_NETWORK_INVALID');
  }
  const records = value.records.map(row => {
    exactPQRecord(row, ['algorithmVersion', 'owner', 'pkA', 'pkB', 'revision', 'registeredAt', 'activeFrom', 'ledgerNonce']);
    const current = decimal(row.revision), registered = decimal(row.registeredAt), activeFrom = decimal(row.activeFrom), consumedNonce = decimal(row.ledgerNonce);
    if (row.algorithmVersion !== VERSION || row.owner !== network.owner || current !== revision + 1n || registered < enableAt || registered > height ||
        activeFrom <= registered || !consumedNonce || consumedNonce > nonce) throw pqError('PQ_POLICY_RECORD_INVALID');
    revision = current;
    const record = Object.freeze({algorithmVersion: VERSION, owner: row.owner, pkA: pqHex(row.pkA, 2592).toString('hex'), pkB: pqHex(row.pkB, 64).toString('hex'),
      revision: current.toString(), registeredAt: registered.toString(), activeFrom: activeFrom.toString(), ledgerNonce: consumedNonce.toString()});
    if (activeFrom <= height) active = record;
    return record;
  });
  if (active) {
    if (height < enableAt || value.algorithmVersion !== VERSION || decimal(value.activeRevision) !== pqU64(active.revision)) throw pqError('PQ_POLICY_ACTIVE_MISMATCH');
  } else if (value.algorithmVersion !== 'legacy' || Object.hasOwn(value, 'activeRevision')) throw pqError('PQ_POLICY_ACTIVE_MISMATCH');
  const normalized = {owner: network.owner, executionHeight: height.toString(), ledgerNonce: nonce.toString(), algorithmVersion: value.algorithmVersion, enabled: value.enabled,
    records: Object.freeze(records)};
  if (value.enabled) Object.assign(normalized, {policyVersion: PQ_POLICY_VERSION, networkId: network.chainId, enableAt: enableAt.toString()});
  if (active) normalized.activeRevision = active.revision;
  const snapshot = Object.freeze(normalized);
  snapshots.set(snapshot, {network, active, height, nonce, enableAt, revision, pending: records.some(r => pqU64(r.activeFrom) > height)});
  return snapshot;
}
export function inspectPQWalletActionPolicy(snapshot, action) {
  const s = state(snapshot);
  if (!allowed.has(action)) throw pqError('PQ_ACTION_UNSUPPORTED');
  if (s.active && !['pq-native-transfer', 'pq-account-migration'].includes(action)) throw pqError('PQ_ACTIVE_ACCOUNT_LEGACY_ENTRY_REFUSED');
  if (action === 'pq-native-transfer' && !s.active) throw pqError('PQ_ACCOUNT_MIGRATION_REQUIRED');
  if (action.startsWith('pq-') && (!snapshot.enabled || s.height < s.enableAt)) throw pqError('PQ_ADMISSION_DISABLED');
  if (s.nonce === PQ_U64_MAX) throw pqError('PQ_LEDGER_NONCE_EXHAUSTED');
  return Object.freeze({mode: s.active ? 'pq' : 'legacy', chainId: s.network.chainId, nativeChainId: s.network.nativeChainId, owner: s.network.owner,
    executionHeight: snapshot.executionHeight, ledgerNonce: snapshot.ledgerNonce, nextNonce: (s.nonce + 1n).toString(), policyRevision: s.active?.revision ?? '0', activeRecord: s.active});
}
export function assertPQAuthorizationCurrent(original, refreshed) {
  const a = state(original), b = state(refreshed);
  const comparable = snapshot => { const {executionHeight, ...rest} = snapshot; return JSON.stringify(rest); };
  if (JSON.stringify(a.network) !== JSON.stringify(b.network) || b.height < a.height || comparable(original) !== comparable(refreshed)) throw pqError('PQ_POLICY_CHANGED_REVIEW_REQUIRED');
  return undefined;
}
export function planPQNativeTransfer(snapshot, value) {
  const policy = inspectPQWalletActionPolicy(snapshot, 'pq-native-transfer'), transfer = normalizePQNativeTransfer(value);
  if (transfer.chainId !== policy.chainId || transfer.nativeChainId !== policy.nativeChainId || transfer.from !== policy.owner || transfer.nonce !== policy.nextNonce || transfer.fee !== '1') throw pqError('PQ_TRANSFER_REVIEW_MISMATCH');
  return Object.freeze({kind: 'pq-native-transfer', transfer, policy});
}
export function planPQAccountMigration(snapshot, value) {
  const policy = inspectPQWalletActionPolicy(snapshot, 'pq-account-migration'), s = state(snapshot), intent = normalizePQRegistrationIntent(value);
  if (s.pending) throw pqError('PQ_PENDING_MIGRATION_REFUSED');
  if (intent.chainId !== policy.chainId || intent.owner !== policy.owner || intent.priorRevision !== s.revision.toString() ||
      intent.newRevision !== (s.revision + 1n).toString() || intent.ledgerNonce !== policy.nextNonce || pqU64(intent.activateAt) <= s.height) throw pqError('PQ_MIGRATION_REVIEW_MISMATCH');
  if (snapshot.records.some(r => r.pkA === intent.pkA || r.pkB === intent.pkB)) throw pqError('PQ_NEW_KEY_REUSE_REFUSED');
  return Object.freeze({kind: 'pq-account-migration', intent, policy});
}
export function assertPQMigrationRequestPolicy(snapshot, wire) {
  const decoded = decodePQMigrationRequest(wire), plan = planPQAccountMigration(snapshot, decoded.intent);
  if (decoded.currentAuthorization !== plan.policy.mode) throw pqError('PQ_ACTIVE_ACCOUNT_LEGACY_ENTRY_REFUSED');
  if (plan.policy.mode === 'pq') {
    const member = decodeMember(decoded.currentPQMember), active = plan.policy.activeRecord;
    if (member.certificate.pkA.toString('hex') !== active.pkA || member.certificate.pkB.toString('hex') !== active.pkB) throw pqError('PQ_CURRENT_REGISTERED_KEY_MISMATCH');
  }
  return plan;
}
export function pqRegisteredPublicBinding(snapshot, revision) {
  const s = state(snapshot);
  const record = revision === undefined ? s.active : snapshot.records.find(r => r.revision === pqU64(revision).toString());
  if (!record) throw pqError('PQ_REGISTERED_KEY_NOT_FOUND');
  return validatePQPublicBinding({protocolVersion: VERSION, suite: PQ_SUITE, chainId: s.network.chainId, owner: s.network.owner,
    pkA: pqBase64url(pqHex(record.pkA, 2592)), pkB: pqBase64url(pqHex(record.pkB, 64))});
}
// Read-only reconciliation. Even NOT_FOUND is not permission to replace the
// original wire/nonce or repeat an uncertain write. Existing original hash and
// durable transaction receipt readback remain the App's authoritative ports.
export function classifyPQRegistration(snapshot, value) {
  const s = state(snapshot), intent = normalizePQRegistrationIntent(value);
  if (intent.chainId !== s.network.chainId || intent.owner !== s.network.owner) throw pqError('PQ_POLICY_NETWORK_INVALID');
  const record = snapshot.records.find(r => r.revision === intent.newRevision);
  if (!record) return Object.freeze({status: 'not_found', executionHeight: snapshot.executionHeight, retryAuthorized: false});
  if (record.pkA !== intent.pkA || record.pkB !== intent.pkB || record.ledgerNonce !== intent.ledgerNonce || record.activeFrom !== intent.activateAt) throw pqError('PQ_REGISTERED_ORIGINAL_MISMATCH');
  const status = s.active && pqU64(s.active.revision) > pqU64(record.revision) ? 'superseded' : s.active?.revision === record.revision ? 'active' : 'registered_pending_activation';
  return Object.freeze({status, revision: record.revision, activationHeight: record.activeFrom, executionHeight: snapshot.executionHeight, retryAuthorized: false});
}
export function preparePQClassicMigrationAuthorization(snapshot, value) {
  const plan = planPQAccountMigration(snapshot, value);
  if (plan.policy.mode !== 'legacy') throw pqError('PQ_ACTIVE_ACCOUNT_LEGACY_ENTRY_REFUSED');
  const bytes = encodePQRegistrationIntent(plan.intent), digest = sha256(bytes);
  // The original Wallet authority signs this exact digest with its existing
  // lawful compressed classic key only while the account is pre-activation.
  return Object.freeze({plan, get intentBytes() { return new Uint8Array(bytes); }, get digest() { return new Uint8Array(digest); }});
}
export function preparePQReviewedMigrationTransport(snapshot, proofs) {
  const wire = encodePQMigrationRequest(proofs), plan = assertPQMigrationRequestPolicy(snapshot, wire);
  return Object.freeze({plan, request: preparePQMigrationTransport(wire)});
}
