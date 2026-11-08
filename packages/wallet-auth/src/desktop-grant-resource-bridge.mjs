// PRIVATE constructor called by the fixed Auth Native backend compositor.
// Actual normal operands are that backend's qualified Native Root, SAME store,
// and its recognized caller operation, never a renderer provider or target URL.
import{openOriginalTaskReadTransport}from'./desktop-grant-resource-transport-owner.mjs';
import{openOriginalTaskReadStrongTransport}from'./desktop-grant-strong-continuation-transport-private.mjs';
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
  const acquired=await openOriginalTaskReadTransport(nativeRoot,profile,modulePath,stage,wire);const actual=acquired.owner;let child,parsed,error;
  // Track the SAME actual owner even when acquisition/exchange returned an
  // error or a complete late partial. Packet release precedes physical join.
  child=Object.freeze({assertCurrent:()=>actual.assertCurrent(),retire:()=>actual.retire(),join:()=>actual.join(),async close(){const paired=await actual.close();if(paired.physicalDone===true)calls.delete(child);return paired},isClosed:()=>actual.isClosed(),isJoined:()=>actual.isJoined(),firstCause:()=>actual.firstCause(),lifetime:()=>actual.lifetime()});calls.add(child);
  if(acquired.errorPresent)error={cause:acquired.error};
  if(!error)try{const packet=acquired.data;if(!packet||packet.path!==RESOURCE_PATHS[stage]||!Number.isInteger(packet.statusCode)||!(packet.body instanceof Uint8Array))fail('TASK_RESOURCE_TRANSPORT_PACKET');parsed=decodeResponseDATA(stage,packet.body,packet.statusCode,g,operation);child.assertCurrent()}catch(cause){error={cause}}
  // A decoder/query result never installs a receipt-verifier capability.
  if(error)return{owner:child,errorPresent:true,error:error.cause,partial:parsed??null,operationId:operation,dispatchPossible:acquired.data?.dispatchPossible??false,transportPartial:acquired.data,sourceCurrentErrorPresent:acquired.sourceCurrentErrorPresent};
  return{owner:child,errorPresent:false,error:null,result:parsed,transportPartial:acquired.data,dispatchPossible:acquired.data?.dispatchPossible??false};
 }
 async function run(...a){current();const p=exchange(...a);pending.add(p);try{return await p}finally{pending.delete(p)}}
 const owner=Object.freeze({
  async readOriginalTaskEffectInput(g,holderProof){const opened=await run('input',g,holderProof),actual=opened.owner;const input=Object.freeze({assertCurrent:()=>actual.assertCurrent(),retire:()=>actual.retire(),async join(){const r=await actual.join();if(r.errorPresent)throw r.error;if(!r.physicalDone)fail('TASK_RESOURCE_INPUT_JOIN_PENDING')},async close(){const r=await actual.close();if(r.errorPresent)throw r.error;if(!r.physicalDone)fail('TASK_RESOURCE_INPUT_CLOSE_PENDING')},isClosed:()=>actual.isClosed(),isJoined:()=>actual.isJoined(),firstCause:()=>actual.firstCause(),lifetime:()=>actual.lifetime()});return{owner:input,errorPresent:opened.errorPresent,error:opened.error,bytes:opened.errorPresent?Buffer.alloc(0):Buffer.from(opened.result.input),partial:opened.partial??null,transportPartial:opened.transportPartial??null,dispatchPossible:opened.dispatchPossible??false,sourceCurrentErrorPresent:opened.sourceCurrentErrorPresent??false}},
  async executeOriginalTaskEffect(ctx,request,continuation){
   const g=request.grant;if(!same(request.step,g.binding)||request.expectedGrantRevision!==g.rev)fail('TASK_RESOURCE_EXECUTE_EXACT_BINDING');
   const expected={grant:g,operationId:request.operationId,at:Date.now()};method(store.taskGrants,'currentOriginalTaskEffectContinuation')(continuation,expected);current();
   // The sole existing DATA chain, captured before Native acquisition awaits.
   const row=actualGrant(g),material=originalMaterial(g),proofs=originalProofsDATA(g,row.original,request.holderProof),wire=requestDATA('execute',g,material,proofs,request.operationId,request.rawInput);
   let opened;try{opened=await method(nativeRoot,'openOriginalTaskReadContinuation')(ctx,request,continuation)}catch(error){opened={owner:error?.partial??null,errorPresent:true,error}}
   const child=opened?.owner;let transport,packet,parsed,first,retired=false,childJoined=false,childClosed=false,childCloseSelected=false,closeWork;
   const remember=error=>{first??={error}},pair=physicalDone=>Object.freeze({physicalDone,errorPresent:!!first,error:first?first.error:null});
   const outer=child?Object.freeze({
    async assertCurrent(){if(retired)fail('TASK_RESOURCE_CONTINUATION_RETIRED');await checked(child,'assertCurrent');current();if(transport)await checked(transport,'assertCurrent');current()},
    retire(){retired=true;if(transport)try{transport.retire()}catch(error){remember(error)}},
    async join(){outer.retire();try{if(transport){const r=await transport.join();if(r.errorPresent)remember(r.error);if(!r.physicalDone)return pair(false)}
      // Auth child remains live until packet release and actual LINK drain.
      await checked(child,'retire');try{await checked(child,'join')}catch(error){remember(error)}childJoined=method(child,'isJoined')()===true;return pair(childJoined)
     }catch(error){remember(error);return pair(false)}},
    close(){if(closeWork)return closeWork;const work=Promise.resolve().then(async()=>{const j=await outer.join();if(!j.physicalDone)return pair(false);try{if(transport){const r=await transport.close();if(r.errorPresent)remember(r.error);if(!r.physicalDone)return pair(false)}try{childCloseSelected=true;await checked(child,'close')}catch(error){remember(error)}childClosed=method(child,'isClosed')()===true;if(childClosed)calls.delete(outer);return pair(childClosed)}catch(error){remember(error);return pair(false)}});closeWork=work;work.then(r=>{if(!r.physicalDone&&!childCloseSelected&&(!transport||!transport.lifetime().carrierCloseSelected)&&closeWork===work)closeWork=undefined});return work},
    isJoined(){return childJoined&&(!transport||transport.isJoined())},isClosed(){return childClosed&&(!transport||transport.isClosed())},firstCause(){return pair(childClosed)}
   }):null;
   if(outer)calls.add(outer); // Adopt partial before status, current, or cleanup.
   try{
    if(!opened||typeof opened.errorPresent!=='boolean')fail('TASK_RESOURCE_CONTINUATION_ACQUIRE_STATUS');if(opened.errorPresent)throw opened.error;if(!child)fail('TASK_RESOURCE_CONTINUATION_OWNER_REQUIRED');
    await checked(child,'assertCurrent');method(store.taskGrants,'currentOriginalTaskEffectContinuation')(continuation,expected);current();
    const original=method(child,'readOriginalRequestDATA')(),heldProofs=originalProofsDATA(original.grant,row.original,original.holderProof),heldWire=requestDATA('execute',original.grant,material,heldProofs,original.operationId,original.rawInput);
    if(!wire.equals(heldWire))fail('TASK_RESOURCE_CONTINUATION_ORIGINAL_BODY_CHANGED');
    const profile=method(nativeRoot,'readOriginalTaskReadPeerDATA')();current();
    if(profile.service!==RESOURCE_SERVICE||profile.routes?.length!==3||Object.values(RESOURCE_PATHS).some(path=>!profile.routes.some(r=>r.path===path&&r.method==='POST'&&r.maxRequestBytes<=1048576&&r.maxResponseBytes<=1048576)))fail('TASK_RESOURCE_FINITE_REGISTERED_PROFILE');
    // Separate Root-selected, held-closure reference. Never guess a sibling.
    const modulePath=method(nativeRoot,'readOriginalTaskReadContinuationModulePath')();current();
    const a=await openOriginalTaskReadStrongTransport(nativeRoot,profile,modulePath,wire,child);transport=a.owner;packet=a.data;let decodeError;
    if(packet)try{if(packet.path!==RESOURCE_PATHS.execute||!Number.isInteger(packet.statusCode)||!(packet.body instanceof Uint8Array))fail('TASK_RESOURCE_TRANSPORT_PACKET');parsed=decodeResponseDATA('execute',packet.body,packet.statusCode,g,request.operationId)}catch(error){decodeError={error}}
    if(a.errorPresent)throw a.error;if(decodeError)throw decodeError.error;
    if(parsed?.state!=='COMMITTED'||typeof parsed.original!=='string')fail('TASK_RESOURCE_CONTINUATION_ACTUAL_RECEIPT_UNRESOLVED');
    await outer.assertCurrent();receipts.set(request.operationId,{g:structuredClone(g),original:parsed.original,child});
    return{owner:outer,errorPresent:false,error:null,result:parsed,transportPartial:packet};
   }catch(error){remember(error);return{owner:outer,errorPresent:true,error,operationId:request.operationId,partial:parsed??null,transportPartial:packet??null,dispatchPossible:packet?.dispatchPossible??false}}
  },
  async queryOriginalTaskEffect(g,operation,holderProof){const saved=store.taskGrants.readTaskEffect({realm:g.realm,tenant:g.tenant,id:g.id,operationId:operation,at:Date.now()});if(!['PENDING','UNKNOWN','COMMITTED','FAILED'].includes(saved.state))fail('TASK_RESOURCE_ORIGINAL_SLOT_REQUIRED');return run('query',g,holderProof,operation,Buffer.alloc(0),true)},
  assertOriginalTaskEffectReceiptAtCommit(expected){if(retired||closed||first)fail('TASK_RESOURCE_BRIDGE_RETIRED');const original=receipts.get(expected.operationId);if(!original||!same(original.g,expected.grant)||original.original!==expected.original||expected.state!=='COMMITTED')fail('TASK_RESOURCE_ACTUAL_ORIGINAL_RECEIPT_REQUIRED');if(original.child&&method(original.child,'assertOriginalTaskEffectReceiptAtCommit')(expected)!==undefined)fail('TASK_RESOURCE_NATIVE_RECEIPT_FENCE');if(method(nativeRoot,'assertNativeObservedCurrent')()!==undefined)fail('TASK_RESOURCE_NATIVE_FENCE');},
  current,retire(){retired=true;for(const c of calls)try{c.retire()}catch(cause){first??={cause}}},async join(){if(!retired)fail('TASK_RESOURCE_RETIRE_REQUIRED');await Promise.allSettled([...pending]);let physicalDone=true;for(const c of calls){const r=await c.join();if(!r||typeof r.physicalDone!=='boolean'||typeof r.errorPresent!=='boolean')fail('TASK_RESOURCE_CHILD_JOIN_STATUS');physicalDone&&=r.physicalDone;if(r.errorPresent)first??={cause:r.error}}return Object.freeze({physicalDone,errorPresent:!!first,error:first?first.cause:null})},async close(){owner.retire();await owner.join();for(const c of[...calls]){const r=await c.close();if(!r||typeof r.physicalDone!=='boolean'||typeof r.errorPresent!=='boolean')fail('TASK_RESOURCE_CHILD_CLOSE_STATUS');if(r.errorPresent)first??={cause:r.error}}closed=calls.size===0;return Object.freeze({physicalDone:closed,errorPresent:!!first,error:first?first.cause:null})},isClosed(){return closed}
 });return owner;
}
