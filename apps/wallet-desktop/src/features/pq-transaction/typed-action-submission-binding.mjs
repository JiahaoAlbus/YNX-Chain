import {types} from 'node:util';
import {parsePQAccountAuthorization} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {parsePQTypedOriginalRecord} from '../../wallet-pq-typed-original.mjs';
import {preparePQTransferOriginal} from './transfer-binding.mjs';
import {inspectPQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import {preparePQReviewedTypedActionBroadcast} from './typed-action-broadcast.mjs';

const code='PQ_TRANSACTION_PERMISSION_BINDING',fail=(value=code)=>{throw Object.assign(Error(value),{code:value})};
const fields=['action','purpose','memberCount','memberIndex','networkId','nativeChainId','account','operationId','origin','typedAction','requestDigest','policyRevision','pair','reviewExecutionHeight','executionHeight','expiresAt','transportHash','memberHash'];
function exact(value,keys){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
 const ds=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(ds);
 if(actual.length!==keys.length||actual.some(k=>!keys.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail();
}
function sameFrozen(actual,expected){
 if(expected===null||typeof expected!=='object'){if(!Object.is(actual,expected))fail();return;}
 if(!actual||types.isProxy(actual)||!Object.isFrozen(actual)||Object.getPrototypeOf(actual)!==Object.getPrototypeOf(expected))fail();
 const a=Object.getOwnPropertyDescriptors(actual),b=Object.getOwnPropertyDescriptors(expected),keys=Reflect.ownKeys(b);
 if(Reflect.ownKeys(a).length!==keys.length)fail();
 for(const k of keys){if(!Object.hasOwn(a,k)||!Object.hasOwn(a[k],'value')||!Object.hasOwn(b[k],'value')||a[k].enumerable!==b[k].enumerable)fail();sameFrozen(a[k].value,b[k].value);}
}
const time=value=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail();return Date.parse(value)};
const height=value=>{if(typeof value!=='string'||! /^[1-9][0-9]{0,19}$/.test(value)||BigInt(value)>18446744073709551615n)fail();return BigInt(value)};

/** Original Main custody adapter. Main owns the typed record parser and the
 * 18-field request builder. This only verifies their retained DATA before the
 * existing controller asks the real Auth resource for a separate approval. */
export async function readPQSubmissionOriginal(store,hash,{account,networkId,guard}){
 if(typeof hash!=='string'||! /^0x[0-9a-f]{64}$/.test(hash)||guard?.account!==account||typeof guard?.assert!=='function')fail('PQ_TRANSACTION_ORIGINAL_BINDING');
 guard.assert();const rows=await store.readPQOriginals(account,()=>guard.assert());guard.assert();
 const value=rows.find(row=>row.account===account&&row.hash===hash);if(!value)fail('TRANSACTION_INTENT_REQUIRED');
 if(value.kind!=='pq-typed-action')return preparePQTransferOriginal(value,{account,networkId});
 const saved=parsePQTypedOriginalRecord(value),t=saved.typed;
 if(saved.account!==account||t.networkId!==networkId)fail('PQ_TRANSACTION_ORIGINAL_BINDING');
 const network={owner:account,chainId:networkId,nativeChainId:'6423'},raw=Buffer.from(saved.wire,'base64url');
 const original={reviewSnapshot:parsePQAccountAuthorization(t.reviewSnapshot,network),signingSnapshot:parsePQAccountAuthorization(t.signingSnapshot,network),selectedBinding:{account,networkId},memberHash:t.memberHash,transportHash:saved.hash};
 const local=inspectPQReviewedTypedTransportOriginal(t.review,raw,original);
 return Object.freeze({original:saved,binding:Object.freeze({account,hash:saved.hash,kind:saved.kind,operationId:saved.operationId}),typed:Object.freeze({review:t.review,raw,original,local})});
}

export function bindPQTypedBroadcastRequest(plan,request){
 if(!request)fail('PQ_TRANSACTION_TYPED_REVIEW_REQUIRED');
 exact(request,fields);if(!Object.isFrozen(request))fail();
 const local=plan.typed.local,expected={action:'broadcast',purpose:'TX-BATCH',memberCount:1,memberIndex:0,networkId:local.networkId,nativeChainId:'6423',account:local.account,operationId:local.operationId,origin:'ynx-wallet:local-pq',typedAction:local.action,requestDigest:local.requestDigest,policyRevision:local.policyRevision,pair:local.pair,reviewExecutionHeight:local.reviewExecutionHeight,transportHash:local.transportHash,memberHash:local.memberHash};
 for(const key of Object.keys(expected))sameFrozen(request[key],expected[key]);
 const now=Date.now(),expires=time(request.expiresAt);
 if(expires<=now||expires>now+30000||height(request.executionHeight)<height(local.executionHeight))fail();
 // Apply the actual producer profile and complete-material fence before any
 // permission acquisition, marker or I/O; never trim the original transport.
 preparePQReviewedTypedActionBroadcast(plan.typed.review,plan.typed.raw,plan.typed.original);
 return request;
}

/** Auth's typed broadcast binding is the exact request plus issuedAt. Its
 * private capsule may shorten expiresAt; it may not extend or retarget it. */
export function assertPQTypedBroadcastPermission(resource,request,prior=null){
 const actual=resource.readOriginal();exact(actual,[...fields,'issuedAt']);
 if(!Object.isFrozen(actual)||prior&&actual!==prior)fail();
 for(const key of fields)if(key!=='expiresAt')sameFrozen(actual[key],request[key]);
 const now=Date.now(),issued=time(actual.issuedAt),expires=time(actual.expiresAt);
 if(issued>now||expires<=now||issued>=expires||expires>time(request.expiresAt))fail();
 return actual;
}
