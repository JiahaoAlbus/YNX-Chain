import{openOriginalTaskReadResourceBridge}from'./desktop-grant-resource-bridge.mjs';
import{createOriginalTaskReadContinuationInventory}from'./desktop-grant-continuation-owner.mjs';
// Fixed package-private compositor, invoked ONLY by the original Native
// zeroarg export after its own independent Root/Source/image qualification.
// This constructor is not a package export or provider registration API.
import{createRequire}from'node:module';import{performance}from'node:perf_hooks';import{canonicalJSON}from'./canonical.js';
import{inspectOriginalDesktopCallerResourceDATA,ORIGINAL_DESKTOP_GRANT_ROUTES}from'./desktop-grant-caller-resource.mjs';
import{acquireOriginalTaskGrantAuthorityInputs}from'./original-task-grant-source.js';
import{OriginalTaskGrantAuthorityServiceKernel,OriginalTaskGrantHTTPKernel}from'./original-task-grant-service.js';
import{createOriginalTaskEffectOrchestrator}from'./desktop-grant-original-orchestration.mjs';
import{encodeBoundGrant,encodeGrantEffect}from'@ynx-chain/open-protocol/bound-grant';
const fault=c=>Object.assign(Error(c),{code:c}),method=(v,k)=>{if(typeof v?.[k]!=='function')throw fault('DESKTOP_NATIVE_'+k+'_NOT_SUPPLIED');return v[k].bind(v)};
async function checked(v,k,...a){if(await method(v,k)(...a)!==undefined)throw fault('DESKTOP_NATIVE_VOID_RESULT')}
function sync(v,k,...a){if(method(v,k)(...a)!==undefined)throw fault('DESKTOP_NATIVE_SYNC_RESULT')}
const paths=new Map(ORIGINAL_DESKTOP_GRANT_ROUTES.map(([method,path,action])=>[path,{method,action}]));
export function createOriginalTaskGrantNativeBackend(originalNativeRoot){
 let resourcePromise,resourceOwner,continuationInventory;
 const records=new WeakMap(),holds=new Set(),pending=new Set();let linkOwner,server,scope,authority,callerScope,retired=false,joined=false,closed=false,first,init,joining,closing,kernel,service,effects;
 const remember=cause=>{first??={cause};return first.cause};
 const alive=()=>{if(first)throw first.cause;if(retired||closed)throw fault('DESKTOP_NATIVE_RETIRED')};
 const track=async work=>{pending.add(work);try{return await work}finally{pending.delete(work)}};
 const rootCurrent=()=>{try{sync(originalNativeRoot,'assertNativeCurrent')}catch(cause){remember(cause);try{owner.retire()}catch{}throw cause}};
 const local=(ctx,cleanup=false)=>{const r=ctx&&records.get(ctx);if(!r||!holds.has(r)||r.released||!cleanup&&r.releasing)throw fault('DESKTOP_NATIVE_ORIGINAL_CALLER');if(!cleanup){alive();if(performance.now()>=r.deadline)throw fault('DESKTOP_NATIVE_ORIGINAL_CALLER_EXPIRED');sync(originalNativeRoot,'assertNativeObservedCurrent');sync(linkOwner,'assertOriginalInboundAtCommit',r.caller)}return r};
 async function callerCurrent(ctx){const r=local(ctx);rootCurrent();const actual=await method(linkOwner,'currentOriginalInbound')(r.caller);local(ctx);rootCurrent();const route=paths.get(actual.Path);
  if(!route||actual.Method!==route.method||actual.Service!==callerScope.service||actual.ContentType!=='application/json'||!Buffer.isBuffer(actual.Body)||actual.Body.length!==actual.ContentLength||actual.Body.length<1||actual.Body.length>1048576||actual.Channel?.LocalSAN!==callerScope.localSAN||canonicalJSON(actual.Channel?.Peer)!==canonicalJSON(callerScope.peer))throw fault('DESKTOP_NATIVE_CALLER_TRANSPORT_MISMATCH');
  if(r.material&&(r.material.Path!==actual.Path||!r.material.Body.equals(actual.Body)))throw fault('DESKTOP_NATIVE_ORIGINAL_BODY_CHANGED');r.material??={...actual,Body:Buffer.from(actual.Body)};local(ctx);return r;
 }
 async function serviceInputs(){const a=await acquireOriginalTaskGrantAuthorityInputs();if(a?.errorPresent)throw a.error;if(!a?.owner)throw fault('DESKTOP_NATIVE_AUTHORITY_INPUTS_REQUIRED');await checked(a.owner,'assertCurrent');return method(a.owner,'readOriginalTaskGrantServiceInputs')()}
 async function resource(){return resourcePromise??=(async()=>{await owner.assertCurrent();const inputs=await serviceInputs();await owner.assertCurrent();continuationInventory=createOriginalTaskReadContinuationInventory(originalNativeRoot,inputs.store,owner);
   const actualRoot=Object.freeze({assertNativeCurrent:()=>sync(originalNativeRoot,'assertNativeCurrent'),assertNativeObservedCurrent:()=>sync(originalNativeRoot,'assertNativeObservedCurrent'),readOriginalTaskReadMaterialDATA:()=>method(originalNativeRoot,'readOriginalTaskReadMaterialDATA')(),readOriginalTaskReadPeerDATA:()=>method(originalNativeRoot,'readOriginalTaskReadPeerDATA')(),readOriginalTaskReadClientModulePath:()=>method(originalNativeRoot,'readOriginalTaskReadClientModulePath')(),openOriginalTaskReadContinuation:(ctx,req,cap)=>continuationInventory.openOriginal(ctx,req,cap)});
   resourceOwner=openOriginalTaskReadResourceBridge(actualRoot,inputs.store);return resourceOwner;
  })()}
 async function handler(req,res){await owner.assertCurrent();if(!kernel){const inputs=await serviceInputs();await owner.assertCurrent();service=new OriginalTaskGrantAuthorityServiceKernel(inputs.source,inputs.store,{encodeBoundGrant,encodeGrantEffect});effects=createOriginalTaskEffectOrchestrator(inputs,owner.assertCurrent);const wrapped={issue:(...a)=>service.issue(...a),queryGrant:(...a)=>service.queryGrant(...a),queryEffect:(...a)=>service.queryEffect(...a),reconcileEffect:(...a)=>service.reconcileEffect(...a),revoke:(...a)=>service.revoke(...a),authorizeAtEffect:effects.authorizeAtEffect};kernel=new OriginalTaskGrantHTTPKernel(wrapped,inputs.callerResolver)}
  if(req.url==='/internal/auth/task-grants/management'){
   // No invented public management WIRE. The typed management API remains
   // separately reviewed; a transport route is not approval or an empty list.
   res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end('{"ok":false,"code":"GRANT_MANAGEMENT_TYPED_TRANSPORT_NOT_SUPPLIED"}');return;
  }
  const handled=await kernel.handle(req,res);if(!handled)throw fault('DESKTOP_NATIVE_FINITE_ROUTE_REQUIRED');
 }
 const owner=Object.freeze({
  async assertCurrent(){await init;alive();rootCurrent();if(!linkOwner||method(linkOwner,'registeredServer')()!==server)throw fault('DESKTOP_NATIVE_SAME_REGISTERED_SERVER');alive()},
  readOriginalAuthorityBindingDATA(){alive();rootCurrent();return structuredClone(authority)},
  readOriginalCallerRegistrationDATA(){alive();rootCurrent();return structuredClone(callerScope)},
  async acquireOriginalTaskCaller(req){await owner.assertCurrent();const deadline=performance.now()+5000,acquired=await method(linkOwner,'acquireOriginalInbound')(req),r={request:req,caller:acquired?.caller,ctx:null,released:false,releasing:false,releaseWork:null,deadline};
   if(r.caller){r.ctx=Object.freeze({realm:scope.realm,tenant:scope.tenant,account:scope.issuerAccount});records.set(r.ctx,r);holds.add(r)}
   try{if(!acquired||typeof acquired.errorPresent!=='boolean')throw fault('DESKTOP_NATIVE_CALLER_ACQUIRE_STATUS');if(acquired.errorPresent)throw acquired.error;if(!r.ctx)throw fault('DESKTOP_NATIVE_CALLER_REQUIRED');await callerCurrent(r.ctx);return r.ctx}
   catch(cause){if(r.ctx)try{await owner.releaseOriginalTaskCaller(r.ctx)}catch(cleanupError){throw Object.assign(fault('DESKTOP_NATIVE_CALLER_CLEANUP_UNKNOWN'),{cause,cleanupError,partialCaller:r.ctx})}throw cause}
  },
  async releaseOriginalTaskCaller(ctx){const r=local(ctx,true);if(r.releaseWork)return r.releaseWork;r.releasing=true;r.releaseWork=(async()=>{await checked(linkOwner,'releaseOriginalInbound',r.caller);r.released=true;holds.delete(r)})();return r.releaseWork},
  assertOriginalTaskCallerAtCommit(ctx){local(ctx)},
  async assertTaskCaller(ctx,request){const r=await callerCurrent(ctx),route=paths.get(r.material.Path);if(route.action!==request?.action||!callerScope.actions.includes(request.action))throw fault('DESKTOP_NATIVE_CALLER_ACTION');const value=request.value;if(value&&(value.realm!==scope.realm||value.tenant!==scope.tenant))throw fault('DESKTOP_NATIVE_CALLER_TENANT');local(ctx)},
  assertOriginalManagementCallerAtCommit(ctx,expected){const r=local(ctx);if(paths.get(r.material?.Path)?.action!=='management'||canonicalJSON(expected.owner)!==canonicalJSON(scope.issuerFullRef))throw fault('DESKTOP_NATIVE_MANAGEMENT_ORIGINAL_CALLER');local(ctx)},
  readOriginalRegisteredTaskExecutors(){alive();rootCurrent();const available=method(originalNativeRoot,'readOriginalTaskReadAvailabilityDATA')();if(!available||Object.keys(available).join('|')!=='available'||typeof available.available!=='boolean')throw fault('DESKTOP_NATIVE_TASK_READ_AVAILABILITY');if(!available.available)return [];const target=method(originalNativeRoot,'readOriginalTaskReadTargetDATA')();rootCurrent();if(!target||Object.keys(target).sort().join('|')!=='operation|origin|path|region|service|tenant'||target.tenant!==scope.tenant||target.operation!=='ai.conversation.read')throw fault('DESKTOP_NATIVE_TASK_READ_TARGET');return[Object.freeze({target:structuredClone(target),async executeOriginalTaskEffect(ctx,request,cap){await callerCurrent(ctx);return(await resource()).executeOriginalTaskEffect(ctx,request,cap)}})]},
  // These methods require the original resource's registered typed bridge.
  // Native Root owns it; LINK transport DATA and caller grant JSON cannot
  // synthesize raw input, a receipt, a Store.mu fence or a query original.
  async readOriginalTaskEffectInput(ctx,g,holderProof){await callerCurrent(ctx);return(await resource()).readOriginalTaskEffectInput(g,holderProof)},
  async verifyOriginalGrantQuery(ctx,...a){await callerCurrent(ctx);await checked(originalNativeRoot,'verifyOriginalGrantQuery',...a);local(ctx)},
  async verifyOriginalEffectQuery(ctx,...a){await callerCurrent(ctx);await checked(originalNativeRoot,'verifyOriginalEffectQuery',...a);local(ctx)},
  async queryOriginalTaskEffect(ctx,...a){await callerCurrent(ctx);return method(originalNativeRoot,'queryOriginalTaskEffect')(...a)},
  assertOriginalTaskEffectReceiptAtCommit(ctx,expected){local(ctx);if(!resourceOwner)throw fault('DESKTOP_NATIVE_ORIGINAL_RESOURCE_REQUIRED');sync(resourceOwner,'assertOriginalTaskEffectReceiptAtCommit',expected);local(ctx)},
  retire(){if(!retired){retired=true;service?.retire();effects?.retire();resourceOwner?.retire();continuationInventory?.retire();try{if(linkOwner)sync(linkOwner,'retire')}catch(cause){remember(cause)}try{sync(originalNativeRoot,'retire')}catch(cause){remember(cause)}}},
  join(){if(!retired)throw fault('DESKTOP_NATIVE_RETIRE_REQUIRED');return joining??=(async()=>{await Promise.allSettled([init,...pending]);if(linkOwner)try{await checked(linkOwner,'join')}catch(cause){remember(cause);if(!method(linkOwner,'lifetime')().joined)throw cause}if(resourcePromise)await Promise.allSettled([resourcePromise]);if(resourceOwner)await checked(resourceOwner,'join');if(continuationInventory)await checked(continuationInventory,'join');if(holds.size)throw fault('DESKTOP_NATIVE_CALLER_CHILDREN_RETAINED');await checked(originalNativeRoot,'join');joined=true})()},
  close(){return closing??=(async()=>{owner.retire();await owner.join();if(linkOwner){let error;try{await checked(linkOwner,'close')}catch(cause){error={cause}}const life=method(linkOwner,'lifetime')();if(!life.closed)throw error?.cause??fault('DESKTOP_NATIVE_LINK_CLOSE_PENDING');if(error)remember(error.cause)}if(resourceOwner)await checked(resourceOwner,'close');if(continuationInventory)await checked(continuationInventory,'close');await checked(originalNativeRoot,'close');closed=true})()},
  lifetime(){return Object.freeze({retired,joined,closed,pending:pending.size,callerHolds:holds.size,firstCausePresent:!!first})},firstCause(){return first?.cause}
 });
 init=Promise.resolve().then(async()=>{rootCurrent();scope=method(originalNativeRoot,'readOriginalScopeDATA')();authority=method(originalNativeRoot,'readOriginalAuthorityBindingDATA')();callerScope=inspectOriginalDesktopCallerResourceDATA(canonicalJSON(method(originalNativeRoot,'readOriginalCallerRegistrationDATA')()),scope);rootCurrent();
  const profile=method(originalNativeRoot,'readOriginalLINKRegistrationDATA')(),modulePath=method(originalNativeRoot,'readOriginalLINKModulePath')();rootCurrent();
  // Root has protected and pinned the entire independent LINK code closure,
  // including its OWN caller.node, before this fixed normal require.
  const link=createRequire(import.meta.url)(modulePath);rootCurrent();const acquired=await method(link,'openTaskGrantInboundTransportForOriginalBootstrap')(profile,(req,res)=>track(Promise.resolve().then(()=>handler(req,res))));linkOwner=acquired?.owner;
  if(retired&&linkOwner)sync(linkOwner,'retire');if(!acquired||typeof acquired.errorPresent!=='boolean')throw fault('DESKTOP_NATIVE_LINK_ACQUIRE_STATUS');if(acquired.errorPresent)throw acquired.error;if(!linkOwner)throw fault('DESKTOP_NATIVE_LINK_OWNER_REQUIRED');alive();rootCurrent();server=method(linkOwner,'registeredServer')();if(!server)throw fault('DESKTOP_NATIVE_LINK_SERVER_REQUIRED');
 }).catch(cause=>{remember(cause);throw cause});init.catch(()=>{});
 return owner;
}
