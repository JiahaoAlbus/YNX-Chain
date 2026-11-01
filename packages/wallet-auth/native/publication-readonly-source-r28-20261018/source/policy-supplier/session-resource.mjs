// Reuses the frozen r12 lifecycle, NOT transaction execution/nonce semantics.
import {AccountPolicyResourceKernel} from './session-lifecycle.mjs';
import {CANONICAL_NETWORK_ID,openNormalOperatorSource} from './operator-query.mjs';
const supplied=new WeakSet();
export function isOriginalAccountPolicyResource(value){return supplied.has(value);}
export async function acquireOriginalAccountPolicy(request){
 if(request?.networkId!==CANONICAL_NETWORK_ID)throw Object.assign(new Error('AUTH_ACCOUNT_POLICY_NETWORK'),{code:'AUTH_ACCOUNT_POLICY_NETWORK'});
 const resource=new AccountPolicyResourceKernel(request,openNormalOperatorSource('session'));
 try{await resource.initialize();resource.assertCurrent();supplied.add(resource);return resource;}
 catch(cause){const error=Object.assign(new Error('AUTH_ACCOUNT_POLICY_COMMITTED_SOURCE_NOT_SUPPLIED',{cause}),{code:'AUTH_ACCOUNT_POLICY_COMMITTED_SOURCE_NOT_SUPPLIED'});Object.defineProperty(error,'partial',{value:resource});throw error;}
}
