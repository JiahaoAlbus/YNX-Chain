import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createServer,Server} from 'node:http';
import {EventEmitter} from 'node:events';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
// Exact PUBLIC lexical Host/daemon/lifetime bodies. State/crypto/protected
// sources are stand-ins. Real Server objects NEVER listen or open a network.
const hostText=read('../src/product-session-gateway-node-host.js');
const observerText=read('../src/original-wallet-service-runtime-observer.js');
const launcherText=read('../scripts/original-wallet-runtime-observer-launcher.mjs');
const daemonText=read('../scripts/ynx-wallet-gatewayd.mjs');
const admissionText=read('../src/gateway-admission.js');
const clean=text=>text.replace(/^import .*;$/mg,'').replace(/^import \{[\s\S]*?\} from .*;$/mg,'').replaceAll('export ','');
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
  createOriginalWalletServiceRuntimeObserver:input=>{creates++;assert.equal(input.server,server);if(late)lifetime.retire(false);return original;},
  assertOriginalWalletServiceRuntimeObserver:value=>assert.equal(value,original),captureOriginalWalletServiceRuntimeObservation:(value,sequence)=>{assert.equal(value,original);return {sequence};},assertOriginalWalletServiceRuntimeObservationCurrent:value=>assert.equal(value,original),
  closeOriginalWalletServiceRuntimeObserver:value=>{assert.equal(value,original);closes++;if(cleanupFail)throw cleanupCause;},
 };
 vm.createContext(context);vm.runInContext(clean(launcherText)+'\nthis.create=createOriginalWalletRuntimeObserverLifetime;',context);lifetime=context.create(host,server);
 return {lifetime,host,server,creates:()=>creates,closes:()=>closes};
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
 const start=daemonText.indexOf('const legacyHandler='),end=daemonText.indexOf('\nfunction integer(',start);vm.createContext(context);vm.runInContext(daemonText.slice(start,end),context);assert.equal(events.length,0);listen();assert.equal(events[0],'after-listen');signals.get('SIGTERM')();signals.get('SIGINT')();await new Promise(resolve=>setImmediate(resolve));assert.equal(joined,1);assert.equal(closed,1);assert.equal(exit,1);assert.deepEqual(events,['after-listen','retire','join','close','server-close']);
});
test('R4 PUBLIC exact daemon v3 fallback retains admission and normal product routing',async()=>{
 const f=hostFixture();let product=0,listen;const legacy=new f.context.Legacy();
 const context={host:legacy,productHost:{handler:()=>{return (_req,res)=>{product++;res.writeHead(200,{});res.end('PUBLIC_V3');};}},central:null,admission:f.admission,productSessionStateVersion:'3',
  createServer:listener=>{const server=createServer(listener);server.listen=(_port,_address,fn)=>{listen=fn;};return server;},
  createOriginalWalletRuntimeObserverLifetime:()=>lifetimeFixture({selected:false}).lifetime,forwardedClient:f.context.forwardedClient,canonicalJSON:JSON.stringify,emitEvent:()=>{},port:1,address:'127.0.0.1',build:null,remoteDeployed:false,process:{on(){},exit(){}},URL,Promise,Date};
 const start=daemonText.indexOf('const legacyHandler='),end=daemonText.indexOf('\nfunction integer(',start);vm.createContext(context);vm.runInContext(daemonText.slice(start,end)+'\nthis.server=server;',context);listen();
 const res=response();context.server.emit('request',request('/v2/product-sessions/challenge'),res);await Promise.resolve();assert.equal(res.status,200);assert.equal(res.body,'PUBLIC_V3');assert.equal(product,1);
 const held=f.admission.enter('127.0.0.1'),blocked=response();context.server.emit('request',request('/v2/product-sessions/challenge'),blocked);assert.equal(blocked.status,503);assert.equal(product,1);held.release();
});
