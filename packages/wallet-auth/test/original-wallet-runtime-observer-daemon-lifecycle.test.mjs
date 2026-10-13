import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createServer,Server} from 'node:http';
import {EventEmitter} from 'node:events';
const read=path=>readFileSync(process.env.PUBLIC_R6_PARENT_RED==='1'?new URL(path,new URL('file:///Users/huangjiahao/ynx-social-qa-authority/wallet-original-service-observer-held-partial-repair-r5-20261013/source/packages/wallet-auth/test/')):new URL(path,import.meta.url),'utf8');
// Exact PUBLIC lexical Host/daemon/lifetime bodies. State/crypto/protected
// sources are stand-ins. Real Server objects NEVER listen or open a network.
const hostText=read('../src/product-session-gateway-node-host.js');
const observerText=read('../src/original-wallet-service-runtime-observer.js');
const launcherText=read('../scripts/original-wallet-runtime-observer-launcher.mjs');
const daemonText=read('../scripts/ynx-wallet-gatewayd.mjs');
const admissionText=read('../src/gateway-admission.js');
const clean=text=>text.replace(/^import .*;$/mg,'').replace(/^import \{[\s\S]*?\} from .*;$/mg,'').replaceAll('export ','');
function composeOriginalPrivateAcquisition(context){
 // Real module inventory and cleanup contract in an isolated lexical closure.
 // Native stays fixed null; no successful-cleanup or approving provider stub.
 const text=read('../src/original-wallet-service-private-dispatch.js');
 context.WalletAuthError??=class extends Error{constructor(code,message){super(message);this.code=code;}};
 vm.runInContext('this.PUBLIC_PRIVATE_API=(()=>{'+clean(text)+'\nreturn {begin:beginOriginalWalletServicePrivateDispatchAcquisition,close:closeOriginalWalletServicePrivateDispatchAcquisition,status:originalWalletServicePrivateDispatchAcquisitionStatus,factory:createOriginalWalletServicePrivateDispatch};})();',context);
 Object.assign(context,{beginOriginalWalletServicePrivateDispatchAcquisition:context.PUBLIC_PRIVATE_API.begin,closeOriginalWalletServicePrivateDispatchAcquisition:context.PUBLIC_PRIVATE_API.close,originalWalletServicePrivateDispatchAcquisitionStatus:context.PUBLIC_PRIVATE_API.status});
 const ref=context.PUBLIC_PRIVATE_API.begin();assert.throws(()=>context.PUBLIC_PRIVATE_API.status({}),/unavailable/);
 assert.equal(context.PUBLIC_PRIVATE_API.status(ref).captured,false);
 assert.throws(()=>context.PUBLIC_PRIVATE_API.factory({}, {}, {},ref),error=>error.code==='ORIGINAL_PRIVATE_NATIVE_BINDING_NOT_IMPLEMENTED');
 assert.equal(context.PUBLIC_PRIVATE_API.status(ref).captured,false);
}
function composeOriginalAcquisition(context){
 const start=observerText.indexOf('const acquisitionOwners='),end=observerText.indexOf('\nlet activeObserver=',start);
 if(start<0)return; // Exact historical parent comparator has no such ABI.
 vm.runInContext(clean(observerText.slice(start,end))+'\nthis.PUBLIC_recordAcquisition=(ref,observer)=>{const state=acquisitionOwned(ref);if(state.entered)throw Error("PUBLIC_ALREADY_ENTERED");state.entered=true;state.observer=observer;state.settled=true;};',context);
}
function r5HeldFixture({acquisitionCause,acquisitionFail=false,closeCause,closeFail=false,failAfterRead=false,onClose=()=>{}}={}){
 const text=observerText,start=text.indexOf('function disposeHeld('),end=text.indexOf('\nfunction rejectReentry(',start),creatorStart=text.indexOf('export function createOriginalWalletServiceRuntimeObserver('),creatorEnd=text.indexOf('\nexport function assertOriginalWalletServiceRuntimeObserver(',creatorStart);
 const descriptors=[],disposed=[],debt=new Set(),raw=Buffer.from('PUBLIC_EXACT_RAW');let checks=0;
 const context={Buffer,unresolvedObserverCustody:debt,isAbsolute:p=>p.startsWith('/'),normalize:p=>p,dirname:p=>p==='/PUBLIC/item'?'/PUBLIC':'/',digest:v=>v==='PUBLIC_DIGEST',constants:{O_RDONLY:1,O_NOFOLLOW:2,O_DIRECTORY:4},
  safe:()=>{},stamp:s=>String(s.id),bytes:()=>raw,sha:()=> 'PUBLIC_DIGEST',
  lstatSync:p=>{checks++;if(failAfterRead&&checks>3)throw acquisitionCause;return {id:p};},
  openSync:p=>{const fd={PUBLIC_FD:p,index:descriptors.length};descriptors.push(fd);return fd;},
  fstatSync:fd=>{if(acquisitionFail&&fd.index===1)throw acquisitionCause;return {id:fd.PUBLIC_FD};},
  closeSync:fd=>{disposed.push(fd);onClose(fd);if(closeFail&&fd.index===1)throw closeCause;},
  rejectReentry:()=>{},fail:code=>{throw Error(code);},
 };
 vm.createContext(context);composeOriginalAcquisition(context);vm.runInContext(text.slice(start,end)+'\n'+text.slice(creatorStart,creatorEnd).replace('export ','')+'\nthis.api={held,disposeHeld,createOriginalWalletServiceRuntimeObserver};',context);
 return {api:context.api,descriptors,disposed,debt,raw};
}
test('R5 PUBLIC actual held early failure retains every exact acquired FD and falsy causes before outer push',()=>{
 for(const first of [false,null,undefined,Error('PUBLIC_ACQUIRE')])for(const cleanup of [false,null,undefined]){
  const f=r5HeldFixture({acquisitionFail:true,acquisitionCause:first,closeFail:true,closeCause:cleanup});let rejected=false;
  try{f.api.held('/PUBLIC/item','PUBLIC_DIGEST');}catch(error){rejected=true;assert.equal(error,first);}assert.equal(rejected,true);
  assert.equal(f.descriptors.length,2);assert.equal(f.debt.size,1);const custody=[...f.debt][0];assert.equal(custody.firstCausePresent,true);assert.equal(custody.firstCause,first);assert.equal(custody.cleanupFailurePresent,true);assert.equal(custody.cleanupCause,cleanup);assert.equal(custody.rows[1].fd,f.descriptors[1]);assert.equal(custody.rows[0].fd,f.descriptors[0]);
  assert.deepEqual(f.disposed,[f.descriptors[1],f.descriptors[0]]);
  let failed=false;try{f.api.disposeHeld(custody);}catch(error){failed=true;assert.equal(error,cleanup);}assert.equal(failed,true);assert.equal(f.disposed.length,2);
  assert.throws(()=>f.api.createOriginalWalletServiceRuntimeObserver({}),/CLEANUP_UNRESOLVED/);
 }
});
test('R5 PUBLIC actual held late source check retains original raw/source and once failed cleanup',()=>{
 const first=Error('PUBLIC_LATE_CHECK'),f=r5HeldFixture({failAfterRead:true,acquisitionCause:first,closeFail:true,closeCause:undefined});
 assert.throws(()=>f.api.held('/PUBLIC/item','PUBLIC_DIGEST'),error=>error===first);
 const custody=[...f.debt][0];assert.equal(custody.raw,f.raw);assert.equal(custody.source.raw,'PUBLIC_EXACT_RAW');assert.equal(custody.rows.length,3);assert.equal(custody.firstCause,first);assert.equal(custody.cleanupFailurePresent,true);
 let rejected=false;try{custody.source.close();}catch(error){rejected=true;assert.equal(error,undefined);}assert.equal(rejected,true);assert.equal(f.disposed.length,3);assert.throws(()=>custody.source.check(),/UNAVAILABLE/);
});
test('R5 PUBLIC successful partial disposal keeps acquisition failure but creates no false debt',()=>{
 for(const first of [false,null,undefined]){
  const f=r5HeldFixture({acquisitionFail:true,acquisitionCause:first});let rejected=false;try{f.api.held('/PUBLIC/item','PUBLIC_DIGEST');}catch(error){rejected=true;assert.equal(error,first);}assert.equal(rejected,true);assert.equal(f.debt.size,0);assert.equal(f.disposed.length,2);
 }
 const normal=r5HeldFixture(),source=normal.api.held('/PUBLIC/item','PUBLIC_DIGEST');assert.equal(source.raw,'PUBLIC_EXACT_RAW');assert.equal(normal.debt.size,0);source.close();source.close();assert.equal(normal.disposed.length,3);assert.throws(()=>source.check(),/UNAVAILABLE/);
});
test('R5 PUBLIC exact held disposal reservation rejects synchronous reentry without false completion',()=>{
 let source,reentries=0;const f=r5HeldFixture({onClose(){reentries++;assert.throws(()=>source.close(),/CLEANUP_INFLIGHT/);}});source=f.api.held('/PUBLIC/item','PUBLIC_DIGEST');assert.equal(source.close(),undefined);assert.equal(reentries,3);assert.equal(f.disposed.length,3);assert.equal(source.close(),undefined);assert.equal(f.disposed.length,3);
});
// New integrated R6 chain. Actual daemon + launcher + observer acquisition/
// close bodies share one VM. Only qualified source/FS/crypto/server primitives
// are PUBLIC stand-ins. No real service listener, protection file or key.
function r6DaemonFixture({selected=false,failedAcquisition=false,cleanupFail=false,firstCause=Error('PUBLIC_ACQUIRE'),cleanupCause=undefined,httpFail=false,httpCause=false}={}){
 const context={URL,Buffer,Date,HTTPServer:Server,NetServer:class{get listening(){return true;}address(){return {address:'127.0.0.1',port:1};}},EventEmitter,
  types:{isProxy:()=>false},process:{getuid:()=>1,on(){},exit(){}},constants:{O_RDONLY:1,O_NOFOLLOW:2,O_DIRECTORY:4},isAbsolute:p=>p.startsWith('/'),dirname:p=>p==='/PUBLIC/root'?'/PUBLIC':'/',normalize:p=>p,
  WalletAuthError:class extends Error{constructor(code,message){super(message);this.code=code;}},canonicalJSON:JSON.stringify,
  createHash:()=>({update(){return this;},digest(){return 'a'.repeat(64);}}),
  PUBLIC_FIRST:firstCause,PUBLIC_CLEANUP:cleanupCause,
 };const fds=[],closes=[];
 context.lstatSync=p=>({dev:1,ino:p,mode:0o600,uid:1,nlink:1,size:1,mtimeMs:0,ctimeMs:0,isFile:()=>true,isDirectory:()=>true});
 context.openSync=p=>{const fd={p,index:fds.length};fds.push(fd);return fd;};context.fstatSync=fd=>{if(fd.index===1)throw firstCause;return context.lstatSync(fd.p);};context.closeSync=fd=>{closes.push(fd);if(cleanupFail&&fd.index===1)throw cleanupCause;};
 vm.createContext(context);
 vm.runInContext(clean(observerText),context);
 if(selected&&!failedAcquisition){
  // Simulate only admitted acquisition's returned resource; real close and
  // same-operation wrapper/lifetime accounting remain actual source bodies.
  context.PUBLIC_RETURNED=new EventEmitter();context.PUBLIC_CLOSE_FAIL=cleanupFail;
  vm.runInContext('function acquireOriginalWalletServiceRuntimeObserver(input,acquisition){const result=Object.freeze({});observers.set(result,{server:PUBLIC_RETURNED,event(){},files:[{close(){if(PUBLIC_CLOSE_FAIL)throw PUBLIC_CLEANUP;}}],active:false});if(acquisition)acquisition.observer=result;return result;}\nfunction assertOriginalWalletServiceRuntimeObserver(){}',context);
  if(process.env.PUBLIC_R6_PARENT_RED==='1')vm.runInContext('function createOriginalWalletServiceRuntimeObserver(){return acquireOriginalWalletServiceRuntimeObserver({});}',context);
 }
 context.captureOriginalRecoveryJSON=v=>v;context.exactFields=()=>{};
 vm.runInContext('this.originalWalletRuntimeObserverSelection='+ (selected?'({instanceSource:{rootPath:"/PUBLIC/root",rootDigest:"'+ 'a'.repeat(64)+'",instancePath:"/PUBLIC/instance",instanceDigest:"'+ 'a'.repeat(64)+'",gatewayManifestPath:"/PUBLIC/manifest",gatewayManifestDigest:"'+ 'a'.repeat(64)+'",registryPath:"/PUBLIC/registry",registryFileDigest:"'+ 'a'.repeat(64)+'"},roleBinding:{keyId:"PUBLIC",roleDigest:"'+ 'a'.repeat(64)+'",registryDigest:"'+ 'a'.repeat(64)+'"}})':'null')+';',context);
 vm.runInContext(clean(launcherText),context);
 const server=new EventEmitter(),signals=new Map(),events=[],exit=[];let listeningCallback,stopCount=0;
 const originalListener=(_request,response)=>{response.writeHead(200,{});response.end('PUBLIC_BUSINESS');};server.on('request',originalListener);server.listening=false;
 server.listen=(_port,_address,fn)=>{listeningCallback=fn;};server.close=fn=>{stopCount++;server.listening=false;if(httpFail)throw httpCause;fn();};
 Object.assign(context,{host:{handler:()=>()=>{}},productHost:{handler:()=>()=>{},createOriginalWalletServiceRuntimeDaemonServer:()=>server,captureOriginalWalletServiceRuntimeSource:()=>({PUBLIC:true})},central:null,admission:{},productSessionStateVersion:'2',emitEvent:event=>events.push(event),port:1,address:'127.0.0.1',build:null,remoteDeployed:false,
  process:{getuid:()=>1,on:(name,fn)=>signals.set(name,fn),exit:code=>exit.push(code)},setTimeout,clearTimeout});
 const start=daemonText.indexOf('const legacyHandler='),end=daemonText.indexOf('\nfunction integer(',start);
 composeOriginalPrivateAcquisition(context);vm.runInContext(daemonText.slice(start,end)+'\nthis.life=originalRuntimeLifetime;',context);
 return {context,server,events,exit,closes,fds,listen(){server.listening=true;listeningCallback();},signal(){signals.get('SIGTERM')();signals.get('SIGINT')();},stopCount:()=>stopCount,async settled(){await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));}};
}
test('R6 PUBLIC integrated listen failure with no observer emits bounded failed start and nonzero',async()=>{
 const f=r6DaemonFixture();f.server.emit('error',Error('PUBLIC_SECRET_MUST_NOT_LOG'));await f.settled();assert.equal(f.context.process.exitCode,1);assert.deepEqual(f.exit,[1]);assert.equal(f.stopCount(),1);assert.equal(f.events.some(e=>e.event==='startup_failed'),true);assert.equal(JSON.stringify(f.events).includes('PUBLIC_SECRET'),false);
});
test('R6 PUBLIC integrated failed-before-return holds same acquisition debt; HTTP stops despite undefined cleanup failure',async()=>{
 const f=r6DaemonFixture({selected:true,failedAcquisition:true,cleanupFail:true,firstCause:false,cleanupCause:undefined});f.listen();assert.equal(f.fds.length,2);assert.equal(f.closes.length,2);
 f.signal();await f.settled();assert.equal(f.stopCount(),1);assert.equal(f.context.life.status().cleanupFailurePresent,true);assert.equal(f.context.process.exitCode,1);assert.equal(f.exit.length,0);
 const res=response();f.server.emit('request',request('/health'),res);assert.equal(res.status,503);const originalCloses=f.closes.length;f.signal();await f.settled();assert.equal(f.stopCount(),1);assert.equal(f.closes.length,originalCloses);
 assert.equal(f.events.some(e=>e.event==='shutdown_incomplete'&&e.observerCleanupFailurePresent),true);
});
test('R6 PUBLIC integrated failed acquisition with completed cleanup remains failure not false resource debt',async()=>{
 const f=r6DaemonFixture({selected:true,failedAcquisition:true,firstCause:null});f.listen();assert.equal(f.context.life.status().firstCausePresent,true);assert.equal(f.closes.length,2);f.signal();await f.settled();assert.equal(f.stopCount(),1);assert.equal(f.context.life.status().cleanupFailurePresent,false);assert.deepEqual(f.exit,[0]);
});
test('R6 PUBLIC integrated returned observer failure and secondary HTTP failure retain independent once outcomes',async()=>{
 const f=r6DaemonFixture({selected:true,cleanupFail:true,cleanupCause:false,httpFail:true,httpCause:undefined});f.listen();f.signal();await f.settled();assert.equal(f.stopCount(),1);assert.equal(f.context.life.status().cleanupFailurePresent,true);assert.equal(f.exit.length,0);assert.equal(f.context.process.exitCode,1);assert.equal(f.events.some(e=>e.httpStopFailurePresent&&e.observerCleanupFailurePresent),true);f.signal();await f.settled();assert.equal(f.stopCount(),1);
});
function hostFixture({overrideHandler=false}={}){
 let tampered=false;const events=[];
 const context={URL,Buffer,Date,createServer,dirname:()=>'/PUBLIC',isAbsolute:()=>true,WalletAuthError:class extends Error{constructor(code,message){super(message);this.code=code;}},
  canonicalJSON:JSON.stringify,exactFields:()=>{},parseProductSessionRegistry:v=>v,createHash:()=>({update(){return this;},digest(){return 'PUBLIC_DIGEST';}}),
  PUBLIC_STATE:()=>({snapshot:{PUBLIC:true},identity:{dev:1,ino:1,size:1,digest:tampered?'changed':'same'}}),
  ProductSessionGatewayHttpHandler:class{snapshot(){return {PUBLIC:true};}},
  CanonicalWalletGatewayNodeHost:class{#owned=true;handler(){assert.equal(this.#owned,true);return (_req,res)=>{res.writeHead(200,{});res.end('PUBLIC_LEGACY');};}},
  CentralBrowserSessionNodeRoutes:class{handles(path){return path==='/PUBLIC/central';}handle(){return {status:200,headers:{},body:'PUBLIC_CENTRAL'};}},
  WALLET_SESSION_CONTROL_PATHS:[],WALLET_SESSION_CONTROL_PROOF_HEADER:'PUBLIC',PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION:2,walletSessionControlClockFloor:()=>0,
 };
 vm.createContext(context);vm.runInContext(clean(admissionText)+'\nthis.Admission=GatewayAdmissionController;',context);
 vm.runInContext(clean(hostText)+'\nfunction loadState(){return PUBLIC_STATE();}\nthis.Host=ProductSessionGatewayNodeHost;this.Legacy=CanonicalWalletGatewayNodeHost;this.Central=CentralBrowserSessionNodeRoutes;this.capture=captureOriginalWalletServiceRuntimeHostSource;',context);
 const host=new context.Host({products:[]},{now:()=>new Date(1000),statePath:'/PUBLIC/state',tokenFactory:()=>''}),admission=new context.Admission({maxConcurrent:1});
 if(overrideHandler)host.handler=()=>{throw Error('PUBLIC_ARBITRARY_HANDLER_MUST_NOT_ENTER');};
 const server=host.createOriginalWalletServiceRuntimeDaemonServer({legacyHost:new context.Legacy(),central:new context.Central(),admission,emitEvent:event=>events.push(event)});
 const source=host.captureOriginalWalletServiceRuntimeSource();
 return {context,host,server,source,admission,events,tamper(){tampered=true;}};
}
function response(){const value=new EventEmitter();value.headersSent=false;value.writeHead=(status,headers)=>{value.status=status;value.headers=headers;value.headersSent=true;};value.end=body=>{value.body=body;value.emit('finish');};return value;}
const request=url=>({url,method:'GET',headers:{},socket:{remoteAddress:'127.0.0.1'}});
test('R4 PUBLIC actual Host owns exact admission-wrapper Server, legacy/central routes and throttle',async()=>{
 const f=hostFixture(),view=f.context.capture(f.source);assert.equal(view.server,f.server);assert.equal(f.server.listenerCount('request'),1);assert.equal(f.server.listeners('request')[0],view.handler);
 for(const [url,body] of [['/health','PUBLIC_LEGACY'],['/PUBLIC/central','PUBLIC_CENTRAL']]){const res=response();f.server.emit('request',request(url),res);await Promise.resolve();assert.equal(res.status,200);assert.equal(res.body,body);}
 const held=f.admission.enter('127.0.0.1'),res=response();f.server.emit('request',request('/health'),res);assert.equal(res.status,503);held.release();
 assert.throws(()=>f.host.createOriginalWalletServiceRuntimeDaemonServer({}),/already exists/);
 assert.throws(()=>f.context.capture({}),/unavailable/);f.tamper();assert.throws(()=>f.context.capture(f.source),/identity changed/);
});
test('R4 PUBLIC v2 dispatch uses private actual Host handler rather than public handler override',async()=>{
 const f=hostFixture({overrideHandler:true}),res=response(),req=request('/v2/product-sessions/time');req.headers['x-request-id']='req_PUBLIC_request_001';
 f.server.emit('request',req,res);await new Promise(resolve=>setImmediate(resolve));assert.equal(res.status,200);assert.equal(JSON.parse(res.body).result.serverTime,'1970-01-01T00:00:01.000Z');assert.equal(f.events.length,0);
});
test('R4 PUBLIC observer exact current body rejects replaced/extra listener and different owned Server',()=>{
 const f=hostFixture(),view=f.context.capture(f.source),context={HTTPServer:Server,types:{isProxy:()=>false},listening:function(){return true;},listeners:EventEmitter.prototype.rawListeners,address:function(){return {address:'127.0.0.1',port:1};},captureOriginalWalletServiceRuntimeHostSource:f.context.capture,fail:code=>{throw Error(code);}};
 const start=observerText.indexOf('function serverCurrent('),end=observerText.indexOf('\n}',start)+2;vm.createContext(context);vm.runInContext(observerText.slice(start,end)+'\nthis.check=serverCurrent;',context);
 const state={server:f.server,host:view,hostSource:f.source,body:{bindAddress:'127.0.0.1',bindPort:1}};context.check(state);
 f.server.on('request',()=>{});assert.throws(()=>context.check(state),/HANDLER_MISMATCH/);f.server.removeAllListeners('request');f.server.on('request',view.handler);context.check(state);
 const other=createServer(view.handler);assert.throws(()=>context.check({...state,server:other}),/SOURCE_CHANGED/);
});
test('R4 PUBLIC original observer close body preserves falsy failure and never retries files',()=>{
 const start=observerText.indexOf('export function closeOriginalWalletServiceRuntimeObserver('),text=observerText.slice(start).replace('export ','');
 for(const cause of [false,null,undefined]){
  let closes=0;const observer={},state={server:new EventEmitter(),files:[{close(){closes++;throw cause;}}],event(){},active:false};
  const context={owned:value=>{assert.equal(value,observer);return state;},remove:EventEmitter.prototype.removeListener,fail:code=>{throw Error(code);}};
  vm.createContext(context);vm.runInContext(text+'\nthis.close=closeOriginalWalletServiceRuntimeObserver;',context);
  for(let n=0;n<2;n++){let rejected=false;try{context.close(observer);}catch(error){rejected=true;assert.equal(error,cause);}assert.equal(rejected,true);}
  assert.equal(closes,1);assert.equal(state.cleanupFailed,true);assert.notEqual(state.closed,true);
 }
});
function lifetimeFixture({selected=true,late=false,cleanupCause,cleanupFail=false}={}){
 const original=Object.freeze({PUBLIC_ORIGINAL:true});let closes=0,creates=0;let lifetime;
 const host={captureOriginalWalletServiceRuntimeSource:()=>({PUBLIC_HOST:true})},server={PUBLIC_SERVER:true};
 const context={originalWalletRuntimeObserverSelection:selected?{instanceSource:{},roleBinding:{}}:null,captureOriginalRecoveryJSON:v=>v,exactFields:()=>{},
  createOriginalWalletServiceRuntimeObserver:(input,acquisition)=>{creates++;assert.equal(input.server,server);if(context.PUBLIC_recordAcquisition)context.PUBLIC_recordAcquisition(acquisition,original);if(late)lifetime.retire(false);return original;},
  assertOriginalWalletServiceRuntimeObserver:value=>assert.equal(value,original),captureOriginalWalletServiceRuntimeObservation:(value,sequence)=>{assert.equal(value,original);return {sequence};},assertOriginalWalletServiceRuntimeObservationCurrent:value=>assert.equal(value,original),
  closeOriginalWalletServiceRuntimeObserver:value=>{assert.equal(value,original);closes++;if(cleanupFail)throw cleanupCause;},
 };
 context.fail=code=>{throw Error(code);};vm.createContext(context);composeOriginalAcquisition(context);vm.runInContext(clean(launcherText)+'\nthis.create=createOriginalWalletRuntimeObserverLifetime;',context);lifetime=context.create(host,server);
 return {lifetime,host,server,context,creates:()=>creates,closes:()=>closes};
}
test('R4 PUBLIC lifecycle acquires once after listen, captures exact late original and same close',async()=>{
 const f=lifetimeFixture();assert.equal(f.lifetime.afterListen(),undefined);assert.equal(f.creates(),1);assert.equal(f.lifetime.capture(1).sequence,1);assert.throws(()=>f.lifetime.afterListen(),/unavailable/);
 f.lifetime.retire();assert.throws(()=>f.lifetime.capture(2),/unavailable/);await f.lifetime.join();const close=f.lifetime.close();assert.equal(f.lifetime.close(),close);await close;assert.equal(f.closes(),1);
 const late=lifetimeFixture({late:true});assert.throws(()=>late.lifetime.afterListen(),/unavailable/);assert.equal(late.lifetime.status().firstCausePresent,true);await late.lifetime.close();assert.equal(late.closes(),1);
});
test('R4 PUBLIC missing selection stays absent; unsupported v3 Host refuses only configured observer',async()=>{
 const missing=lifetimeFixture({selected:false});assert.equal(missing.lifetime.afterListen(),null);assert.equal(missing.creates(),0);await missing.lifetime.close();assert.equal(missing.closes(),0);
 const unsupported=lifetimeFixture();delete unsupported.host.captureOriginalWalletServiceRuntimeSource;assert.throws(()=>unsupported.lifetime.afterListen(),/unavailable/);assert.equal(unsupported.creates(),0);await unsupported.lifetime.close();
});
test('R4 PUBLIC cleanup falsy cause preserves exact observer, same failed pass and no retry',async()=>{
 for(const cause of [false,null,undefined]){const f=lifetimeFixture({cleanupFail:true,cleanupCause:cause});f.lifetime.afterListen();const close=f.lifetime.close();let rejected=false;try{await close;}catch(error){rejected=true;assert.equal(error,cause);}assert.equal(rejected,true);assert.equal(f.lifetime.close(),close);assert.equal(f.closes(),1);assert.equal(f.lifetime.status().configured,true);assert.equal(f.lifetime.status().cleanupFailurePresent,true);}
});
test('R4 PUBLIC exact daemon normal listener invokes lifecycle and joins before signal shutdown',async()=>{
 const f=hostFixture(),events=[],signals=new Map();let listen,exit=0,joined=0,closed=0;
 f.server.listen=(_port,_address,callback)=>{listen=callback;};f.server.close=callback=>{events.push('server-close');callback();};
 const life={afterListen(){events.push('after-listen');},retire(){events.push('retire');},join(){joined++;events.push('join');return Promise.resolve();},close(){closed++;events.push('close');return Promise.resolve();}};
 const context={host:new f.context.Legacy(),productHost:{handler:()=>()=>{},createOriginalWalletServiceRuntimeDaemonServer:()=>f.server},central:null,admission:f.admission,productSessionStateVersion:'2',createOriginalWalletRuntimeObserverLifetime:()=>life,emitEvent:()=>{},port:1,address:'127.0.0.1',build:null,remoteDeployed:false,process:{on:(name,fn)=>signals.set(name,fn),exit:()=>{exit++;}},URL,Promise,Date};
 const start=daemonText.indexOf('const legacyHandler='),end=daemonText.indexOf('\nfunction integer(',start);vm.createContext(context);composeOriginalPrivateAcquisition(context);vm.runInContext(daemonText.slice(start,end),context);assert.equal(events.length,0);listen();assert.equal(events[0],'after-listen');signals.get('SIGTERM')();signals.get('SIGINT')();await new Promise(resolve=>setImmediate(resolve));assert.equal(joined,1);assert.equal(closed,1);assert.equal(exit,1);
 assert.equal(events.filter(e=>e==='server-close').length,1);assert(events.indexOf('retire')<events.indexOf('server-close'));assert(events.indexOf('join')<events.indexOf('close'));
});
test('R7 PUBLIC adapted fixture uses original acquisition inventory and truthful same failed close',async()=>{
 const f=lifetimeFixture({cleanupFail:true,cleanupCause:undefined});f.lifetime.afterListen();
 assert.throws(()=>f.context.closeOriginalWalletRuntimeObserverAcquisition({}),/ACQUISITION_OWNER_REQUIRED/);
 const selected=f.lifetime.close();let rejected=false;try{await selected;}catch(cause){rejected=true;assert.equal(cause,undefined);}assert.equal(rejected,true);
 assert.equal(f.lifetime.close(),selected);assert.equal(f.closes(),1);assert.equal(f.lifetime.status().cleanupFailurePresent,true);assert.equal(f.lifetime.status().configured,true);
});
test('R7 PUBLIC adapted daemon fixture awaits both completions with independent stop and once effects',async()=>{
 const f=hostFixture(),signals=new Map();let listen,httpDone,releaseJoin,stops=0,disposed=0,exits=0;
 const joining=new Promise(resolve=>{releaseJoin=resolve;});
 f.server.listen=(_port,_address,callback)=>{listen=callback;};f.server.close=callback=>{stops++;httpDone=callback;};
 const life={afterListen(){},retire(){},join(){return joining;},close(){disposed++;return Promise.resolve();}};
 const context={host:new f.context.Legacy(),productHost:{handler:()=>()=>{},createOriginalWalletServiceRuntimeDaemonServer:()=>f.server},central:null,admission:f.admission,productSessionStateVersion:'2',createOriginalWalletRuntimeObserverLifetime:()=>life,emitEvent(){},port:1,address:'127.0.0.1',build:null,remoteDeployed:false,process:{on:(name,callback)=>signals.set(name,callback),exit(){exits++;}},URL,Promise,Date};
 const start=daemonText.indexOf('const legacyHandler='),end=daemonText.indexOf('\nfunction integer(',start);vm.createContext(context);composeOriginalPrivateAcquisition(context);vm.runInContext(daemonText.slice(start,end),context);listen();signals.get('SIGTERM')();signals.get('SIGINT')();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(stops,1);assert.equal(disposed,0);assert.equal(exits,0);
 releaseJoin();await new Promise(resolve=>setImmediate(resolve));assert.equal(disposed,1);assert.equal(exits,0);
 httpDone();await new Promise(resolve=>setImmediate(resolve));assert.equal(exits,1);signals.get('SIGINT')();assert.equal(stops,1);assert.equal(disposed,1);
});
test('R4 PUBLIC exact daemon v3 fallback retains admission and normal product routing',async()=>{
 const f=hostFixture();let product=0,listen;const legacy=new f.context.Legacy();
 const context={host:legacy,productHost:{handler:()=>{return (_req,res)=>{product++;res.writeHead(200,{});res.end('PUBLIC_V3');};}},central:null,admission:f.admission,productSessionStateVersion:'3',
  createServer:listener=>{const server=createServer(listener);server.listen=(_port,_address,fn)=>{listen=fn;};return server;},
  createOriginalWalletRuntimeObserverLifetime:()=>lifetimeFixture({selected:false}).lifetime,forwardedClient:f.context.forwardedClient,canonicalJSON:JSON.stringify,emitEvent:()=>{},port:1,address:'127.0.0.1',build:null,remoteDeployed:false,process:{on(){},exit(){}},URL,Promise,Date};
 const start=daemonText.indexOf('const legacyHandler='),end=daemonText.indexOf('\nfunction integer(',start);vm.createContext(context);composeOriginalPrivateAcquisition(context);vm.runInContext(daemonText.slice(start,end)+'\nthis.server=server;',context);listen();
 const res=response();context.server.emit('request',request('/v2/product-sessions/challenge'),res);await Promise.resolve();assert.equal(res.status,200);assert.equal(res.body,'PUBLIC_V3');assert.equal(product,1);
 const held=f.admission.enter('127.0.0.1'),blocked=response();context.server.emit('request',request('/v2/product-sessions/challenge'),blocked);assert.equal(blocked.status,503);assert.equal(product,1);held.release();
});
