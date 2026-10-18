import {normalizePQNativeAction} from './pq-native-action.js';
// Interprets an independently obtained, trusted-node snapshot. These objects
// are immutable data/dispatch plans, NOT user approval or chain authority.
import {VERSION, decodeMember} from '@ynx/batch-v01-candidate';
import {sha256} from '@noble/hashes/sha2.js';
import {exactPQRecord, pqError, validatePQPublicBinding, pqBase64url, PQ_SUITE} from './pq-wallet-contract.js';
import {PQ_POLICY_VERSION, PQ_U64_MAX, pqU64, pqHex, pqCanonicalAddress,
  normalizePQNativeTransfer, normalizePQRegistrationIntent, decodePQMigrationRequest, encodePQRegistrationIntent,
  encodePQMigrationRequest, preparePQMigrationTransport,encodePQClassicMigrationProof,
  normalizePQRevocationIntent, encodePQRevocationRequest, decodePQRevocationRequest, preparePQRevocationTransport} from './pq-wallet-authorization.js';
export const PQ_MAX_POLICY_RECORDS = 1024;
export const PQ_POLICY_REVOCATION_VERSION='YNX-ACCOUNT-POLICY/v2';
const snapshots = new WeakMap();
const decimal = value => {
  if (typeof value !== 'string') throw pqError('PQ_POLICY_DECIMAL_REQUIRED');
  return pqU64(value);
};
const allowed = new Set(['pq-native-action', 'pq-native-transfer', 'pq-account-migration', 'pq-account-revocation', 'legacy-native-transfer', 'ethereum', 'dex', 'resource', 'delegation', 'recovery-authorization']);
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
  const isV2=value&&Object.getOwnPropertyDescriptor(value,'policyVersion')?.value===PQ_POLICY_REVOCATION_VERSION;
  const fields = ['owner', 'executionHeight', 'ledgerNonce', 'algorithmVersion', 'enabled', 'records'];
  if (enabled.value) fields.push('policyVersion', 'networkId', 'enableAt');
  if (algorithm.value === VERSION) fields.push('activeRevision');
  if(isV2)fields.push('revocations');
  exactPQRecord(value, fields);
  const height = decimal(value.executionHeight), nonce = decimal(value.ledgerNonce);
  if (value.owner !== network.owner || !['legacy', VERSION].includes(value.algorithmVersion) || !Array.isArray(value.records) || value.records.length > PQ_MAX_POLICY_RECORDS) throw pqError('PQ_POLICY_SNAPSHOT_INVALID');
  if (!value.enabled && (value.algorithmVersion !== 'legacy' || value.records.length)) throw pqError('PQ_POLICY_SNAPSHOT_INVALID');
  let enableAt = 0n, active = null, revision = 0n;
  if (value.enabled) {
    enableAt = decimal(value.enableAt);
    if (!enableAt || ! [PQ_POLICY_VERSION,PQ_POLICY_REVOCATION_VERSION].includes(value.policyVersion) || pqHex(value.networkId, 32).toString('hex') !== network.chainId) throw pqError('PQ_POLICY_NETWORK_INVALID');
  }
  let priorRecord=null;
  const records = value.records.map(row => {
    exactPQRecord(row, ['algorithmVersion', 'owner', 'pkA', 'pkB', 'revision', 'registeredAt', 'activeFrom', 'ledgerNonce']);
    const current = decimal(row.revision), registered = decimal(row.registeredAt), activeFrom = decimal(row.activeFrom), consumedNonce = decimal(row.ledgerNonce);
    if (row.algorithmVersion !== VERSION || row.owner !== network.owner || current !== revision + 1n || registered < enableAt || registered > height ||
        activeFrom <= registered || !consumedNonce || consumedNonce > nonce || priorRecord&&(registered<pqU64(priorRecord.activeFrom)||activeFrom<=pqU64(priorRecord.activeFrom)||consumedNonce<=pqU64(priorRecord.ledgerNonce))) throw pqError('PQ_POLICY_RECORD_INVALID');
    revision = current;
    const record = Object.freeze({algorithmVersion: VERSION, owner: row.owner, pkA: pqHex(row.pkA, 2592).toString('hex'), pkB: pqHex(row.pkB, 64).toString('hex'),
      revision: current.toString(), registeredAt: registered.toString(), activeFrom: activeFrom.toString(), ledgerNonce: consumedNonce.toString()});
    priorRecord=record;
    if (activeFrom <= height) active = record;
    return record;
  });
  if (active) {
    if (height < enableAt || value.algorithmVersion !== VERSION || decimal(value.activeRevision) !== pqU64(active.revision)) throw pqError('PQ_POLICY_ACTIVE_MISMATCH');
  } else if (value.algorithmVersion !== 'legacy' || Object.hasOwn(value, 'activeRevision')) throw pqError('PQ_POLICY_ACTIVE_MISMATCH');
  let revocation=null;
  if(isV2){
    if(!value.enabled||!Array.isArray(value.revocations)||value.revocations.length!==1)throw pqError('PQ_POLICY_REVOCATION_INVALID');
    const r=value.revocations[0];exactPQRecord(r,['owner','authorizingRevision','throughRevision','registeredAt','revokedFrom','ledgerNonce'],'PQ_POLICY_REVOCATION_INVALID');
    const number=value=>{try{return decimal(value);}catch{throw pqError('PQ_POLICY_REVOCATION_INVALID');}};
    const authorizing=number(r.authorizingRevision),through=number(r.throughRevision),registered=number(r.registeredAt),from=number(r.revokedFrom),consumed=number(r.ledgerNonce);
    let lawful=null;for(const record of records)if(pqU64(record.activeFrom)<=registered)lawful=record;
    if(r.owner!==network.owner||!authorizing||through<authorizing||registered<enableAt||registered>height||registered===PQ_U64_MAX||from!==registered+1n||!consumed||consumed>nonce||!lawful||pqU64(lawful.revision)!==authorizing||!priorRecord||pqU64(priorRecord.revision)!==through||records.some(record=>pqU64(record.registeredAt)>registered)||pqU64(priorRecord.ledgerNonce)>=consumed)throw pqError('PQ_POLICY_REVOCATION_INVALID');
    revocation=Object.freeze({owner:network.owner,authorizingRevision:authorizing.toString(),throughRevision:through.toString(),registeredAt:registered.toString(),revokedFrom:from.toString(),ledgerNonce:consumed.toString()});
  }
  const normalized = {owner: network.owner, executionHeight: height.toString(), ledgerNonce: nonce.toString(), algorithmVersion: value.algorithmVersion, enabled: value.enabled,
    records: Object.freeze(records)};
  if (value.enabled) Object.assign(normalized, {policyVersion: value.policyVersion, networkId: network.chainId, enableAt: enableAt.toString()});
  if (active) normalized.activeRevision = active.revision;
  if(revocation)normalized.revocations=Object.freeze([revocation]);
  const snapshot = Object.freeze(normalized);
  snapshots.set(snapshot, {network, active, height, nonce, enableAt, revision, revocation,revoked:revocation!==null&&height>=pqU64(revocation.revokedFrom),pending: records.some(r => pqU64(r.activeFrom) > height)});
  return snapshot;
}
/** Retained complete policy DATA at an observed/past height, never a grant. */
export function inspectPQAuthorizationView(snapshot,atHeight=undefined){
  const s=state(snapshot),height=atHeight===undefined?s.height:pqU64(atHeight);
  if(height>s.height)throw pqError('PQ_POLICY_VIEW_HEIGHT_INVALID');
  let active=null,registered=false;
  for(const record of snapshot.records)if(pqU64(record.registeredAt)<=height){registered=true;if(pqU64(record.activeFrom)<=height)active=record;}
  let authorizationStatus=active?'active':registered?'pending_activation':'legacy',pqSigningEnabled=active!==null;
  if(s.revocation&&pqU64(s.revocation.registeredAt)<=height){authorizationStatus=height>=pqU64(s.revocation.revokedFrom)?'revoked':'revocation_pending';if(authorizationStatus==='revoked')pqSigningEnabled=false;}
  return Object.freeze({authorizationStatus,pqSigningEnabled,activeRecord:active,executionHeight:height.toString()});
}
export function inspectPQWalletActionPolicy(snapshot, action) {
  const s = state(snapshot);
  if (!allowed.has(action)) throw pqError('PQ_ACTION_UNSUPPORTED');
  if(s.revoked)throw pqError('PQ_ACCOUNT_REVOKED');
  if(s.revocation&&['pq-account-migration','pq-account-revocation'].includes(action))throw pqError('PQ_TERMINAL_REVOCATION_PENDING');
  if (s.active && !['pq-native-action', 'pq-native-transfer', 'pq-account-migration', 'pq-account-revocation'].includes(action)) throw pqError('PQ_ACTIVE_ACCOUNT_LEGACY_ENTRY_REFUSED');
  if (['pq-native-action','pq-native-transfer','pq-account-revocation'].includes(action) && !s.active) throw pqError('PQ_ACCOUNT_MIGRATION_REQUIRED');
  if (action.startsWith('pq-') && (!snapshot.enabled || s.height < s.enableAt)) throw pqError('PQ_ADMISSION_DISABLED');
  if (s.nonce === PQ_U64_MAX) throw pqError('PQ_LEDGER_NONCE_EXHAUSTED');
  return Object.freeze({mode: s.active ? 'pq' : 'legacy', chainId: s.network.chainId, nativeChainId: s.network.nativeChainId, owner: s.network.owner,
    executionHeight: snapshot.executionHeight, ledgerNonce: snapshot.ledgerNonce, nextNonce: (s.nonce + 1n).toString(), policyRevision: s.active?.revision ?? '0', activeRecord: s.active});
}
export function assertPQAuthorizationCurrent(original, refreshed) {
  const a = state(original), b = state(refreshed);
  const comparable = snapshot => { const {executionHeight, ...rest} = snapshot; return JSON.stringify(rest); };
  if (JSON.stringify(a.network) !== JSON.stringify(b.network) || b.height < a.height || a.revoked!==b.revoked || comparable(original) !== comparable(refreshed)) throw pqError('PQ_POLICY_CHANGED_REVIEW_REQUIRED');
  return undefined;
}
/** Exact current-account transaction DATA only. The original Wallet review and
 * keyAccess lease must fence the same plan before/after signing and sending.
 * Fees follow original executor rules; codec-only vectors may use other fees. */
export function planPQNativeAction(snapshot,value){
 const policy=inspectPQWalletActionPolicy(snapshot,'pq-native-action'),action=normalizePQNativeAction(value);
 const fee=action.kind==='contract_deploy'?'10':action.kind==='contract_execute'?'2':
  ['stake','resource_delegation_create','resource_rental_create'].includes(action.kind)?'0':'1';
 if(action.chainId!==policy.chainId||action.nativeChainId!==policy.nativeChainId||action.owner!==policy.owner||action.nonce!==policy.nextNonce||action.fee!==fee)throw pqError('PQ_ACTION_REVIEW_MISMATCH');
 return Object.freeze({kind:'pq-native-action',action,policy});
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
  const status = s.revocation?(s.revoked?'revoked':'revocation_pending'):s.active && pqU64(s.active.revision) > pqU64(record.revision) ? 'superseded' : s.active?.revision === record.revision ? 'active' : 'registered_pending_activation';
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
/** Original signer signs preparePQClassicMigrationAuthorization(...).digest.
 * Convert its public r/s result only after checking the same current policy.
 * Active PQ accounts cannot call this as a classic migration fallback. */
export function preparePQClassicMigrationProof(snapshot,value,signature){
  const {plan}=preparePQClassicMigrationAuthorization(snapshot,value);
  return encodePQClassicMigrationProof(plan.intent,signature);
}

/** Terminal current-pair review. Pending rotations remain in the complete
 * schedule without becoming signing authority or blocking revocation. */
export function planPQAccountRevocation(snapshot, value) {
  const policy = inspectPQWalletActionPolicy(snapshot, 'pq-account-revocation');
  const s = state(snapshot), intent = normalizePQRevocationIntent(value), active = policy.activeRecord;
  if (intent.chainId !== policy.chainId || intent.owner !== policy.owner ||
      intent.authorizingRevision !== active.revision || intent.throughRevision !== s.revision.toString() ||
      intent.pkA !== active.pkA || intent.pkB !== active.pkB || intent.ledgerNonce !== policy.nextNonce ||
      intent.executeAt !== policy.executionHeight || s.height === PQ_U64_MAX || intent.revokeAt !== (s.height + 1n).toString()) {
    throw pqError('PQ_REVOCATION_REVIEW_MISMATCH');
  }
  return Object.freeze({kind: 'pq-account-revocation', intent, policy});
}
export function assertPQRevocationRequestPolicy(snapshot, wire) {
  const decoded = decodePQRevocationRequest(wire), plan = planPQAccountRevocation(snapshot, decoded.intent);
  const member = decodeMember(decoded.currentPQMember), active = plan.policy.activeRecord;
  if (member.certificate.pkA.toString('hex') !== active.pkA || member.certificate.pkB.toString('hex') !== active.pkB) {
    throw pqError('PQ_CURRENT_REGISTERED_KEY_MISMATCH');
  }
  return plan;
}
export function preparePQReviewedRevocationTransport(snapshot, proofs) {
  const wire = encodePQRevocationRequest(proofs), plan = assertPQRevocationRequestPolicy(snapshot, wire);
  return Object.freeze({plan, request: preparePQRevocationTransport(wire)});
}
