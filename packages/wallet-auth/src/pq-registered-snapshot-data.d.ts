import type{PQAuthorizationSnapshot,PQPolicyRecord,PQRevocationRecord}from'./pq-wallet-policy.js';
export{parsePQAccountAuthorization,inspectPQAuthorizationView,assertPQAuthorizationCurrent,PQ_MAX_POLICY_RECORDS,PQ_POLICY_REVOCATION_VERSION}from'./pq-wallet-policy.js';
/** Readonly original parsed DATA state, no Source/Root or signing capability. */
export function originalPQSnapshotStateDATA(snapshot:PQAuthorizationSnapshot):Readonly<{network:Readonly<{chainId:string;nativeChainId:string;owner:string}>;active:PQPolicyRecord|null;height:bigint;nonce:bigint;enableAt:bigint;revision:bigint;revocation:PQRevocationRecord|null;revoked:boolean;pending:boolean}>;
