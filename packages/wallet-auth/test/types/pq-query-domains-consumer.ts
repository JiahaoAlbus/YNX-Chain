import {preparePQOriginalLookup,preparePQActionOriginalLookup,preparePQWholeOriginalLookup,preparePQTransactionLookup,preparePQTransferFinalityLookup,preparePQActionFinalityLookup} from '../../src/pq-wallet-authorization.js';
const hash='0x'+'11'.repeat(32);
const plans=[preparePQOriginalLookup(hash),preparePQActionOriginalLookup(hash),preparePQWholeOriginalLookup(hash),preparePQTransactionLookup(hash),preparePQTransferFinalityLookup(hash),preparePQActionFinalityLookup(hash)];
for(const plan of plans){const method:'GET'=plan.method;const path:string=plan.path;void [method,path];}
// @ts-expect-error Hashes are complete canonical strings, never rounded numeric values.
preparePQOriginalLookup(1);
// @ts-expect-error ABI hash is not supplied as bytes or a capability object.
preparePQActionFinalityLookup(new Uint8Array(32));
// @ts-expect-error A read plan cannot be mutated into a submission.
plans[0].method='POST';
// @ts-expect-error The GET plan does not carry a verified consensus proof.
const finality:true=plans[0].consensusFinality;
void finality;
