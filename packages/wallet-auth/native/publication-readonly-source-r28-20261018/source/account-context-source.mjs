// Normal Auth Host glue only. Uses the original SDK engine and fixed R13 source.
// This module starts no server and owns no replacement session store.
import {types} from 'node:util';
import {WalletAuthError,canonicalJSON,parseProductSessionRegistry,evmAddressFromYNX,decodeWalletSessionControlProofHeader,verifyWalletSessionControlProof,httpBodyDigest} from '@ynx-chain/wallet-auth';
import {captureProductSessionAccountPolicy,readProductSessionAccountPolicy} from '@ynx-chain/wallet-auth/product-session-account-policy';
import {verifyPQProductSessionApproval,verifyPQProductSessionPublicationApproval} from '@ynx-chain/wallet-auth/product-session-pq-approval';
import {acquireOriginalAccountPolicy,isOriginalAccountPolicyResource} from './policy-supplier/session-resource.mjs';
import {CANONICAL_NETWORK_ID} from './policy-supplier/operator-query.mjs';
const owners=new WeakSet(),fail=code=>{throw new WalletAuthError(code,code);};
const wrapped=(code,cause)=>{const value=new WalletAuthError(cause instanceof WalletAuthError?cause.code:code,cause instanceof WalletAuthError?cause.message:code);Object.defineProperty(value,'cause',{value:cause});return value;};
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
function captureInput(v){
 if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('AUTH_HOST_POLICY_INPUT');
 const fields=['account','operation','request','approval'],ds=Object.getOwnPropertyDescriptors(v);
 if(Reflect.ownKeys(ds).some(k=>typeof k!=='string')||Object.keys(ds).sort().join('|')!==fields.sort().join('|')||Object.values(ds).some(d=>!d.enumerable||!Object.hasOwn(d,'value')))fail('AUTH_HOST_POLICY_INPUT');
 if(typeof v.account!=='string'||!['approval','challenge','completion','introspection','revalidation','publication-revalidation'].includes(v.operation))fail('AUTH_HOST_POLICY_INPUT');evmAddressFromYNX(v.account);
 const write=['approval','challenge','completion','publication-revalidation'].includes(v.operation);
 if(write&&(!v.request||!v.approval||v.approval.account!==v.account))fail('AUTH_HOST_POLICY_APPROVAL_REQUIRED');
 if(!write&&(v.request!==null||v.approval!==null))fail('AUTH_HOST_POLICY_READ_INPUT');
 const raw=canonicalJSON(v);if(Buffer.byteLength(raw)>1048576)fail('AUTH_HOST_POLICY_INPUT_SIZE');return freeze(JSON.parse(raw));
}
function dataPartial(error){
 if(!error||typeof error!=='object'||types.isProxy(error))return null;
 const d=Object.getOwnPropertyDescriptor(error,'partial');return d&&Object.hasOwn(d,'value')?d.value:null;
}
class ContextOwner{
 #registry;#input;#resource;#observation;#context;#entered=false;#pending=new Set();#retired=false;#checking=false;#unknown=false;#first;#hasFirst=false;#retireSelected=false;#retireFailed=false;#retireCause;#joining;#closing;#cleanup;#cleanupFailed=false;
 constructor(registry,input){this.#registry=registry;this.#input=input;}
 #remember(e){if(!this.#hasFirst){this.#first=e;this.#hasFirst=true;}this.#unknown=true;this.#retired=true;}
 #live(){if(this.#retired)throw this.#hasFirst?this.#first:Error('AUTH_HOST_POLICY_RETIRED');}
 #track(p){this.#pending.add(p);void p.then(()=>this.#pending.delete(p),()=>this.#pending.delete(p));return p;}
 async initialize(){
  if(this.#entered)fail('AUTH_HOST_POLICY_ALREADY_ENTERED');this.#entered=true;
  const p=Promise.resolve().then(async()=>{
   this.#live();const {account,operation,request,approval}=this.#input;
   try{this.#resource=await acquireOriginalAccountPolicy({networkId:CANONICAL_NETWORK_ID,owner:evmAddressFromYNX(account),operation:operation==='publication-revalidation'?'revalidation':operation,at:new Date().toISOString()});}
   catch(error){this.#resource=dataPartial(error);throw error;}
   // Retain before predicates/current calls, including unrecognized partials.
   this.#live();if(!isOriginalAccountPolicyResource(this.#resource))fail('AUTH_HOST_POLICY_ORIGINAL_REQUIRED');
   this.#resource.assertCurrent();this.#observation=captureProductSessionAccountPolicy(this.#resource,{networkId:CANONICAL_NETWORK_ID,account},new Date());
   const view=readProductSessionAccountPolicy(this.#observation,account,new Date());let verifiedApproval=null;
   if(['approval','challenge','completion'].includes(operation)){
    if(view.algorithmVersion==='YNX-BATCH/v0.1'){
     if(approval.version!=='3')fail('ACTIVE_PQ_CLASSIC_SESSION_REFUSED');
     const verified=verifyPQProductSessionApproval(this.#registry,request,approval,this.#observation,new Date());verifiedApproval=verified.verifiedApproval;
    }else if(approval.version==='3')fail('AUTH_HOST_POLICY_ACCOUNT_CHANGED');
    // Legacy V2 proof verification remains in the original Authority, not here.
   }
   if(operation==='publication-revalidation'){
    if(view.algorithmVersion!=='YNX-BATCH/v0.1'||approval.version!=='3')fail('AUTH_HOST_PUBLICATION_PQ_REQUIRED');
    // Pure proof check, not liveApproval/issue/completion capability. Signed
    // approval time and fresh Source time are distinct in the original SDK.
    verifyPQProductSessionPublicationApproval(this.#registry,request,approval,this.#observation,new Date());
   }
   this.#context=Object.freeze({observation:this.#observation,verifiedApproval,required:true});
   await this.#resource.recheck();this.assertCurrent();return undefined;
  });try{return await this.#track(p);}catch(error){this.#remember(error);throw error;}
 }
 assertCurrent(){try{this.#live();if(!this.#context||!this.#resource)fail('AUTH_HOST_POLICY_CONTEXT_NOT_READY');this.#resource.assertCurrent();readProductSessionAccountPolicy(this.#observation,this.#input.account,new Date());return undefined;}catch(error){this.#remember(error);throw error;}}
 readContext(){this.assertCurrent();return this.#context;}
 async recheck(){
  this.assertCurrent();if(this.#checking)fail('AUTH_HOST_POLICY_RECHECK_PENDING');this.#checking=true;
  const p=Promise.resolve().then(async()=>{this.assertCurrent();await this.#resource.recheck();this.assertCurrent();return undefined;});
  try{return await this.#track(p);}catch(error){this.#remember(error);throw error;}finally{this.#checking=false;}
 }
 retire(){this.#retired=true;if(!this.#resource)return undefined;if(this.#retireSelected){if(this.#retireFailed)throw this.#retireCause;return undefined;}this.#retireSelected=true;try{if(this.#resource.retire()!==undefined)fail('AUTH_HOST_POLICY_RETIRE_UNKNOWN');return undefined;}catch(error){this.#retireFailed=true;this.#retireCause=error;this.#remember(error);throw error;}}
 join(){if(!this.#retired)fail('AUTH_HOST_POLICY_RETIRE_REQUIRED');if(!this.#joining){this.#joining=Promise.resolve().then(async()=>{await Promise.allSettled([...this.#pending]);if(this.#resource&&await this.#resource.join()!==undefined)fail('AUTH_HOST_POLICY_JOIN_UNKNOWN');}).catch(error=>{this.#remember(error);throw error;});void this.#joining.catch(()=>{});}return this.#joining;}
 close(){if(this.#closing)return this.#closing;this.#retired=true;this.#closing=Promise.resolve().then(async()=>{
  let failed=false,first,joined=false;const attempt=async fn=>{try{if(await fn()!==undefined)fail('AUTH_HOST_POLICY_CLEANUP_UNKNOWN');}catch(error){if(!failed){failed=true;first=error;}}};
  await attempt(()=>this.retire());await attempt(async()=>{await this.join();joined=true;});if(joined&&this.#resource)await attempt(()=>this.#resource.close());
  if(failed){this.#cleanupFailed=true;this.#cleanup=first;this.#remember(first);throw first;}return undefined;
 });void this.#closing.catch(()=>{});return this.#closing;}
 outcome(){return Object.freeze({context:this.#context??null,resource:this.#resource??null,resourceOutcome:this.#resource?.outcome?.()??null,unknown:this.#unknown,firstCausePresent:this.#hasFirst,firstCause:this.#first,cleanupFailed:this.#cleanupFailed,cleanupCause:this.#cleanup});}
}
// Bootstrap receives the existing normal registry, not a per-request registry
// or a user-selected required flag. Returns no global account resolver/context.
export function createOriginalProductSessionAccountContextSource(registryInput){
 const registry=parseProductSessionRegistry(JSON.parse(canonicalJSON(registryInput)));
 return Object.freeze({async acquire(input){
  const original=captureInput(input),owner=new ContextOwner(registry,original);owners.add(owner);
  try{await owner.initialize();owner.assertCurrent();return owner;}
  catch(cause){const error=wrapped('AUTH_HOST_ACCOUNT_CONTEXT_NOT_SUPPLIED',cause);Object.defineProperty(error,'partial',{value:owner});throw error;}
 }});
}
export function isOriginalProductSessionAccountContextOwner(owner){return owners.has(owner);}

const normalRuns=new WeakMap();
function operationInput(operation){
 if(!operation||types.isProxy(operation)||Object.getPrototypeOf(operation)!==Object.prototype)fail('AUTH_HOST_POLICY_OPERATION');
 const referenceRoutes=['/v2/product-sessions/returns','/v2/product-sessions/returns/challenge','/v2/product-sessions/returns/complete','/v2/product-sessions/returns/outcome'];
 const pathDescriptor=Object.getOwnPropertyDescriptor(operation,'path');
 const reference=!!pathDescriptor&&Object.hasOwn(pathDescriptor,'value')&&referenceRoutes.includes(pathDescriptor.value);
 const fields=['requestId','method','path','body','proofHeader','walletControlProofHeader','session','at',...(reference?['publication']:[])];
 const ds=Object.getOwnPropertyDescriptors(operation);
 if(Reflect.ownKeys(ds).some(k=>typeof k!=='string')||Object.keys(ds).sort().join('|')!==fields.sort().join('|')||Object.values(ds).some(d=>!d.enumerable||!Object.hasOwn(d,'value')))fail('AUTH_HOST_POLICY_OPERATION');
 if(typeof operation.requestId!=='string'||! /^[A-Za-z0-9._:-]{8,128}$/.test(operation.requestId)||operation.method!=='POST'||typeof operation.body!=='string'||Buffer.byteLength(operation.body)>1048576||typeof operation.at!=='string'||!Number.isFinite(Date.parse(operation.at))||new Date(operation.at).toISOString()!==operation.at)fail('AUTH_HOST_POLICY_OPERATION');
 let body;try{body=JSON.parse(operation.body);}catch{fail('AUTH_HOST_POLICY_BODY');}
 const base='/v2/product-sessions/';
 if(reference){
  if(operation.proofHeader!==null||operation.walletControlProofHeader!==null)fail('AUTH_HOST_REFERENCE_PROOF_CONTEXT');
  if(operation.path===base+'returns'){
   if(operation.publication!==null||operation.session!==null)fail('AUTH_HOST_REFERENCE_PUBLICATION');
   return {account:body?.approval?.account,operation:'challenge',request:body?.request,approval:body?.approval};
  }
  if(operation.path===base+'returns/outcome'&&body?.selector==='YNX-PRODUCT-SESSION-PUBLICATION/v1'){
   if(Object.keys(body).sort().join('|')!==['selector','publicationRequestId','request','approval'].sort().join('|')||typeof body.publicationRequestId!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(body.publicationRequestId))fail('AUTH_HOST_PUBLICATION_SELECTOR');
   const p=operation.publication;
   if(p===null){
    if(operation.session!==null)fail('AUTH_HOST_REFERENCE_STORED_SESSION');
   }else{
    if(!p||types.isProxy(p)||Object.getPrototypeOf(p)!==Object.prototype)fail('AUTH_HOST_REFERENCE_PUBLICATION');
    const pd=Object.getOwnPropertyDescriptors(p);
    if(Reflect.ownKeys(pd).length!==3||['requestRaw','approvalRaw','completed'].some(k=>!pd[k]?.enumerable||!Object.hasOwn(pd[k],'value'))||typeof pd.requestRaw.value!=='string'||typeof pd.approvalRaw.value!=='string'||typeof pd.completed.value!=='boolean')fail('AUTH_HOST_REFERENCE_PUBLICATION');
    let request,approval;try{request=JSON.parse(pd.requestRaw.value);approval=JSON.parse(pd.approvalRaw.value);}catch{fail('AUTH_HOST_REFERENCE_PUBLICATION');}
    if(canonicalJSON(request)!==pd.requestRaw.value||canonicalJSON(approval)!==pd.approvalRaw.value||canonicalJSON(body.request)!==pd.requestRaw.value||canonicalJSON(body.approval)!==pd.approvalRaw.value)fail('AUTH_HOST_REFERENCE_BINDING');
    if(pd.completed.value&&(!operation.session||operation.session.account!==approval?.account))fail('AUTH_HOST_REFERENCE_STORED_SESSION');
    if(!pd.completed.value&&operation.session!==null)fail('AUTH_HOST_REFERENCE_STORED_SESSION');
   }
   // Even not_found requires the exact signed pair and fresh account Source.
   // Neither the self-reported account nor publication projection is a grant.
   return {account:body.approval?.account,operation:'publication-revalidation',request:body.request,approval:body.approval};
  }
  const p=operation.publication;
  if(!p||types.isProxy(p)||Object.getPrototypeOf(p)!==Object.prototype)fail('AUTH_HOST_REFERENCE_PUBLICATION');
  const pd=Object.getOwnPropertyDescriptors(p);
  if(Reflect.ownKeys(pd).length!==3||['requestRaw','approvalRaw','completed'].some(k=>!pd[k]?.enumerable||!Object.hasOwn(pd[k],'value'))||typeof pd.requestRaw.value!=='string'||typeof pd.approvalRaw.value!=='string'||typeof pd.completed.value!=='boolean')fail('AUTH_HOST_REFERENCE_PUBLICATION');
  let request,approval;try{request=JSON.parse(pd.requestRaw.value);approval=JSON.parse(pd.approvalRaw.value);}catch{fail('AUTH_HOST_REFERENCE_PUBLICATION');}
  if(canonicalJSON(request)!==pd.requestRaw.value||canonicalJSON(approval)!==pd.approvalRaw.value||canonicalJSON(body?.request)!==pd.requestRaw.value)fail('AUTH_HOST_REFERENCE_BINDING');
  // Pending data is a locator, never a credential. The original Host alone
  // checks reference/expiry/device proof and consumes the original nonce.
  if(operation.path===base+'returns/challenge'||operation.path===base+'returns/outcome'||pd.completed.value){
   if(pd.completed.value&&(!operation.session||operation.session.account!==approval?.account))fail('AUTH_HOST_REFERENCE_STORED_SESSION');
   if(!pd.completed.value&&operation.session!==null)fail('AUTH_HOST_REFERENCE_STORED_SESSION');
   return {account:approval?.account,operation:'revalidation',request:null,approval:null};
  }
  if(operation.session!==null)fail('AUTH_HOST_REFERENCE_STORED_SESSION');
  return {account:approval?.account,operation:'completion',request,approval};
 }
 if(operation.path===base+'challenge'||operation.path===base+'complete')return {account:body?.approval?.account,operation:operation.path.endsWith('/complete')?'completion':'challenge',request:body?.request,approval:body?.approval};
 if(![base+'introspect',base+'revoke',base+'devices/revoke',base+'wallet/sessions',base+'wallet/sessions/revoke'].includes(operation.path))fail('AUTH_HOST_POLICY_ROUTE_NOT_SUPPORTED');
 // These are association hints only. Original SDK still verifies the stored
 // subject, device/control proof, origin, scope and revocation authorization.
 let account=operation.session?.account;
 if(operation.path===base+'wallet/sessions'||operation.path===base+'wallet/sessions/revoke'){
  const proof=decodeWalletSessionControlProofHeader(operation.walletControlProofHeader);
  account=verifyWalletSessionControlProof(proof,{method:operation.method,path:operation.path,bodyDigest:httpBodyDigest(canonicalJSON(body))},new Date()).account;
 }
 if(typeof account!=='string')fail('AUTH_HOST_POLICY_SUBJECT_NOT_SUPPLIED');
 return {account,operation:operation.path.endsWith('/introspect')?'introspection':'revalidation',request:null,approval:null};
}
export function createOriginalNodeHostAccountPolicy(registryInput){
 const source=createOriginalProductSessionAccountContextSource(registryInput),cleanupDebt=new Set(),failures=new Map();let lastPreEffectRefusal=null;
 const config=Object.freeze({mode:'required',async run(operation,execute){
  if(cleanupDebt.size)fail('AUTH_HOST_POLICY_CLEANUP_UNRESOLVED');if(typeof execute!=='function')fail('AUTH_HOST_POLICY_EXECUTE_REQUIRED');
  const input=operationInput(operation);let owner,entered=false,failed=false,first,cleanupFailed=false,cleanup;
  try{
   try{owner=await source.acquire(input);}catch(error){owner=dataPartial(error);throw error;}
   owner.assertCurrent();await owner.recheck();owner.assertCurrent();
   entered=true;if(execute(owner.readContext())!==undefined)fail('AUTH_HOST_POLICY_EXECUTE_RETURN');
   owner.assertCurrent();await owner.recheck();owner.assertCurrent();
  }catch(error){failed=true;first=error;}
  finally{
   if(owner){let joined=false;const attempt=async fn=>{try{if(await fn()!==undefined)fail('AUTH_HOST_POLICY_CLEANUP_UNKNOWN');}catch(error){if(!cleanupFailed){cleanupFailed=true;cleanup=error;}}};
    await attempt(()=>owner.retire());await attempt(async()=>{await owner.join();joined=true;});
    // close records the first close outcome itself; its implementation never
    // closes the underlying source after a failed join or retries a close.
    await attempt(()=>owner.close());if(!joined||cleanupFailed)cleanupDebt.add(owner);
   }
  }
  if(failed||cleanupFailed){
   const record=Object.freeze({requestId:operation.requestId,method:operation.method,path:operation.path,owner:owner??null,originalTransactionEntered:entered,firstCause:failed?first:cleanup,cleanupCause:cleanupFailed?cleanup:null});
   const key=operation.method+':'+operation.path+':'+operation.requestId;
   if(entered||cleanupFailed){if(!failures.has(key))failures.set(key,record);}else lastPreEffectRefusal=record;
   const error=wrapped('AUTH_HOST_POLICY_TRANSACTION_REFUSED',failed?first:cleanup);
   Object.defineProperties(error,{partial:{value:owner??null},originalTransactionEntered:{value:entered},cleanupCause:{value:cleanupFailed?cleanup:null}});throw error;
  }
  return undefined; // Only SDK owns/captures/persists the real result.
 }});
 normalRuns.set(config,()=>Object.freeze({unresolvedCleanup:cleanupDebt.size,owners:Object.freeze([...cleanupDebt]),failures:Object.freeze([...failures.values()]),lastPreEffectRefusal}));return config;
}
export function originalNodeHostAccountPolicyOutcome(config){const read=normalRuns.get(config);if(!read)fail('AUTH_HOST_POLICY_CONFIG_REQUIRED');return read();}
