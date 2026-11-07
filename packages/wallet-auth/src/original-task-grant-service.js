import{createOriginalTaskEffectOrchestrator}from'./desktop-grant-original-orchestration.mjs';
// Internal server API, not a public provider setter or a bearer-grant endpoint.
// The Source supplies original authenticated caller contexts and typed proof
// verifiers. Constructing this kernel is an isolated integration boundary only.
import{OriginalBoundGrantPolicyKernel,inspectBoundGrantDATA}from'./original-bound-grant-policy.js';
import{canonicalJSON}from'./canonical.js';import{types}from'node:util';
import{acquireOriginalTaskGrantAuthorityInputs}from'./original-task-grant-source.js';
import{encodeBoundGrant,encodeGrantEffect}from'@ynx-chain/open-protocol/bound-grant';
const originalGrantCodec=Object.freeze({encodeBoundGrant,encodeGrantEffect});
const fail=code=>{throw Object.assign(Error(code),{code});};
const refScope=(ctx,g)=>{if(!ctx||ctx.realm!==g.realm||ctx.tenant!==g.tenant)fail('GRANT_SERVICE_TENANT');};
const originalId=g=>typeof g?.id==='string'?g.id:undefined;
function data(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('GRANT_SERVICE_BODY_INVALID');const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail('GRANT_SERVICE_BODY_INVALID');return Object.fromEntries(keys.map(k=>[k,ds[k].value]));}
const requestId=ctx=>{if(!ctx||types.isProxy(ctx))return undefined;const d=Object.getOwnPropertyDescriptor(ctx,'requestId');return d&&Object.hasOwn(d,'value')&&typeof d.value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(d.value)?d.value:undefined;};
function parseBody(raw){const v=JSON.parse(raw);function walk(x,n){if(n>16)fail('GRANT_SERVICE_BODY_INVALID');if(!x||typeof x!=='object')return;if(Array.isArray(x)){if(x.length>1024)fail('GRANT_SERVICE_BODY_INVALID');}else if(Object.keys(x).length>128)fail('GRANT_SERVICE_BODY_INVALID');for(const value of Object.values(x))walk(value,n+1);}walk(v,0);if(canonicalJSON(v)!==raw)fail('GRANT_SERVICE_BODY_INVALID');return v;}
const failure=(error,requestId,op)=>{const code=String(error?.cause?.code??error?.code??'');let out='DENIED';if(/UNKNOWN|UNRESOLVED|COMMIT_UNKNOWN/.test(code))out='UNKNOWN';else if(/NOT_SUPPLIED|UNAVAILABLE|REQUIRED/.test(code))out='UNAVAILABLE';else if(/REVOKED|INACTIVE/.test(code))out='REVOKED';else if(/EXPIRED/.test(code))out='EXPIRED';else if(/CONFLICT|STALE|MISMATCH/.test(code))out='CONFLICT';else if(/BUDGET|LIMIT/.test(code))out='LIMIT';else if(/SCHEMA|INVALID|ARGUMENT|BYTES|UINT|BOUNDS/.test(code))out='INVALID';return Object.freeze({ok:false,code:out,requestId, ...(out==='UNKNOWN'&&op?{originalOp:op}:{})});};
function method(v,n){if(!v||typeof v[n]!=='function')fail('GRANT_SERVICE_SOURCE_UNAVAILABLE');return v[n].bind(v);}
async function verified(source,name,...args){if(await method(source,name)(...args)!==undefined)fail('GRANT_SERVICE_VERIFIER_RESULT');}
function requireNewProfile(g){if(!/^[a-f0-9]{32}$/.test(g.id)||!/^[a-f0-9]{32}$/.test(g.nonce))fail('GRANT_SERVICE_NEW_ID_INVALID');}
export class OriginalTaskGrantAuthorityServiceKernel{
 #source;#store;#policy;#clock;#retired=false;
 constructor(source,store,codec,clock=Date.now){this.#source=source;this.#store=store;this.#policy=new OriginalBoundGrantPolicyKernel(source,store.taskGrants,codec,clock);this.#clock=clock;}
 async #caller(ctx,action,value){if(this.#retired)fail('GRANT_SERVICE_RETIRED');await verified(this.#source,'assertTaskCaller',ctx,{action,value});if(this.#retired)fail('GRANT_SERVICE_RETIRED');}
 async issue(ctx,body){let g;try{const{grant,issuerApproval,issuerProof}=data(body,['grant','issuerApproval','issuerProof']);g=inspectBoundGrantDATA(grant);requireNewProfile(g);await this.#caller(ctx,'issue',g);refScope(ctx,g);const value=await this.#policy.signBoundGrant(g,issuerApproval,issuerProof);return Object.freeze({ok:true,value:{...value,grantRef:{realm:g.realm,tenant:g.tenant,kind:'grant',id:g.id,rev:g.rev}}});}catch(e){return failure(e,requestId(ctx),originalId(g));}}
 async authorizeAtEffect(ctx,body){let g;try{const{grant,step,holderProof,expectedGrantRevision}=data(body,['grant','step','holderProof','expectedGrantRevision']);g=inspectBoundGrantDATA(grant);requireNewProfile(g);await this.#caller(ctx,'effect',g);refScope(ctx,g);const value=await this.#policy.authorizeAtEffect(g,step,holderProof,expectedGrantRevision);return Object.freeze({ok:true,value});}catch(e){return failure(e,requestId(ctx),originalId(g));}}
 async queryGrant(ctx,body){let grantRef;try{let holderProof;({grantRef,holderProof}=data(body,['grantRef','holderProof']));await this.#caller(ctx,'query-grant',grantRef);refScope(ctx,grantRef);if(grantRef.kind!=='grant')fail('GRANT_SERVICE_REF_INVALID');await verified(this.#source,'verifyGrantQuery',ctx,grantRef,holderProof);const value=this.#store.taskGrants.readGrant({realm:grantRef.realm,tenant:grantRef.tenant,id:grantRef.id,at:this.#clock()});return Object.freeze({ok:true,value});}catch(e){return failure(e,requestId(ctx),grantRef?.id);}}
 async queryEffect(ctx,body){let operationId;try{const{grantRef,holderProof,...rest}=data(body,['grantRef','operationId','holderProof']);operationId=rest.operationId;await this.#caller(ctx,'query-effect',grantRef);refScope(ctx,grantRef);await verified(this.#source,'verifyEffectQuery',ctx,grantRef,operationId,holderProof);const value=this.#store.taskGrants.readTaskEffect({realm:grantRef.realm,tenant:grantRef.tenant,id:grantRef.id,operationId,at:this.#clock()});return Object.freeze({ok:true,value});}catch(e){return failure(e,requestId(ctx),operationId);}}
 async reconcileEffect(ctx,body){let operationId;try{const{grantRef,holderProof,...rest}=data(body,['grantRef','operationId','holderProof']);operationId=rest.operationId;await this.#caller(ctx,'reconcile-effect',grantRef);refScope(ctx,grantRef);await verified(this.#source,'verifyEffectQuery',ctx,grantRef,operationId,holderProof);const receipt=await method(this.#source,'queryOriginalTaskEffect')(ctx,grantRef,operationId);const captured=data(receipt,['state','original']);const value=this.#store.taskGrants.reconcileTaskEffect({realm:grantRef.realm,tenant:grantRef.tenant,id:grantRef.id,operationId,...captured,at:this.#clock(),assertOriginalReceipt:expected=>{if(this.#retired)fail('GRANT_SERVICE_RETIRED');return method(this.#source,'assertOriginalTaskEffectReceiptAtCommit')(ctx,expected);}});return Object.freeze({ok:true,value});}catch(e){return failure(e,requestId(ctx),operationId);}}
 async revoke(ctx,body){let grantRef;try{let expectedRevision,proofBinding,revocationProof;({grantRef,expectedRevision,proofBinding,revocationProof}=data(body,['grantRef','expectedRevision','proofBinding','revocationProof']));await this.#caller(ctx,'revoke',grantRef);refScope(ctx,grantRef);await verified(this.#source,'verifyGrantRevocation',ctx,grantRef,expectedRevision,proofBinding,revocationProof);const value=this.#store.taskGrants.revokeGrant({realm:grantRef.realm,tenant:grantRef.tenant,id:grantRef.id,expectedRevision,proofBinding,at:this.#clock(),assertCurrent:expected=>{if(this.#retired)fail('GRANT_SERVICE_RETIRED');return method(this.#source,'assertGrantRevocationAtCommit')(ctx,expected);}});return Object.freeze({ok:true,value});}catch(e){return failure(e,requestId(ctx),grantRef?.id);}}
 retire(){this.#retired=true;this.#policy.retire();}
}
// Original daemon bootstrap must use an independently admitted protected
// Source/codec/resource adapter. No context JSON, test kernel or session can
// register itself. Until that normal loader is supplied, the service is closed.
export async function openOriginalTaskGrantAuthorityService(...args){if(args.length)fail('GRANT_SERVICE_ZERO_INPUT_REQUIRED');return openOriginalTaskGrantServiceComposition(acquireOriginalTaskGrantAuthorityInputs);}

// Private original-bootstrap construction, not a public Source setter. Every
// non-null custody partial is adopted before inspecting its explicit status.
// This opens NO database: inputs.store is the original authority connection.
export async function openOriginalTaskGrantServiceComposition(acquire,clock=Date.now){
 let held,service,transport,first,retired=false,closing,retireSelected=false,retireFailure,joining;const pending=new Set();
 const current=async()=>{if(retired)fail('GRANT_SERVICE_RETIRED');await verified(held,'assertCurrent');if(retired)fail('GRANT_SERVICE_RETIRED');};
 const retire=()=>{if(!retireSelected){retireSelected=true;retired=true;service?.retire();if(held)try{const r=held.retire();if(r!==undefined)fail('GRANT_SERVICE_CLEANUP_RESULT');}catch(cause){retireFailure={cause};}}if(retireFailure)throw retireFailure.cause;};
 const join=()=>{if(!retired)fail('GRANT_SERVICE_NOT_RETIRED');return joining??=(async()=>{await Promise.allSettled([...pending]);if(held)await verified(held,'join');})();};
 const close=()=>closing??=(async()=>{let error;for(const f of[retire,join,()=>held?verified(held,'close'):undefined])try{await f();}catch(cause){error??={cause};}if(error)throw error.cause;})();
 const owner=Object.freeze({
  async handle(req,res){if(!transport||retired||first)fail('GRANT_SERVICE_SOURCE_UNAVAILABLE');const work=Promise.resolve().then(async()=>{await current();return transport.handle(req,res);});pending.add(work);try{return await work;}finally{pending.delete(work);}},
  status:()=>Object.freeze({configured:!!transport&&!first&&!retired,retired,pending:pending.size,sourceAdmission:false}),
  retire,join,close,
 });
 try{const opened=await acquire();held=opened?.owner;if(!opened||typeof opened.errorPresent!=='boolean')fail('GRANT_SOURCE_ACQUIRE_STATUS_REQUIRED');if(opened.errorPresent)throw opened.error;await current();const inputs=await method(held,'readOriginalTaskGrantServiceInputs')();await current();if(!inputs?.store?.taskGrants||!inputs.source||!inputs.callerResolver)fail('GRANT_SOURCE_INPUTS_NOT_SUPPLIED');
  const baseService=new OriginalTaskGrantAuthorityServiceKernel(inputs.source,inputs.store,originalGrantCodec,clock),effects=createOriginalTaskEffectOrchestrator(inputs,current,clock);service=Object.freeze({issue:(...a)=>baseService.issue(...a),queryGrant:(...a)=>baseService.queryGrant(...a),queryEffect:(...a)=>baseService.queryEffect(...a),reconcileEffect:(...a)=>baseService.reconcileEffect(...a),revoke:(...a)=>baseService.revoke(...a),authorizeAtEffect:effects.authorizeAtEffect,retire(){effects.retire();baseService.retire()}});const guardedResolver={async acquireOriginalTaskCaller(req){await current();const caller=await method(inputs.callerResolver,'acquireOriginalTaskCaller')(req);return caller;},async releaseOriginalTaskCaller(caller){let error;for(const f of[current,()=>verified(inputs.callerResolver,'releaseOriginalTaskCaller',caller),current])try{await f();}catch(cause){error??={cause};}if(error)throw error.cause;}};transport=new OriginalTaskGrantHTTPKernel(service,guardedResolver);await current();return Object.freeze({owner,errorPresent:false});
 }catch(cause){first={cause};return Object.freeze({owner,errorPresent:true,error:cause});}
}

// Bounded INTERNAL transport; callerResolver is original server bootstrap IO,
// never a request field. This kernel is not registered by a public setter.
export class OriginalTaskGrantHTTPKernel{
 #service;#resolver;
 constructor(service,originalCallerResolver){this.#service=service;this.#resolver=originalCallerResolver;}
 async handle(req,res){const routes={'/internal/auth/task-grants/issue':'issue','/internal/auth/task-grants/effect':'authorizeAtEffect','/internal/auth/task-grants/query':'queryGrant','/internal/auth/task-grants/effect-query':'queryEffect','/internal/auth/task-grants/effect-reconcile':'reconcileEffect','/internal/auth/task-grants/revoke':'revoke'};if(!Object.hasOwn(routes,req.url))return false;let caller,result;
  try{if(!this.#service)fail('GRANT_SERVICE_SOURCE_UNAVAILABLE');if(req.method!=='POST'||req.headers['content-type']!=='application/json'||req.headers['content-encoding']!==undefined||req.headers['transfer-encoding']!==undefined)fail('GRANT_SERVICE_REQUEST_INVALID');const length=req.headers['content-length'];if(typeof length!=='string'||!/^[1-9][0-9]{0,6}$/.test(length)||Number(length)>1048576)fail('GRANT_SERVICE_SIZE_INVALID');
   caller=await method(this.#resolver,'acquireOriginalTaskCaller')(req);const chunks=[];let size=0;const timer=setTimeout(()=>req.destroy(),5000);try{for await(const c of req){size+=c.length;if(size>Number(length))fail('GRANT_SERVICE_SIZE_INVALID');chunks.push(c);}if(size!==Number(length)||req.destroyed&&!req.complete)fail('GRANT_SERVICE_BODY_INVALID');}finally{clearTimeout(timer);}const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),body=parseBody(raw);result=await this.#service[routes[req.url]](caller,body);
  }catch(e){result=failure(e,requestId(caller));}finally{if(caller&&typeof this.#resolver.releaseOriginalTaskCaller==='function')try{await this.#resolver.releaseOriginalTaskCaller(caller);}catch{result=Object.freeze({ok:false,code:'UNKNOWN',requestId:requestId(caller),originalOp:result?.value?.effectRef??result?.value?.grantRef?.id});}}
  if(!res.headersSent&&!res.destroyed){res.writeHead(result.ok?200:result.code==='UNAVAILABLE'?503:result.code==='UNKNOWN'?409:422,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));}return true;
 }
}
