// Source-owned RPC metadata checks. The sole SDK owns core policy/revocation
// interpretation; this module never drops a nonempty owner tombstone.
import {parsePQAccountAuthorization, inspectPQAuthorizationView} from '@ynx-chain/wallet-auth/pq-wallet-policy';
export const CANONICAL_NETWORK_ID = '16366ff25bcc73c6bb95d12733be74d1ac885d3daf518ddd0e4bd4438cff243f';
const fail = code => { throw Object.assign(new Error(code), {code}); };
const hex = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const u64 = v => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(v) || BigInt(v) > ((1n << 64n) - 1n)) fail('AUTH_POLICY_QUERY_U64');
  return BigInt(v);
};
const baseMetadata = ['policyView', 'recordsView', 'source', 'committedHeight', 'committedBlockHash',
  'committedAlgorithmVersion', 'checkpointStatus', 'checkpointIntegrity', 'recordsComplete'];
const statusMetadata = ['authorizationStatus', 'pqSigningEnabled', 'committedAuthorizationStatus',
  'committedPQSigningEnabled', 'globalPolicyVersion'];
const additive = [...statusMetadata, 'revocations'];
const version1 = 'YNX-ACCOUNT-POLICY/v1', version2 = 'YNX-ACCOUNT-POLICY/v2';

export function inspectOperatorProjection(body, owner) {
  if (!body || Object.getPrototypeOf(body) !== Object.prototype ||
      Reflect.ownKeys(body).some(k => typeof k !== 'string' || !Object.hasOwn(Object.getOwnPropertyDescriptor(body, k), 'value') || !Object.getOwnPropertyDescriptor(body, k).enumerable)) fail('AUTH_POLICY_QUERY_SCHEMA');
  const newMetadata = additive.some(k => Object.hasOwn(body, k));
  if (newMetadata && !additive.every(k => Object.hasOwn(body, k))) fail('AUTH_POLICY_QUERY_INCOMPLETE');
  const v2 = body.policyVersion === version2;
  if (v2 && !newMetadata) fail('AUTH_POLICY_QUERY_INCOMPLETE');
  const extras = [...baseMetadata];
  if (body.committedAlgorithmVersion === 'YNX-BATCH/v0.1') extras.push('committedActiveRevision');
  if (newMetadata) extras.push(...statusMetadata);
  // Actual Go owner projection may be v1 under global v2 ONLY when its own
  // tombstone list is empty. An owner v2 tombstone remains in the SDK core.
  if (newMetadata && !v2) extras.push('revocations');
  const allowed = ['owner', 'executionHeight', 'ledgerNonce', 'algorithmVersion', 'enabled', 'records', ...extras];
  if (body.enabled === true) allowed.push('policyVersion', 'networkId', 'enableAt');
  if (body.algorithmVersion === 'YNX-BATCH/v0.1') allowed.push('activeRevision');
  if (v2) allowed.push('revocations');
  if (Object.keys(body).sort().join('|') !== allowed.sort().join('|')) fail('AUTH_POLICY_QUERY_INCOMPLETE');
  if (body.policyView !== 'next_execution' || body.recordsView !== 'includes_pending' || body.recordsComplete !== true ||
      body.source !== 'authoritative_producer' || body.checkpointStatus !== 'durable' ||
      !hex(body.checkpointIntegrity) || !hex(body.committedBlockHash)) fail('AUTH_POLICY_QUERY_UNHEALTHY');
  const height = u64(body.committedHeight), next = u64(body.executionHeight);
  if (next !== (height === ((1n << 64n) - 1n) ? height : height + 1n)) fail('AUTH_POLICY_QUERY_HEIGHT');
  if (newMetadata) {
    if (!Array.isArray(body.revocations) || (!v2 && body.revocations.length !== 0) ||
        (body.enabled === false ? body.globalPolicyVersion !== '' :
          v2 ? body.globalPolicyVersion !== version2 :
          body.policyVersion !== version1 || ![version1, version2].includes(body.globalPolicyVersion))) fail('AUTH_POLICY_QUERY_REVOCATION_MISMATCH');
  }
  const dto = Object.fromEntries(Object.entries(body).filter(([k]) => !extras.includes(k)));
  const authorization = parsePQAccountAuthorization(dto, {chainId: CANONICAL_NETWORK_ID, nativeChainId: '6423', owner});
  const nextView = inspectPQAuthorizationView(authorization);
  const committedView = inspectPQAuthorizationView(authorization, body.committedHeight);
  if (newMetadata && (body.authorizationStatus !== nextView.authorizationStatus || body.pqSigningEnabled !== nextView.pqSigningEnabled ||
      body.committedAuthorizationStatus !== committedView.authorizationStatus || body.committedPQSigningEnabled !== committedView.pqSigningEnabled)) fail('AUTH_POLICY_QUERY_REVOCATION_STATUS_MISMATCH');
  // Go PolicyAt selects a historical registration even after it is revoked.
  // Its algorithm/revision metadata is NOT pqSigningEnabled or a new grant.
  let committed = null;
  for (const record of authorization.records) {
    if (u64(record.registeredAt) <= height && u64(record.activeFrom) <= height) committed = record;
  }
  if (committed) {
    if (body.committedAlgorithmVersion !== 'YNX-BATCH/v0.1' || body.committedActiveRevision !== committed.revision) fail('AUTH_POLICY_QUERY_COMMITTED_MISMATCH');
  } else if (body.committedAlgorithmVersion !== 'legacy' || Object.hasOwn(body, 'committedActiveRevision')) fail('AUTH_POLICY_QUERY_COMMITTED_MISMATCH');
  return Object.freeze({authorization, committedRecord: committed, nextView, committedView,
    committedHeight: body.committedHeight, committedBlockHash: body.committedBlockHash, checkpointIntegrity: body.checkpointIntegrity});
}

export function assertSessionProjectionSupported(view) {
  // Existing Session v1 has no terminal-tombstone representation. Do not
  // reinterpret pending/revoked v2 as active PQ, legacy, or a fresh session.
  if (view.authorization.policyVersion === version2 || (view.authorization.revocations?.length ?? 0) !== 0) fail('AUTH_POLICY_SESSION_REVOCATION_UNSUPPORTED');
}
