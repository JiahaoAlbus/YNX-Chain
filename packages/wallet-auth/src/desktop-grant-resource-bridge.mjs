// PRIVATE constructor called by the fixed Auth Native backend compositor.
// Actual normal operands are that backend's qualified Native Root, SAME store,
// and its recognized caller operation, never a renderer provider or target URL.
import{createRequire}from'node:module';
import{inspectBoundGrantDATA}from'./original-bound-grant-policy.js';
import{canonicalJSON}from'./canonical.js';
import{RESOURCE_SERVICE,RESOURCE_PATHS,originalProofsDATA,requestDATA,decodeResponseDATA}from'./desktop-grant-resource-data.mjs';
const fail=c=>{throw Object.assign(Error(c),{code:c})},method=(v,k)=>{if(typeof v?.[k]!=='function')fail('TASK_RESOURCE_ORIGINAL_'+k+'_NOT_SUPPLIED');return v[k].bind(v)};
const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
async function checked(v,k,...a){if(await method(v,k)(...a)!==undefined)fail('TASK_RESOURCE_VOID_RESULT')}
export function openOriginalTaskReadResourceBridge(nativeRoot,store){
 const calls=new Set(),receipts=new Map(),pending=new Set();let first,retired=false,closed=false;
 const current=()=>{if(first)throw first.cause;if(retired||closed)fail('TASK_RESOURCE_BRIDGE_RETIRED');if(method(nativeRoot,'assertNativeCurrent')()!==undefined)fail('TASK_RESOURCE_NATIVE_CURRENT_RESULT')};
 const originalMaterial=g=>{current();const m=method(nativeRoot,'readOriginalTaskReadMaterialDATA')();current();if(m.Version!=='AUTH-ORIGINAL-GRANT-PUBLIC-MATERIAL/private-v1'||!m.Account||!m.AuthorizationRef||!Array.isArray(m.Fields)||!m.Fields.length||!same(m.Issuer?.Principal,{Realm:g.issuer.realm,Tenant:g.issuer.tenant,Kind:g.issuer.kind,ID:g.issuer.id,Revision:g.issuer.rev})||m.Issuer.Epoch!==g.issuerEpoch||!same(m.Holder?.Principal,{Realm:g.holder.realm,Tenant:g.holder.tenant,Kind:g.holder.kind,ID:g.holder.id,Revision:g.holder.rev})||m.Holder.Epoch!==g.holderEpoch)fail('TASK_RESOURCE_ROOT_PRINCIPAL_MAPPING');return m};
 const actualGrant=(g,recovery=false)=>{inspectBoundGrantDATA(g);current();const row=store.taskGrants.readGrant({realm:g.realm,tenant:g.tenant,id:g.id,at:Date.now()});if(!same(row.value,g)||!recovery&&(row.status!=='ACTIVE'||row.ref.rev!==g.rev))fail('TASK_RESOURCE_GRANT_STALE');return row};
 async function exchange(stage,g,proof,operation='',input=Buffer.alloc(0),recovery=false){const row=actualGrant(g,recovery),material=originalMaterial(g),proofs=originalProofsDATA(g,row.original,proof),wire=requestDATA(stage,g,material,proofs,operation,input);
  const profile=method(nativeRoot,'readOriginalTaskReadPeerDATA')(),modulePath=method(nativeRoot,'readOriginalTaskReadClientModulePath')();current();
  if(profile.service!==RESOURCE_SERVICE||profile.routes?.length!==3||Object.values(RESOURCE_PATHS).some(path=>!profile.routes.some(r=>r.path===path&&r.method==='POST'&&r.maxRequestBytes<=1048576&&r.maxResponseBytes<=1048576)))fail('TASK_RESOURCE_FINITE_REGISTERED_PROFILE');
  const client=createRequire(import.meta.url)(modulePath);current();let handle,packet,error,parsed,cleanup,done=false,closeSelected=false;
  const child=Object.freeze({assertCurrent(){current();if(handle)method(client,'currentOriginalTaskReadResourceCaller')(handle)},retire(){if(handle)method(client,'retireOriginalTaskReadResourceCaller')(handle)},async join(){if(handle)await checked(client,'joinOriginalTaskReadResourceCaller',handle)},async close(){if(done)return;if(cleanup)throw cleanup.cause;if(closeSelected)fail('TASK_RESOURCE_CLOSE_UNKNOWN');closeSelected=true;try{child.retire();await child.join();if(handle)await checked(client,'closeOriginalTaskReadResourceCaller',handle);done=true;calls.delete(child)}catch(cause){cleanup={cause};throw cause}},isClosed(){return done}});calls.add(child);
  try{handle=await method(client,'openOriginalTaskReadResourceCaller')(profile,{signal:undefined});child.assertCurrent();packet=await method(client,'exchangeOriginalTaskReadResource')(handle,stage,wire,{signal:undefined}); // adopt packet BEFORE code/current
   child.assertCurrent();if(!packet||!Number.isInteger(packet.statusCode)||!(packet.body instanceof Uint8Array))fail('TASK_RESOURCE_TRANSPORT_PACKET');parsed=decodeResponseDATA(stage,packet.body,packet.statusCode,g,operation);child.assertCurrent();
   // DATA decoding of input/query is never a receipt-verifier capability.
   // Settlement entries are installed only by the held continuation child.
  }catch(cause){error={cause}}
  if(error)return{owner:child,errorPresent:true,error:error.cause,partial:parsed??null,operationId:operation,dispatchPossible:!!error.cause?.dispatchPossible,transportPartial:packet??null};
  return{owner:child,errorPresent:false,error:null,result:parsed};
 }
 async function run(...a){current();const p=exchange(...a);pending.add(p);try{return await p}finally{pending.delete(p)}}
 const owner=Object.freeze({
  async readOriginalTaskEffectInput(g,holderProof){const opened=await run('input',g,holderProof);return{owner:opened.owner,errorPresent:opened.errorPresent,error:opened.error,bytes:opened.errorPresent?Buffer.alloc(0):Buffer.from(opened.result.input),partial:opened.partial??null}},
  async executeOriginalTaskEffect(ctx,request,continuation){const g=request.grant;if(!same(request.step,g.binding)||request.expectedGrantRevision!==g.rev)fail('TASK_RESOURCE_EXECUTE_EXACT_BINDING');
   // Query deliberately maps persisted PENDING to UNKNOWN. Only the SAME
   // ledger-private fresh ticket can select a continuation. Current NEVER
   // claims it; the actual Go resource Store.mu is the sole final claimant.
   const expected={grant:g,operationId:request.operationId,at:Date.now()};method(store.taskGrants,'currentOriginalTaskEffectContinuation')(continuation,expected);current();
   // This is a strong private Native acquisition, not a public provider. The
   // addon must retain the original inventory/caller association through LINK
   // physical drain. No serialized ticket/OWN_RESERVED state is accepted.
   const opened=await method(nativeRoot,'openOriginalTaskReadContinuation')(ctx,request,continuation);const child=opened?.owner;let outer,returned;
   if(child){outer=Object.freeze({assertCurrent:()=>method(child,'assertCurrent')(),retire:()=>method(child,'retire')(),join:()=>method(child,'join')(),async close(){try{await checked(child,'close')}finally{if(method(child,'isClosed')()===true)calls.delete(outer)}},isClosed:()=>method(child,'isClosed')()});calls.add(outer)}if(!opened||typeof opened.errorPresent!=='boolean')return{owner:outer??null,errorPresent:true,error:Object.assign(Error('TASK_RESOURCE_CONTINUATION_ACQUIRE_STATUS'),{code:'TASK_RESOURCE_CONTINUATION_ACQUIRE_STATUS'}),operationId:request.operationId,partial:null};if(opened.errorPresent)return{owner:outer??null,errorPresent:true,error:opened.error,operationId:request.operationId,partial:opened.partial??null};
   if(!child)fail('TASK_RESOURCE_CONTINUATION_OWNER_REQUIRED');
   try{await checked(child,'assertCurrent');method(store.taskGrants,'currentOriginalTaskEffectContinuation')(continuation,expected);current();
    returned=await method(child,'executeOriginalTaskEffect')(request);if(!returned||typeof returned.errorPresent!=='boolean')fail('TASK_RESOURCE_CONTINUATION_EXECUTE_STATUS');
    // The Native child owns any returned transport partial; do not drop it on
    // late Source failure. It must adopt before interpreting status/current.
    if(returned.errorPresent)return{...returned,owner:outer};await checked(child,'assertCurrent');current();
    const r=returned.result;if(r?.state==='COMMITTED'&&r.operationId===request.operationId&&typeof r.original==='string'&&r.original&&Buffer.byteLength(r.original)<=1048576)receipts.set(request.operationId,{g:structuredClone(g),original:r.original,child});else fail('TASK_RESOURCE_CONTINUATION_ORIGINAL_RECEIPT');return{...returned,owner:outer};
   }catch(cause){return{owner:outer,errorPresent:true,error:cause,operationId:request.operationId,partial:returned?.result??returned?.partial??null}}
  },
  async queryOriginalTaskEffect(g,operation,holderProof){const saved=store.taskGrants.readTaskEffect({realm:g.realm,tenant:g.tenant,id:g.id,operationId:operation,at:Date.now()});if(!['PENDING','UNKNOWN','COMMITTED','FAILED'].includes(saved.state))fail('TASK_RESOURCE_ORIGINAL_SLOT_REQUIRED');return run('query',g,holderProof,operation,Buffer.alloc(0),true)},
  assertOriginalTaskEffectReceiptAtCommit(expected){if(retired||closed||first)fail('TASK_RESOURCE_BRIDGE_RETIRED');const original=receipts.get(expected.operationId);if(!original||!same(original.g,expected.grant)||original.original!==expected.original||expected.state!=='COMMITTED')fail('TASK_RESOURCE_ACTUAL_ORIGINAL_RECEIPT_REQUIRED');if(original.child&&method(original.child,'assertOriginalTaskEffectReceiptAtCommit')(expected)!==undefined)fail('TASK_RESOURCE_NATIVE_RECEIPT_FENCE');if(method(nativeRoot,'assertNativeObservedCurrent')()!==undefined)fail('TASK_RESOURCE_NATIVE_FENCE');},
  current,retire(){retired=true;for(const c of calls)try{c.retire()}catch(cause){first??={cause}}},async join(){if(!retired)fail('TASK_RESOURCE_RETIRE_REQUIRED');await Promise.allSettled([...pending]);for(const c of calls)await c.join()},async close(){owner.retire();await owner.join();for(const c of[...calls])await c.close();if(calls.size)fail('TASK_RESOURCE_CHILDREN_RETAINED');closed=true},isClosed(){return closed}
 });return owner;
}
