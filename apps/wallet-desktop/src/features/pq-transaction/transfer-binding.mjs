import {createHash} from 'node:crypto';
import {encodePQNativeTransfer, decodePQTransferRequest, preparePQTransferTransport, preparePQOriginalLookup, decodePQMigrationRequest, preparePQMigrationTransport} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
import {parsePQOriginalRecord} from '../../wallet-pq-intent-record.mjs';
import {pqSubmissionIdentity} from '../../wallet-pq-progress.mjs';

const fail = code => { throw Object.assign(Error(code), {code}); };
export function exactData(value, fields, code = 'PQ_TRANSACTION_INPUT_INVALID') {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail(code);
}
const accountPattern = /^0x[0-9a-f]{40}$/, networkPattern = /^[0-9a-f]{64}$/;
function networkBinding(account, networkId) {
  if (typeof account !== 'string' || !accountPattern.test(account) || typeof networkId !== 'string' || !networkPattern.test(networkId)) fail('PQ_TRANSACTION_NETWORK_BINDING');
}
function bindTransfer(transfer, account, networkId) {
  networkBinding(account, networkId);
  const bytes = encodePQNativeTransfer(transfer);
  if (transfer.from !== account || transfer.chainId !== networkId || transfer.nativeChainId !== '6423' || transfer.fee !== '1') fail('PQ_TRANSACTION_NETWORK_BINDING');
  // This digest is correlation DATA only. The existing dual signer still signs
  // the complete canonical message, never this digest in place of that message.
  return Object.freeze({...transfer, intentSha256: createHash('sha256').update(bytes).digest('hex')});
}

/** Bind an original main pending review, before any keys or permission. */
export function pqTransferReviewBinding(request, {account, networkId}) {
  exactData(request, ['id', 'origin', 'method', 'params', 'createdAt', 'review']);
  if (typeof request.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(request.id) || request.origin !== 'ynx-wallet:local-pq' || request.method !== 'ynx_signPQNativeTransfer' || !Array.isArray(request.params) || request.params.length !== 0) fail('PQ_TRANSACTION_REVIEW_BINDING');
  const r = request.review;
  exactData(r, ['title','account','chainId','nativeChainId','from','to','amount','fee','nonce','policyRevision','expiresAt','warning']);
  if (r.account !== account || typeof r.policyRevision !== 'string' || !/^[1-9][0-9]*$/.test(r.policyRevision)) fail('PQ_TRANSACTION_REVIEW_BINDING');
  for (const time of [request.createdAt, r.expiresAt]) if (typeof time !== 'string' || !Number.isFinite(Date.parse(time)) || new Date(time).toISOString() !== time) fail('PQ_TRANSACTION_REVIEW_BINDING');
  if (request.createdAt >= r.expiresAt) fail('PQ_TRANSACTION_REVIEW_BINDING');
  const transfer = bindTransfer(Object.fromEntries(['chainId','nativeChainId','from','to','amount','fee','nonce'].map(key => [key,r[key]])), account, networkId);
  return Object.freeze({operationId: request.id, account, ...transfer, policyRevision:r.policyRevision, createdAt:request.createdAt, expiresAt:r.expiresAt});
}

/** Main-only codec adapter. Uses the SDK's exact wire and original hashes.
 * Neither the record nor the returned request grants approval or retry. */
export function preparePQTransferOriginal(value, {account, networkId}) {
  const original = parsePQOriginalRecord(value);
  if (original.kind !== 'pq-transfer' || original.account !== account) fail('PQ_TRANSACTION_ORIGINAL_BINDING');
  const wire = Buffer.from(original.wire, 'base64url'), decoded = decodePQTransferRequest(wire);
  const transfer = bindTransfer(decoded.transfer, account, networkId);
  const request = preparePQTransferTransport(wire), identity = pqSubmissionIdentity(original);
  return Object.freeze({original, request, binding: Object.freeze({account, operationId:original.operationId, kind:original.kind, hash:original.hash, ...transfer, abciTransactionHash:identity.abciTransactionHash}), lookup: preparePQOriginalLookup(original.hash)});
}

/** Existing signed E6 only. No registration, new signature or authority is
 * inferred from these public bytes; the independent migration owner admits
 * the current policy at execution H. Keep the complete nested proofs intact. */
export function preparePQMigrationOriginal(value,{account,networkId}) {
  const original=parsePQOriginalRecord(value);networkBinding(account,networkId);
  if(original.kind!=='pq-migration'||original.account!==account)fail('PQ_TRANSACTION_ORIGINAL_BINDING');
  const wire=Buffer.from(original.wire,'base64url'),decoded=decodePQMigrationRequest(wire),intent=Object.freeze({...decoded.intent});
  if(intent.owner!==account||intent.chainId!==networkId)fail('PQ_TRANSACTION_NETWORK_BINDING');
  const request=preparePQMigrationTransport(wire),identity=pqSubmissionIdentity(original);
  if(request.transportHash!==original.hash)fail('PQ_TRANSACTION_ORIGINAL_BINDING');
  return Object.freeze({original,request,migration:true,binding:Object.freeze({account,operationId:original.operationId,kind:original.kind,hash:original.hash,chainId:networkId,nativeChainId:'6423',abciTransactionHash:identity.abciTransactionHash,transactionType:'account_migration',intent,currentAuthorization:decoded.currentAuthorization,intentSha256:createHash('sha256').update(decoded.intentBytes).digest('hex'),currentPQMemberHash:decoded.currentPQMember.length?'0x'+createHash('sha256').update(decoded.currentPQMember).digest('hex'):null,newKeyWholeProofHash:'0x'+createHash('sha256').update(decoded.newKeyWholeProof).digest('hex')})});
}
/** Backward-compatible standalone DATA dispatch; initial/typed stay on their
 * existing separate paths, and may not be coerced to a transfer or migration. */
export function preparePQStandaloneOriginal(value,binding){
  return Object.getOwnPropertyDescriptor(value??{},'kind')?.value==='pq-migration'?preparePQMigrationOriginal(value,binding):preparePQTransferOriginal(value,binding);
}

export async function readPQTransferOriginal(intentStore, hash, {account, networkId, guard}) {
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(hash) || guard?.account !== account || typeof guard?.assert !== 'function') fail('PQ_TRANSACTION_ORIGINAL_BINDING');
  networkBinding(account, networkId); guard.assert();
  const originals = await intentStore.readPQOriginals(account, () => guard.assert());
  guard.assert();
  const original = originals.find(row => row.hash === hash && row.account === account);
  if (!original) fail('TRANSACTION_INTENT_REQUIRED');
  return preparePQTransferOriginal(original, {account, networkId});
}
