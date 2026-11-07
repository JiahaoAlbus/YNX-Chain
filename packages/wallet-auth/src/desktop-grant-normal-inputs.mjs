// Private fixed-release normal composition. No runtime provider, ENV, path or
// context JSON can select a Source or install a release row.
import{createRequire}from'node:module';
import{OriginalDesktopGrantSourceOwner}from'./desktop-grant-source-owner.mjs';
import{openOriginalTaskAuthoritySQLite}from'./desktop-grant-sqlite-bootstrap.mjs';
import{createOriginalDesktopGrantSourceController}from'./desktop-grant-source-controller.mjs';
import{canonicalJSON}from'./canonical.js';
const reviewedOriginalDesktopAuthorityReleases=Object.freeze([]);
const fault=c=>Object.assign(Error(c),{code:c});
const method=(v,k)=>{if(typeof v?.[k]!=='function')throw fault('DESKTOP_GRANT_ORIGINAL_'+k+'_NOT_SUPPLIED');return v[k].bind(v)};
async function checked(v,k,...a){if(await method(v,k)(...a)!==undefined)throw fault('DESKTOP_GRANT_VOID_RESULT')}
let acquisition;
export async function acquireOriginalTaskGrantAuthorityInputs(){
 if(arguments.length)throw fault('GRANT_SOURCE_ZERO_INPUT_REQUIRED');
 // One normal daemon owns one original store and caller runtime. Returning
 // this same acquisition never creates a replacement for retired/UNKNOWN.
 if(acquisition)return acquisition;
 if(reviewedOriginalDesktopAuthorityReleases.length!==1)return Object.freeze({owner:null,errorPresent:true,error:fault('GRANT_PROTECTED_SOURCE_NOT_SUPPLIED')});
 acquisition=openSelectedOriginalDesktopAuthority(reviewedOriginalDesktopAuthorityReleases[0]);return acquisition;
}
// Not a public package export. Only compiled selection above calls this;
// controlled tests use an isolated source variant, not a shipped setter.
async function openSelectedOriginalDesktopAuthority(row){
 let sourceOwner,sqliteOwner,storeLoan,nativeBackend,inputs,first,retired=false,closed=false,joining,closing;
 const pending=new Set();
 const alive=()=>{if(first)throw first.cause;if(retired||closed)throw fault('DESKTOP_GRANT_AUTHORITY_RETIRED')};
 const current=async()=>{alive();await sourceOwner.current();sourceOwner.assertSnapshot();if(sqliteOwner)sqliteOwner.current();if(nativeBackend)await checked(nativeBackend,'assertCurrent');alive();sourceOwner.assertSnapshot()};
 const owner=Object.freeze({
  assertCurrent:current,
  readOriginalTaskGrantServiceInputs(){alive();sourceOwner.assertSnapshot();if(!inputs)throw fault('DESKTOP_GRANT_INPUTS_NOT_READY');return inputs},
  assertOriginalManagementAuthorityAtCommit(e){alive();sqliteOwner.current();sourceOwner.assertOriginalManagementAuthorityAtCommit(e);const r=method(nativeBackend,'assertOriginalManagementCallerAtCommit')(e.caller,e.expected);if(r!==undefined)throw fault('DESKTOP_GRANT_SYNC_FENCE_REQUIRED');sourceOwner.assertSnapshot()},
  retire(){if(!retired){retired=true;for(const p of[nativeBackend,sourceOwner])if(p)try{const r=method(p,'retire')();if(r!==undefined)throw fault('DESKTOP_GRANT_VOID_RESULT')}catch(cause){first??={cause}}}},
  join(){if(!retired)throw fault('DESKTOP_GRANT_RETIRE_REQUIRED');return joining??=(async()=>{await Promise.allSettled([...pending]);if(nativeBackend)await checked(nativeBackend,'join');if(sourceOwner)await sourceOwner.join()})()},
  close(){return closing??=(async()=>{owner.retire();await owner.join();
   // Stop at child failure. Never release DB/Source parents while the actual
   // caller/resource Native owner is ambiguous or still has child debt.
   if(nativeBackend)await checked(nativeBackend,'close');
   if(storeLoan){storeLoan.close();storeLoan=undefined}
   if(sqliteOwner){sqliteOwner.retire();sqliteOwner.join();sqliteOwner.close()}
   if(sourceOwner)await sourceOwner.close();closed=true;
  })()},isClosed(){return closed}
 });
 const start=(async()=>{try{
  sourceOwner=new OriginalDesktopGrantSourceOwner(row);await sourceOwner.initialize();
  const scope=sourceOwner.readScope();
  const callerRegistration=sourceOwner.readOriginalCallerRegistrationDATA();
  if(!row.store||row.store.resourceRef!==scope.storeResourceRef||row.store.namespace!==scope.storeNamespace||row.callerResourceRef!==scope.callerResourceRef)throw fault('DESKTOP_GRANT_ROOT_RESOURCE_MISMATCH');
  // Whole image is independently Source-signed postbuild metadata and held
  // before the one fixed require. It is not compiled into its own image.
  const image=sourceOwner.holdNativeBackend(),exports=createRequire(import.meta.url)(image);
  const capture=method(exports,'acquireOriginalTaskGrantAuthorityBackendV1');
  const acquired=capture();nativeBackend=acquired?.owner; // partial first
  if(!acquired||typeof acquired.errorPresent!=='boolean')throw fault('DESKTOP_GRANT_NATIVE_ACQUIRE_STATUS');
  if(acquired.errorPresent)throw acquired.error;
  if(!nativeBackend)throw fault('DESKTOP_GRANT_NATIVE_BACKEND_NOT_SUPPLIED');
  await current();
  const actual=await method(nativeBackend,'readOriginalAuthorityBindingDATA')();await current();
  const expected={sourceId:scope.sourceId,instanceId:scope.instanceId,authorityRef:scope.authorityRef,issuerAccount:scope.issuerAccount,issuerEpoch:scope.issuerEpoch,storeNamespace:scope.storeNamespace,storeResourceRef:scope.storeResourceRef,callerResourceRef:scope.callerResourceRef};
  if(canonicalJSON(actual)!==canonicalJSON(expected))throw fault('DESKTOP_GRANT_NATIVE_SAME_SOURCE_REQUIRED');
  const actualCaller=await method(nativeBackend,'readOriginalCallerRegistrationDATA')();await current();
  if(canonicalJSON(actualCaller)!==canonicalJSON(callerRegistration))throw fault('DESKTOP_GRANT_NATIVE_CALLER_REGISTRATION_MISMATCH');
  const opened=openOriginalTaskAuthoritySQLite({path:row.store.path,namespace:row.store.namespace,identity:row.store.identity},sourceOwner);sqliteOwner=opened.owner;
  if(opened.errorPresent)throw opened.error;
  storeLoan=sqliteOwner.borrowOriginalAuthorityStore();await current();
  const controller=createOriginalDesktopGrantSourceController(sourceOwner,storeLoan.store,nativeBackend,row.node);
  const registeredTaskExecutors=await method(nativeBackend,'readOriginalRegisteredTaskExecutors')();await current();
  if(!Array.isArray(registeredTaskExecutors)||registeredTaskExecutors.length>64)throw fault('DESKTOP_GRANT_REGISTERED_EXECUTORS_REQUIRED');
  inputs=Object.freeze({...controller,store:storeLoan.store,registeredTaskExecutors:Object.freeze([...registeredTaskExecutors])});await current();
  return Object.freeze({owner,errorPresent:false,error:null});
 }catch(cause){first={cause};return Object.freeze({owner,errorPresent:true,error:cause})}})();
 pending.add(start);try{return await start}finally{pending.delete(start)}
}
