// PRIVATE normal server policy producer. The release factory, not an HTTP
// body, supplies the independently admitted node origin/SPKI/network binding.
// Native authoritative producer source8199 contract only; NOT Comet AppHash,
// not a light client/BFT finality assertion and not global-device current.
import {fetchOriginalNativeAuthorization} from '../native/original-ide-auth-proof-dispatch.mjs';
import {parsePQAccountAuthorization,inspectPQAuthorizationView,assertPQAuthorizationCurrent} from './pq-wallet-policy.js';
import {canonicalJSON} from './canonical.js';
import {captureProductSessionAccountPolicy} from './product-session-account-policy.js';
const fail=c=>{throw Object.assign(Error(c),{code:c});};
const BASE=['owner','executionHeight','ledgerNonce','algorithmVersion','enabled','records'];
const META=['policyView','source','recordsView','committedHeight','committedBlockHash','committedAlgorithmVersion','checkpointStatus','checkpointIntegrity','recordsComplete','authorizationStatus','pqSigningEnabled','committedAuthorizationStatus','committedPQSigningEnabled','globalPolicyVersion','revocations'];
// Pure projection DATA is exported for bounded fixtures; it never registers a
// policy WeakMap capability and cannot be passed as an original Source owner.
export function inspectNativeCommittedProductPolicyV4Data(raw,expected,observedAtMs,expiresAtMs){
 const v=JSON.parse(raw),fields=[...BASE,...META,'policyVersion','networkId','enableAt','activeRevision','committedActiveRevision'];
 if(!v||Reflect.ownKeys(v).sort().join('|')!==fields.sort().join('|')||v.enabled!==true||v.algorithmVersion!=='YNX-BATCH/v0.1'||v.source!=='authoritative_producer'||v.policyView!=='next_execution'||v.recordsView!=='includes_pending'||v.recordsComplete!==true||v.checkpointStatus!=='durable'||typeof v.checkpointIntegrity!=='string'||!/^[a-f0-9]{64}$/.test(v.checkpointIntegrity)||!/^[a-f0-9]{64}$/.test(v.committedBlockHash)||!Array.isArray(v.revocations)||v.authorizationStatus!=='active'||v.committedAuthorizationStatus!=='active'||v.pqSigningEnabled!==true||v.committedPQSigningEnabled!==true||v.committedAlgorithmVersion!=='YNX-BATCH/v0.1'||!['YNX-ACCOUNT-POLICY/v1','YNX-ACCOUNT-POLICY/v2'].includes(v.globalPolicyVersion))fail('PAIR_V4_COMMITTED_NODE_REQUIRED');
 if(typeof v.committedHeight!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v.committedHeight)||BigInt(v.committedHeight)>=(1n<<64n)-1n||BigInt(v.executionHeight)!==BigInt(v.committedHeight)+1n)fail('PAIR_V4_COMMITTED_HEIGHT');
 const keys=[...BASE,'policyVersion','networkId','enableAt','activeRevision',...(v.policyVersion==='YNX-ACCOUNT-POLICY/v2'?['revocations']:[])],projection=Object.fromEntries(keys.map(k=>[k,v[k]]));
 if(v.policyVersion==='YNX-ACCOUNT-POLICY/v1'&&v.revocations.length)fail('PAIR_V4_REVOCATION_PROJECTION');
 const snapshot=parsePQAccountAuthorization(projection,expected),committed=inspectPQAuthorizationView(snapshot,v.committedHeight),next=inspectPQAuthorizationView(snapshot);
 if(!committed.pqSigningEnabled||!next.pqSigningEnabled||committed.authorizationStatus!=='active'||next.authorizationStatus!=='active'||!committed.activeRecord||canonicalJSON(committed.activeRecord)!==canonicalJSON(next.activeRecord)||committed.activeRecord.revision!==v.committedActiveRevision||v.activeRevision!==v.committedActiveRevision)fail('PAIR_V4_COMMITTED_RECORD_CHANGED');
 if(!Number.isSafeInteger(observedAtMs)||!Number.isSafeInteger(expiresAtMs)||observedAtMs<0||expiresAtMs<=observedAtMs||expiresAtMs-observedAtMs>5000)fail('PAIR_V4_POLICY_WINDOW');
 const {revision,registeredAt,activeFrom,pkA,pkB}=committed.activeRecord;
 const original=Object.freeze({version:'YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1',networkId:expected.chainId,canonicalOwner:expected.owner,checkpoint:Object.freeze({kind:'trusted-node-committed/v1',height:v.committedHeight,blockHash:v.committedBlockHash}),policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',activeRecord:Object.freeze({revision,registeredAt,activeFrom,pkA,pkB}),observedAt:new Date(observedAtMs).toISOString(),expiresAt:new Date(expiresAtMs).toISOString()});
 // Complete owner records/revocations remain retained for recheck; a subset
 // is never sent back into persistence or represented as a global registry.
 return Object.freeze({original,snapshot,nodeOriginal:canonicalJSON(v),dataOnly:true,authority:false,consensusFinality:false});
}
export async function acquireOriginalNativeCommittedProductPolicyV4(node,expected,account){
 const start=Date.now(),expires=start+5000;let current,closed=false,retired=false,floor=start;
 const now=()=>{const n=Date.now();if(!Number.isSafeInteger(n)||n<floor||n>=expires)fail('PAIR_V4_POLICY_EXPIRED');floor=n;return n;};
 // The only getter here is the existing typed pinned HTTPS implementation.
 const fetch=async()=>{now();const v=await fetchOriginalNativeAuthorization(node,expected.owner);now();return inspectNativeCommittedProductPolicyV4Data(canonicalJSON(v),expected,start,expires);};
 const first=await fetch();current=first;
 const resource=Object.freeze({
  readOriginal(){this.assertCurrent();return first.original;},
  assertCurrent(){if(closed||retired)fail('PAIR_V4_POLICY_RETIRED');now();if(current.nodeOriginal!==first.nodeOriginal)fail('PAIR_V4_POLICY_CHANGED');},
  async recheck(){this.assertCurrent();const after=await fetch();assertPQAuthorizationCurrent(first.snapshot,after.snapshot);if(after.nodeOriginal!==first.nodeOriginal)fail('PAIR_V4_POLICY_CHANGED');current=after;this.assertCurrent();},
  retire(){retired=true;},join(){if(!retired)fail('PAIR_V4_POLICY_JOIN');},close(){retired=true;closed=true;}
 });
 try{await resource.recheck();const policyRef=captureProductSessionAccountPolicy(resource,{networkId:expected.chainId,account},new Date(now()));return Object.freeze({resource,policyRef,expiresAtMs:expires});}
 catch(e){resource.retire();resource.close();throw e;}
}
