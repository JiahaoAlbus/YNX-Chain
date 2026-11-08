// Sole registered snapshot DATA grammar extracted from pq-wallet-policy.js.
// Native owns independent current capture. This brand is DATA custody only,
// never a Source/Root/review grant. Node reexport follows after mother lease.
import {VERSION} from '@ynx/batch-v01-candidate/browser';
import {exactPQRecord,pqError} from './pq-wallet-contract.js';
import {pqU64,PQ_U64_MAX,pqHexBytes} from './pq-public-bytes.js';
export const PQ_MAX_POLICY_RECORDS=1024;
export const PQ_POLICY_REVOCATION_VERSION='YNX-ACCOUNT-POLICY/v2';
const PQ_POLICY_VERSION='YNX-ACCOUNT-POLICY/v1';
const snapshots=new WeakMap();
const decimal=value=>{if(typeof value!=='string')throw pqError('PQ_POLICY_DECIMAL_REQUIRED');return pqU64(value);};
const canonicalHex=(value,size)=>{pqHexBytes(value,size);return value;};
const pqCanonicalAddress=value=>{if(typeof value!=='string'||!/^0x[0-9a-f]{40}$/.test(value))throw pqError('PQ_CANONICAL_ADDRESS_REQUIRED');return value;};
export function originalPQSnapshotStateDATA(snapshot){const s=snapshots.get(snapshot);if(!s)throw pqError('PQ_POLICY_SNAPSHOT_REQUIRED');return s;}
const state=originalPQSnapshotStateDATA;
export function parsePQAccountAuthorization(value, expected) {
  exactPQRecord(expected, ['chainId', 'nativeChainId', 'owner']);
  const network = Object.freeze({chainId: canonicalHex(expected.chainId, 32), nativeChainId: pqU64(expected.nativeChainId).toString(), owner: pqCanonicalAddress(expected.owner)});
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
    if (!enableAt || ! [PQ_POLICY_VERSION,PQ_POLICY_REVOCATION_VERSION].includes(value.policyVersion) || canonicalHex(value.networkId, 32) !== network.chainId) throw pqError('PQ_POLICY_NETWORK_INVALID');
  }
  let priorRecord=null;
  const records = value.records.map(row => {
    exactPQRecord(row, ['algorithmVersion', 'owner', 'pkA', 'pkB', 'revision', 'registeredAt', 'activeFrom', 'ledgerNonce']);
    const current = decimal(row.revision), registered = decimal(row.registeredAt), activeFrom = decimal(row.activeFrom), consumedNonce = decimal(row.ledgerNonce);
    if (row.algorithmVersion !== VERSION || row.owner !== network.owner || current !== revision + 1n || registered < enableAt || registered > height ||
        activeFrom <= registered || !consumedNonce || consumedNonce > nonce || priorRecord&&(registered<pqU64(priorRecord.activeFrom)||activeFrom<=pqU64(priorRecord.activeFrom)||consumedNonce<=pqU64(priorRecord.ledgerNonce))) throw pqError('PQ_POLICY_RECORD_INVALID');
    revision = current;
    const record = Object.freeze({algorithmVersion: VERSION, owner: row.owner, pkA: canonicalHex(row.pkA, 2592), pkB: canonicalHex(row.pkB, 64),
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
  snapshots.set(snapshot, Object.freeze({network, active, height, nonce, enableAt, revision, revocation,revoked:revocation!==null&&height>=pqU64(revocation.revokedFrom),pending: records.some(r => pqU64(r.activeFrom) > height)}));
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
export function assertPQAuthorizationCurrent(original, refreshed) {
  const a = state(original), b = state(refreshed);
  const comparable = snapshot => { const {executionHeight, ...rest} = snapshot; return JSON.stringify(rest); };
  if (JSON.stringify(a.network) !== JSON.stringify(b.network) || b.height < a.height || a.revoked!==b.revoked || comparable(original) !== comparable(refreshed)) throw pqError('PQ_POLICY_CHANGED_REVIEW_REQUIRED');
  return undefined;
}
