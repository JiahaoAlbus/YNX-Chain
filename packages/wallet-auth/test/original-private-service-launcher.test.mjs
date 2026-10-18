import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonicalJSON,WalletAuthError} from '../src/canonical.js';
import {decodeOriginalWalletServicePrivateRequest} from '../src/original-wallet-service-private-dispatch.js';
import {beginOriginalWalletPrivateServiceAcquisition,openOriginalWalletPrivateServiceAfterListen,closeOriginalWalletPrivateServiceAcquisition,originalWalletPrivateServiceAcquisitionStatus} from '../scripts/original-wallet-private-service-launcher.mjs';

const packet=id=>canonicalJSON({requestId:id,operation:'beginYNX',phase:'time',body:null,proofHeader:null});
const response=id=>({status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-request-id':id},body:canonicalJSON({ok:true,requestId:id,result:{PUBLIC_TRANSPORT_ONLY_NOT_A_GRANT:true},schemaVersion:2})});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// PUBLIC Native, Source, dispatch and timer instruments. Execute the actual
// launcher/pump unchanged. These controls cannot supply a production owner,
// grant, Native ACK, protected resource or installed private session.
function fixture({reads=[],writes=[undefined],readyFailure=false,acquireThrows=false,retireThrows=false}={}){
 const host={},runtime={},owner={},timers=new Map(),dispatchAcqs=new WeakMap(),calls={load:0,acquire:0,read:0,write:0,dispatch:0,ack:0,nativeRetire:0,nativeJoin:0,nativeClose:0,delegatedClose:0},events=[];
 let next=1,alive=true,currentResult=null,terminal=false,lowerClosing;
 const native={
  acquireOriginalNativePrivateServiceOwner(){assert.equal(arguments.length,0);calls.acquire++;if(acquireThrows)throw undefined;return owner;},
  assertOriginalNativePrivateServiceOwnerReady(got){assert.equal(got,owner);if(readyFailure)throw false;if(!alive)throw undefined;},
  readOriginalNativePrivateServiceRequest(got){assert.equal(got,owner);calls.read++;events.push('read');return reads.length?reads.shift():null;},
  writeOriginalNativePrivateServiceResponse(got,raw){assert.equal(got,owner);assert(terminal);calls.write++;events.push(['write',raw]);return writes.length?writes.shift():undefined;},
  retireOriginalNativePrivateServiceOwner(){calls.nativeRetire++;if(retireThrows)throw undefined;},
  joinOriginalNativePrivateServiceOwner(){calls.nativeJoin++;},
  closeOriginalNativePrivateServiceOwner(){calls.nativeClose++;},
 };
 const dispatcher={
  async dispatch(raw){calls.dispatch++;events.push('dispatch');const input=decodeOriginalWalletServicePrivateRequest(raw);currentResult=response(input.requestId);terminal=false;return currentResult;},
  acknowledge(_operation,_phase,id,digest){assert.equal(currentResult.headers['x-request-id'],id);assert.equal(digest,createHash('sha256').update(canonicalJSON(currentResult)).digest('hex'));calls.ack++;events.push('ack');terminal=true;},
  selectCurrentOutcome(){if(!alive)throw undefined;return{result:currentResult,unknown:!terminal,terminal};},retire(){},async join(){},
 };
 const context={URL,Buffer,fileURLToPath,createHash,canonicalJSON,WalletAuthError,Promise,
  assertOriginalWalletRuntimeObserverLifetime(got,selectedHost){if(got!==runtime||selectedHost!==host||!alive)throw undefined;},
  createRequire:()=>target=>{assert.equal(target,'/PUBLIC/apps/wallet-desktop/native/original-auth-identity.node');calls.load++;return native;},
  setTimeout(fn,ms){assert.equal(ms,25);const id=next++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
  decodeOriginalWalletServicePrivateRequest,
  beginOriginalWalletServicePrivateDispatchAcquisition(){const ref={};dispatchAcqs.set(ref,{captured:false,closed:false});return ref;},
  createOriginalWalletServicePrivateDispatch(gotHost,gotRuntime,gotOwner,acq){assert.equal(gotHost,host);assert.equal(gotRuntime,runtime);assert.equal(gotOwner,owner);dispatchAcqs.get(acq).captured=true;return dispatcher;},
  originalWalletServicePrivateDispatchAcquisitionStatus(acq){return{captured:dispatchAcqs.get(acq).captured,unknown:false,businessFailurePresent:false,cleanupFailurePresent:false};},
  closeOriginalWalletServicePrivateDispatchAcquisition(acq){if(lowerClosing)return lowerClosing;lowerClosing=Promise.resolve().then(()=>{dispatchAcqs.get(acq).closed=true;calls.delegatedClose++;});return lowerClosing;},
 };
 vm.createContext(context);const source=readFileSync(new URL('../scripts/original-wallet-private-service-launcher.mjs',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify('file:///PUBLIC/packages/wallet-auth/scripts/original-wallet-private-service-launcher.mjs'));
 vm.runInContext(source+';this.api={begin:beginOriginalWalletPrivateServiceAcquisition,open:openOriginalWalletPrivateServiceAfterListen,close:closeOriginalWalletPrivateServiceAcquisition,status:originalWalletPrivateServiceAcquisitionStatus};',context);
 const acq=context.api.begin();let control;
 return{calls,events,timers,acq,open(){control=context.api.open(host,runtime,acq);return control;},close:()=>context.api.close(acq),status:()=>context.api.status(acq),invalidate(){alive=false;},async step(){const entry=timers.entries().next().value;assert(entry,'no duplicate/restarted polling expected');timers.delete(entry[0]);entry[1]();await tick();},get control(){return control;}};
}
test('actual normal entry refuses a forged runtime before loading or acquiring Native custody',async()=>{
 const acq=beginOriginalWalletPrivateServiceAcquisition();assert.throws(()=>openOriginalWalletPrivateServiceAfterListen({},Object.freeze({status:()=>({configured:true,entered:true})}),acq),{code:'ORIGINAL_RUNTIME_LIFETIME_REQUIRED'});
 const status=originalWalletPrivateServiceAcquisitionStatus(acq);assert.equal(status.captured,false);assert.equal(status.unknown,false);await closeOriginalWalletPrivateServiceAcquisition(acq);assert.equal(originalWalletPrivateServiceAcquisitionStatus(acq).cleanupComplete,true);
});
test('normal pump retains idle/partial writes, dispatches and ACKs once, and closes through one owner',async()=>{
 const raw=packet('req_PUBLIC_PUMP_000001'),f=fixture({reads:[null,raw],writes:[null,undefined]}),control=f.open();await f.step();assert.equal(f.calls.dispatch,0);await f.step();assert.equal(f.calls.dispatch,1);assert.equal(f.calls.ack,1);assert.equal(f.calls.write,1);assert.equal(f.status().unknown,true);
 await f.step();assert.equal(f.calls.read,2);assert.equal(f.calls.dispatch,1);assert.equal(f.calls.ack,1);assert.equal(f.calls.write,2);assert.equal(f.status().unknown,false);assert.equal(f.events.filter(x=>Array.isArray(x))[0][1],f.events.filter(x=>Array.isArray(x))[1][1]);
 const close=control.close();assert.equal(control.close(),close);await close;assert.equal(f.calls.delegatedClose,1);assert.equal(f.calls.nativeClose,0);assert.equal(f.timers.size,0);assert.equal(f.status().cleanupComplete,true);
});
test('late Source failure after a pending write retains UNKNOWN and never re-enters or retries a new request',async()=>{
 const f=fixture({reads:[packet('req_PUBLIC_PUMP_000002')],writes:[null]});const control=f.open();await f.step();f.invalidate();await f.step();let threw=false;try{await control.whenFailed();}catch(cause){threw=true;assert.equal(cause,undefined);}assert.equal(threw,true);assert.equal(f.calls.dispatch,1);assert.equal(f.calls.ack,1);assert.equal(f.calls.write,1);assert.equal(f.status().unknown,true);assert.equal(f.timers.size,0);await f.close();assert.equal(f.status().unknown,true);
});
test('duplicate original request cannot enter a second business effect',async()=>{
 const raw=packet('req_PUBLIC_PUMP_000003'),f=fixture({reads:[raw,raw]});f.open();await f.step();await f.step();assert.equal(f.calls.dispatch,1);assert.equal(f.calls.ack,1);assert.equal(f.status().unknown,true);assert.equal(f.status().retained,1);assert.equal(f.timers.size,0);await f.close();
});
test('partial owner is captured before ready failure and every independent cleanup still runs once',async()=>{
 const f=fixture({readyFailure:true,retireThrows:true});let failed=false;try{f.open();}catch(cause){failed=true;assert.equal(cause,false);}assert.equal(failed,true);assert.equal(f.status().captured,true);
 const close=f.close();assert.equal(f.close(),close);let cleanupFailed=false;try{await close;}catch(cause){cleanupFailed=true;assert.equal(cause,undefined);}assert.equal(cleanupFailed,true);assert.equal(f.calls.nativeRetire,1);assert.equal(f.calls.nativeJoin,1);assert.equal(f.calls.nativeClose,1);assert.equal(f.calls.delegatedClose,0);assert.equal(f.status().cleanupFailurePresent,true);
});
test('an acquisition throwing without a captured partial is not assumed resource-free',async()=>{
 const f=fixture({acquireThrows:true});let failed=false;try{f.open();}catch(cause){failed=true;assert.equal(cause,undefined);}assert.equal(failed,true);assert.equal(f.status().captured,false);assert.equal(f.status().unknown,true);await assert.rejects(f.close(),{code:'ORIGINAL_PRIVATE_ACQUIRE_CUSTODY_UNKNOWN'});assert.equal(f.calls.nativeClose,0);
});
