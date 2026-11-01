import {Buffer} from 'node:buffer';
import {PENDING_ORIGINAL_QUERY_CONTRACT,decodePendingPairOriginalQueryDATA,projectPendingPairOriginalQueryDATA,type PendingPairOriginalQueryStoreDATA,type PendingPairSelectedOperationRowDATA} from '../src/product-pair-pending-original-query-data.mjs';
const noSession:false=PENDING_ORIGINAL_QUERY_CONTRACT.sessionBinding;
declare const q:Buffer,pairPost:Buffer,actor:string,row:PendingPairSelectedOperationRowDATA|null,store:PendingPairOriginalQueryStoreDATA;
const decoded=decodePendingPairOriginalQueryDATA(q);const d=projectPendingPairOriginalQueryDATA(q,pairPost,actor,row);const stored=store.readPendingPairOriginalQueryDATA({queryOriginal:q,originalPairPost:pairPost,actor});
const noRetry:false=d.retryAuthorized;const noAuthority:false=stored.authorized;
// @ts-expect-error original producer requires Buffer, never text/Uint8Array DTO
const bad=decodePendingPairOriginalQueryDATA(new Uint8Array());
// @ts-expect-error no session binding in pending-query DATA result
const session:string=decoded.sessionBinding;
// @ts-expect-error DATA projection cannot become Source admission
const grant:true=stored.sourceAdmission;
// @ts-expect-error pending query read has no replay or effect submit port
store.submitPair(q);
void [noSession,noRetry,noAuthority,bad,session,grant];
import {inspectPendingPairQueryTransportDATA,PENDING_QUERY_TRANSPORT_RULES} from '../src/product-pair-pending-query-transport-data.mjs';
const tr=inspectPendingPairQueryTransportDATA({},'https://wallet-auth.ynxweb4.com',1);
const noSessionGrant:false=tr.sessionGranted;const ttl:30000=PENDING_QUERY_TRANSPORT_RULES.maxWindowMs;
// @ts-expect-error no source permission in transport DATA
const source:true=tr.sourceAdmission;
void [noSessionGrant,ttl,source];
