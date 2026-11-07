// PRIVATE Auth policy, not a public WIRE/schema or a second authority store.
// A directly constructed kernel is a PUBLIC integration test boundary. Only a
// later original release-selected Source factory may expose it to real callers.
import {types} from 'node:util';
import {createHash} from 'node:crypto';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const MAX=1048576,U64=18446744073709551615n;
function capture(value,depth=0,budget={n:0}){
 if(depth>16)fail('GRANT_BOUNDS');
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='string'){budget.n+=Buffer.byteLength(value);if(budget.n>MAX)fail('GRANT_BOUNDS');return value;}
 if(!value||typeof value!=='object'||types.isProxy(value))fail('GRANT_DATA_REQUIRED');
 if(Array.isArray(value)){
  if(value.length>1024||Reflect.ownKeys(value).length!==value.length+1)fail('GRANT_BOUNDS');
  return Object.freeze(Array.from({length:value.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!Object.hasOwn(d,'value'))fail('GRANT_DATA_REQUIRED');return capture(d.value,depth+1,budget);}));
 }
 if(Object.getPrototypeOf(value)!==Object.prototype)fail('GRANT_DATA_REQUIRED');
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);if(keys.length>128||keys.some(k=>typeof k!=='string'))fail('GRANT_BOUNDS');
 const result={};for(const k of keys.sort()){const d=ds[k];if(!Object.hasOwn(d,'value')||['__proto__','prototype','constructor'].includes(k))fail('GRANT_DATA_REQUIRED');budget.n+=Buffer.byteLength(k);result[k]=capture(d.value,depth+1,budget);}return Object.freeze(result);
}
function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Reflect.ownKeys(v).sort().join('|')!==keys.slice().sort().join('|'))fail('GRANT_SCHEMA');}
function id(v){if(typeof v!=='string'||!/^[A-Za-z0-9._:/-]{1,256}$/.test(v)||v.includes('*'))fail('GRANT_ID');return v;}
function u(v){if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>U64)fail('GRANT_UINT');return BigInt(v);}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b); // Private DATA equality, never signature encoding.
function ref(v){exact(v,['realm','tenant','kind','id','rev']);for(const k of['realm','tenant','kind','id'])id(v[k]);u(v.rev);return v;}
function bind(v){exact(v,['bytes','sha3_512','sha512']);u(v.bytes);if(typeof v.sha3_512!=='string'||typeof v.sha512!=='string'||!/^[a-f0-9]{128}$/.test(v.sha3_512)||!/^[a-f0-9]{128}$/.test(v.sha512))fail('GRANT_BINDING');return v;}
function sink(v){exact(v,['service','tenant','origin','path','region','operation']);for(const k of Object.keys(v))id(v[k]);return v;}
function source(v){exact(v,['ref','fields','label','binding']);ref(v.ref);bind(v.binding);if(!Array.isArray(v.fields)||!v.fields.length||new Set(v.fields).size!==v.fields.length||v.fields.some(x=>typeof x!=='string'||!x||x.length>128)||!['PUBLIC','TENANT','RESTRICTED','VAULT'].includes(v.label))fail('GRANT_SOURCE');return v;}
function taskBinding(v){
 exact(v,['task','generation','stepId','input','tool','target','purpose','risk','holderSession','sources']);ref(v.task);u(v.generation);id(v.stepId);bind(v.input);sink(v.target);id(v.purpose);
 exact(v.tool,['id','version','schema']);id(v.tool.id);u(v.tool.version);bind(v.tool.schema);
 exact(v.holderSession,['id','epoch','channel']);id(v.holderSession.id);u(v.holderSession.epoch);id(v.holderSession.channel);
 if(!['read','write','asset'].includes(v.risk)||!Array.isArray(v.sources)||v.sources.length>1024)fail('GRANT_SCHEMA');for(const s of v.sources)source(s);
 const keys=v.sources.map(s=>JSON.stringify(s.ref));if(new Set(keys).size!==keys.length)fail('GRANT_SOURCE_DUPLICATE');return v;
}
function grant(v){
 exact(v,['version','id','realm','tenant','issuer','issuerEpoch','holder','holderEpoch','audience','operation','resources','cap','singleMax','validFrom','expires','nonce','rev','nonDelegable','approvalId','binding']);
 if(v.version!=='AUTH-BOUND-GRANT-PRIVATE/v1'||v.nonDelegable!==true)fail('GRANT_NONDELEGABLE');
 for(const k of['id','realm','tenant','audience','operation','nonce','approvalId'])id(v[k]);ref(v.issuer);ref(v.holder);for(const k of['issuerEpoch','holderEpoch','cap','singleMax','validFrom','expires','rev'])u(v[k]);
 if(v.holder.kind!=='agent'||v.issuer.kind==='agent'||v.issuer.realm!==v.realm||v.holder.realm!==v.realm||v.issuer.tenant!==v.tenant||v.holder.tenant!==v.tenant||u(v.singleMax)>u(v.cap)||u(v.expires)<=u(v.validFrom))fail('GRANT_SCOPE');
 if(!Array.isArray(v.resources)||!v.resources.length||v.resources.length>1024)fail('GRANT_RESOURCES');for(const r of v.resources){ref(r);if(r.realm!==v.realm||r.tenant!==v.tenant)fail('GRANT_TENANT');}if(new Set(v.resources.map(r=>JSON.stringify(r))).size!==v.resources.length)fail('GRANT_RESOURCES');
 taskBinding(v.binding);if(v.binding.task.realm!==v.realm||v.binding.task.tenant!==v.tenant||v.binding.target.tenant!==v.tenant||v.binding.target.service!==v.audience)fail('GRANT_TENANT');return v;
}
function byteCopy(value){const proto=Object.getPrototypeOf(Uint8Array.prototype),getLength=Object.getOwnPropertyDescriptor(proto,'byteLength').get,getBuffer=Object.getOwnPropertyDescriptor(proto,'buffer').get;let n,b;try{n=getLength.call(value);b=getBuffer.call(value);}catch{fail('GRANT_BYTES');}if(!(value instanceof Uint8Array)||n<1||n>MAX||types.isProxy(value)||typeof SharedArrayBuffer!=='undefined'&&b instanceof SharedArrayBuffer)fail('GRANT_BYTES');const copy=new Uint8Array(n);Uint8Array.prototype.set.call(copy,value);return copy;}
function bytesBinding(bytes){return Object.freeze({bytes:String(bytes.length),sha3_512:createHash('sha3-512').update(bytes).digest('hex'),sha512:createHash('sha512').update(bytes).digest('hex')});}
function approval(v){exact(v,['id','principal','principalKind','purpose','grantId','grantRevision','binding','expires','nonce']);ref(v.principal);bind(v.binding);for(const k of['id','purpose','grantId','nonce'])id(v[k]);u(v.grantRevision);u(v.expires);if(!['human','organization'].includes(v.principalKind)||v.principal.kind!==v.principalKind||v.purpose!=='AUTH-GRANT-ISSUE')fail('GRANT_APPROVAL_ROLE');return v;}
function method(v,name){if(!v||types.isProxy(v)||typeof v[name]!=='function')fail('GRANT_CALLEE_UNAVAILABLE');return v[name].bind(v);}
async function checked(v,name,...args){const out=await method(v,name)(...args);if(out!==undefined)fail('GRANT_VERIFIER_RESULT');}
function time(snapshot,at){u(snapshot.observedAt);u(snapshot.expires);if(u(snapshot.observedAt)>at||at>=u(snapshot.expires))fail('GRANT_SOURCE_EXPIRED');}
function validateCurrent(g,c,at,{effect=false}={}){
 time(c,at);if(!c.issuer||!c.holder||!c.task||!c.catalog||!c.session)fail('GRANT_CURRENT_REQUIRED');
 if(c.issuer.status!=='active'||c.issuer.registered!==true||!['human','organization','service'].includes(c.issuer.kind)||!equal(c.issuer.ref,g.issuer)||c.issuer.epoch!==g.issuerEpoch)fail('GRANT_ISSUER_NOT_TRUSTED');
 if(c.holder.status!=='active'||!equal(c.holder.ref,g.holder)||c.holder.epoch!==g.holderEpoch)fail('GRANT_HOLDER_EPOCH');
 if(at<u(g.validFrom)||at>=u(g.expires))fail('GRANT_EXPIRED');
 if(!(effect?['READY','WORKING']:['READY','NEEDS_APPROVAL']).includes(c.task.status)||!equal(c.task.ref,g.binding.task)||c.task.generation!==g.binding.generation||!equal(c.task.holder,g.holder)||c.task.holderEpoch!==g.holderEpoch)fail('GRANT_TASK_STALE');
 if(c.session.status!=='active'||!equal(c.session.binding,g.binding.holderSession)||!equal(c.session.holder,g.holder)||c.session.holderEpoch!==g.holderEpoch)fail('GRANT_SESSION_STALE');
 if(c.catalog.status!=='active'||typeof c.catalog.egress!=='boolean'||c.catalog.id!==g.binding.tool.id||c.catalog.version!==g.binding.tool.version||!equal(c.catalog.schema,g.binding.tool.schema)||c.catalog.audience!==g.audience||c.catalog.operation!==g.operation||c.catalog.purpose!==g.binding.purpose||c.catalog.risk!==g.binding.risk)fail('GRANT_CATALOG_MISMATCH');
 if(c.catalog.risk==='asset'||g.operation==='wallet.approve')fail('GRANT_SEPARATE_ASSET_APPROVAL_REQUIRED');
 if(!Array.isArray(c.authorizedResources)||c.authorizedResources.length>1024||!g.resources.every(r=>c.authorizedResources.some(allowed=>equal(allowed,r))))fail('GRANT_RESOURCE_NOT_CONTROLLED');
 if(!equal(c.sources,g.binding.sources))fail('GRANT_SOURCES_CHANGED');
 for(const s of g.binding.sources){if(s.label==='VAULT')fail('GRANT_VAULT_DENIED');if(s.ref.realm!==g.realm||s.ref.tenant!==g.tenant||!g.resources.some(r=>equal(r,s.ref)))fail('GRANT_SOURCE_SCOPE');}
 u(c.policyRevision);if(effect){if(!c.grant||c.grant.status!=='active'||c.grant.rev!==g.rev||!equal(c.grant.value,g))fail('GRANT_REVOKED_OR_STALE');if(!c.budget||c.budget.status!=='ready'||u(c.budget.cap)!==u(g.cap)||u(c.budget.requested)>u(g.singleMax)||u(c.budget.spent)+u(c.budget.reserved)+u(c.budget.requested)>u(g.cap))fail('GRANT_BUDGET');}
}

/** Private policy tests/call orchestration. Source/codec/store arguments are
 * original protected internals, NOT a public caller-provider registration API.
 * No production entry is admitted by constructing this class. */
export class OriginalBoundGrantPolicyKernel {
 #source;#store;#codec;#clock;#floor=0n;#retired=false;#drains=new WeakMap();
 constructor(source,store,codec,clock=Date.now){this.#source=source;this.#store=store;this.#codec=codec;this.#clock=clock;}
 #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||n<0)fail('GRANT_CLOCK');const at=BigInt(n);if(at<this.#floor)fail('GRANT_CLOCK_ROLLBACK');this.#floor=at;return at;}
 #alive(){if(this.#retired)fail('GRANT_RETIRED');}
 async #current(held,g,effect){this.#alive();await checked(held,'assertCurrent');const c=capture(await method(held,'readCurrent')());validateCurrent(g,c,this.#now(),{effect});await checked(held,'assertCurrent');validateCurrent(g,c,this.#now(),{effect});return c;}
 #drain(held){if(this.#drains.has(held))return this.#drains.get(held);const promise=Promise.resolve().then(async()=>{let failure;for(const n of['retire','join','close'])try{await checked(held,n);}catch(cause){failure??={cause};}if(failure)throw failure.cause;});this.#drains.set(held,promise);return promise;}
 async signBoundGrant(input,issuerApproval,issuerProof){
  this.#alive();const g=grant(capture(input)),a=approval(capture(issuerApproval));let held,result,error,deadline=null;
  try{
   held=await method(this.#source,'acquireGrantIssuance')(g);const selected=await this.#current(held,g,false);const commitAuthority=method(held,'assertGrantAuthorityAtCommit');deadline=[u(g.expires),u(a.expires),u(selected.expires)].reduce((a,b)=>a<b?a:b);
   const recheck=async()=>{const current=await this.#current(held,g,false);if(current.policyRevision!==selected.policyRevision)fail('GRANT_POLICY_CHANGED');const end=u(current.expires);if(end<deadline)deadline=end;return current;};
   const terms=byteCopy(await method(this.#codec,'encodeBoundGrant')(g)),binding=bytesBinding(terms);
   if(a.id!==g.approvalId||a.grantId!==g.id||a.grantRevision!==g.rev||!equal(a.principal,g.issuer)||!equal(a.binding,binding)||this.#now()>=u(a.expires)||u(a.expires)>u(g.expires))fail('GRANT_APPROVAL_BINDING');
   await checked(held,'verifyIssuerApproval',a,terms);await checked(held,'verifyIssuerProof',issuerProof,terms);await recheck();
   const reserved=await method(this.#store,'reserveGrantIssuanceOnce')({grant:g,grantId:g.id,revision:g.rev,issuer:g.issuer,approvalNonce:a.nonce,binding,at:Number(this.#now())});
   if(!reserved||typeof reserved.recoveryOnly!=='boolean')fail('GRANT_RESERVATION_UNKNOWN');
   if(reserved.recoveryOnly)result=Object.freeze({original:reserved.original??null,recoveryOnly:true,newGrant:false,sourceAdmission:false});
   else{
    if(!reserved.ticket)fail('GRANT_FRESH_TICKET_REQUIRED');
    await recheck();if(this.#now()>=u(a.expires))fail('GRANT_APPROVAL_EXPIRED');
    const returned=await method(held,'signBoundGrant')(g);result=returned; // Adopt exact partial BEFORE status/current.
    if(!returned||typeof returned.errorPresent!=='boolean')fail('GRANT_SIGN_UNKNOWN');let signFailure=returned.errorPresent?{cause:returned.error}:null;
    try{if(returned.original)await method(this.#store,'captureSignedGrantOriginal')(reserved.ticket,returned.original,Number(this.#now()));}catch(cause){signFailure??={cause};}if(signFailure)throw signFailure.cause;
    if(!returned.original)fail('GRANT_SIGN_UNKNOWN');await checked(held,'verifyIssuedGrant',g,returned.original,terms);const current=await recheck();if(this.#now()>=u(a.expires))fail('GRANT_APPROVAL_EXPIRED');
    const original=await method(this.#store,'commitGrantIssuance')(reserved.ticket,{grant:g,original:returned.original,binding,expectedAuthority:{issuerEpoch:current.issuer.epoch,holderEpoch:current.holder.epoch,task:current.task.ref,generation:current.task.generation,session:current.session.binding,policyRevision:current.policyRevision}},{at:Number(this.#now()),assertCurrent:expected=>{this.#alive();if(this.#now()>=deadline)fail('GRANT_APPROVAL_EXPIRED');const r=commitAuthority(expected);if(r!==undefined)fail('GRANT_SYNC_COMMIT_AUTHORITY_REQUIRED');if(this.#now()>=deadline)fail('GRANT_APPROVAL_EXPIRED');}});result=Object.freeze({original,recoveryOnly:false,newGrant:true,sourceAdmission:false});
   }
  }catch(cause){error={cause};}
  if(held)try{await this.#drain(held);}catch(cause){error??={cause};}
  if(result?.newGrant===true)try{this.#alive();if(deadline===null||this.#now()>=deadline)fail('GRANT_POST_COMPLETION_EXPIRED');}catch(cause){error??={cause};}
  if(error)throw Object.assign(Error('GRANT_ISSUANCE_UNRESOLVED'),{code:'GRANT_ISSUANCE_UNRESOLVED',cause:error.cause,partial:result??null,recoverOnly:true});return result;
 }
 async authorizeAtEffect(grantInput,stepInput,holderProof,expectedRevision){
  this.#alive();const g=grant(capture(grantInput)),step=taskBinding(capture(stepInput));u(expectedRevision);if(expectedRevision!==g.rev||!equal(step,g.binding))fail('GRANT_EFFECT_BINDING');let held,result,error;
  try{
   held=await method(this.#source,'acquireGrantEffect')(g);const c=await this.#current(held,g,true),effectBytes=byteCopy(await method(this.#codec,'encodeGrantEffect')(g,step));
   await checked(held,'verifyGrantProof',g);await checked(held,'verifyHolderProof',holderProof,effectBytes);
   if(c.catalog.egress===true){await checked(held,'verifyDisclosureAtEffect',g,step);if(!c.disclosure||c.disclosure.status!=='active'||c.disclosure.grantId!==g.id||!equal(c.disclosure.holder,g.holder)||c.disclosure.holderEpoch!==g.holderEpoch||c.disclosure.purpose!==g.binding.purpose||!equal(c.disclosure.target,step.target)||!equal(c.disclosure.sources,step.sources)||!equal(c.disclosure.actual,step.input)||c.disclosure.grantRevision!==g.rev||this.#now()>=u(c.disclosure.expires))fail('GRANT_DISCLOSURE_REQUIRED');}
   if(!['SAME_RESOURCE_TRANSACTION','EGRESS_FENCE_ONLY'].includes(held.fenceKind))fail('GRANT_RESOURCE_FENCE_UNAVAILABLE');
   if(held.fenceKind==='EGRESS_FENCE_ONLY'&&c.catalog.risk!=='read')fail('GRANT_ATOMIC_EFFECT_UNAVAILABLE');
   let checkedOnce=false,inside=false;
   const expected={grantId:g.id,grantRevision:g.rev,holder:g.holder,holderEpoch:g.holderEpoch,task:g.binding.task,generation:g.binding.generation,stepId:g.binding.stepId,tool:g.binding.tool,operation:g.operation,input:g.binding.input,target:g.binding.target,policyRevision:c.policyRevision};
   result=await method(held,'commitAtEffectFence')(expected,finalSnapshot=>{
    this.#alive();if(checkedOnce||inside)fail('GRANT_FENCE_CHECK_ONCE');inside=true;checkedOnce=true;const final=capture(finalSnapshot);validateCurrent(g,final,this.#now(),{effect:true});if(final.policyRevision!==c.policyRevision||!equal(final.catalog,c.catalog))fail('GRANT_POLICY_CHANGED');
    if(c.catalog.egress===true&&(!equal(final.disclosure,c.disclosure)||!equal(final.sources,c.sources)||this.#now()>=u(final.disclosure.expires)))fail('GRANT_DISCLOSURE_CHANGED');inside=false;
   });
   if(!checkedOnce||inside)fail('GRANT_FENCE_CHECK_MISSING');
   if(!result||result.scope!==(held.fenceKind==='SAME_RESOURCE_TRANSACTION'?'same-resource-transaction':'egress-only')||!['COMMITTED','FAILED','UNKNOWN','CONTENT_PRESENT'].includes(result.state))fail('GRANT_EFFECT_RECEIPT_INVALID');id(result.effectRef);
  }catch(cause){error={cause};}
  if(held)try{await this.#drain(held);}catch(cause){error??={cause};}
  if(error)throw Object.assign(Error('GRANT_EFFECT_UNRESOLVED'),{code:'GRANT_EFFECT_UNRESOLVED',cause:error.cause,partial:result??null,recoverOnly:true});return result;
 }
 retire(){this.#retired=true;}
}

// No Source/signing root/codec is installed by the object-shaped DTOs above.
export function openOriginalBoundGrantPolicy(...args){if(args.length)fail('GRANT_ZERO_INPUT_REQUIRED');fail('GRANT_PROTECTED_SOURCE_NOT_SUPPLIED');}
export const inspectBoundGrantDATA=value=>grant(capture(value));
export const bindGrantBytesDATA=value=>bytesBinding(byteCopy(value));
