import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
test('R14 actual sole fixed loader decodes file URLs and retains seven-method null boundary',()=>{
 const source=readFileSync(new URL('../src/original-wallet-service-private-dispatch.js',import.meta.url),'utf8');
 const actual=source.match(/function loadFixedOriginalNativeServiceBinding\(\)\{[^]*?\n\}/)?.[0];assert.ok(actual);
 const names=['captureOriginalNativePrivateServiceBorrow','assertOriginalNativePrivateServiceCurrent','assertOriginalNativePrivateServiceAdmission','assertOriginalNativePrivateServiceTerminal','retireOriginalNativePrivateService','joinOriginalNativePrivateService','closeOriginalNativePrivateService'];
 const aliases=['capture','assertCurrent','assertAdmission','assertTerminal','retire','join','close'];let methodsCalled=0,cases=0;
 const execute=(moduleURL,native,throwLoad=false)=>{
  const expected=fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-auth-identity.node',moduleURL));let base,targets=[];
  const context=vm.createContext({URL,fileURLToPath,createRequire:value=>{base=value.href;return target=>{targets.push(target);if(throwLoad||target!==expected)throw Error('TEST_ONLY_LOAD_REFUSED');return native;};}});
  vm.runInContext(actual.replaceAll('import.meta.url',JSON.stringify(moduleURL))+';this.selected=loadFixedOriginalNativeServiceBinding();',context);
  assert.equal(base,new URL('.',moduleURL).href);assert.deepEqual(targets,[expected]);return context.selected;
 };
 for(const directory of ['YNXChain','YNX%20Chain','YNX%25%20Chain','YNX%23Chain','YNX%E9%92%B1%E5%8C%85%20Wallet']){
  const moduleURL='file:///PUBLIC/'+directory+'/packages/wallet-auth/src/original-wallet-service-private-dispatch.js';
  const native=Object.fromEntries(names.map(name=>[name,()=>{++methodsCalled;throw Error('no native method invocation');}]));
  const selected=execute(moduleURL,native);assert.ok(selected);assert.ok(Object.isFrozen(selected));assert.deepEqual(Object.keys(selected),aliases);aliases.forEach((alias,i)=>assert.equal(selected[alias],native[names[i]]));++cases;
 }
 const moduleURL='file:///PUBLIC/YNX%20Chain/packages/wallet-auth/src/original-wallet-service-private-dispatch.js';
 for(const name of names){const native=Object.fromEntries(names.map(k=>[k,()=>{++methodsCalled;}]));native[name]=null;assert.equal(execute(moduleURL,native),null);++cases;}
 assert.equal(execute(moduleURL,null,true),null);++cases;assert.equal(methodsCalled,0);
 console.log('R14_ACTUAL_FIXED_LOADER_PUBLIC_CASES='+cases+' REAL_NATIVE_LOADS=0 NATIVE_METHOD_CALLS=0');
});
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const clean=s=>s.replace(/^import .*;$/mg,'').replace(/^import \{[\s\S]*?\} from .*;$/mg,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify('file:///PUBLIC/original-module.js'));
function fixture({late=false,persistFail=false,clock=1000,floor=0,cleanupFail=false,unselected=false,localTerminal=false,prepareFail=false}={}){
 const events=[],writes=new Map(),fds=new Map();let next=1,live=true,kernelCalls=0,closed=0;
 const hash=s=>String(s).includes('"revision":1')?'b'.repeat(64):'a'.repeat(64);
 const association={account:'PUBLIC_ACCOUNT',clientId:'public-client',productId:'developer',platform:'macos',applicationId:'PUBLIC_APPLICATION',deviceId:'PUBLIC_DEVICE'};
 const initial={authority:{sessions:[{sessionBinding:'PUBLIC_BINDING',...association}]},revision:0};
 const envelope={schemaVersion:1,snapshotDigest:hash(JSON.stringify(initial)),snapshot:initial};writes.set('/PUBLIC/state',JSON.stringify(envelope));
 const context={URL,Buffer,Date,types,
  // New Host journal boundary is a lexical PUBLIC standin; real IO is covered
  // by the separate combined caller integration controls, not these fixtures.
  OriginalHostTerminalJournal:class {open(){}reserve(){return Object.freeze({PUBLIC:true});}prepare(){events.push('prepare');if(prepareFail)throw Error('PUBLIC_TERMINAL_PREPARE_REFUSED');}commit(){}assertTerminal(){}retire(){}join(){}close(){}},
  process:{pid:1,getuid:()=>1},isAbsolute:p=>p.startsWith('/'),dirname:()=>'/PUBLIC',constants:{O_RDONLY:1,O_NOFOLLOW:2,O_WRONLY:4,O_CREAT:8,O_EXCL:16},
  canonicalJSON:JSON.stringify,exactFields:(v,keys)=>{assert.deepEqual(Object.keys(v).sort(),[...keys].sort());},WalletAuthError:class extends Error{constructor(code,message){super(message);this.code=code;}},
  createHash:()=>({value:'',update(v){this.value+=v;return this;},digest(){return hash(this.value);}}),randomUUID:()=> 'PUBLIC_TEMP',parseProductSessionRegistry:v=>v,
  openSync:p=>{const fd=next++;fds.set(fd,p);return fd;},closeSync:fd=>fds.delete(fd),readFileSync:fd=>writes.get(fds.get(fd)),writeFileSync:(fd,b)=>{writes.set(fds.get(fd),b);},mkdirSync(){},fchmodSync(){},chmodSync(){},fsyncSync(){},
  lstatSync:p=>({dev:1,ino:1,uid:1,nlink:1,mode:p==='/PUBLIC'?0o700:0o600,size:(writes.get(p)??'').length,isDirectory:()=>p==='/PUBLIC',isFile:()=>p!=='/PUBLIC',isSymbolicLink:()=>false}),
  fstatSync:fd=>context.lstatSync(fds.get(fd)),renameSync:(from,to)=>{if(persistFail)throw Error('PUBLIC_PERSIST_FAIL');writes.set(to,writes.get(from));writes.delete(from);events.push('persist');},unlinkSync:p=>writes.delete(p),
  WALLET_SESSION_CONTROL_PATHS:[],WALLET_SESSION_CONTROL_PROOF_HEADER:'PUBLIC',PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION:2,walletSessionControlClockFloor:()=>floor,
  decodeProductSessionGatewayProofHeaderV2:header=>{if(header!=='PUBLIC_PROOF')throw Error('PUBLIC_INVALID_PROOF');return {sessionBinding:'PUBLIC_BINDING'};},
  ProductSessionGatewayHttpHandler:class{constructor(_r,_t,s){this.s=JSON.parse(JSON.stringify(s));}snapshot(){return this.s;}handle(input){kernelCalls++;events.push(input.path);this.s.revision=1;return {status:200,headers:{},body:JSON.stringify({ok:true,requestId:input.requestId})};}revalidate(session){if(session.account!=='PUBLIC_ACCOUNT')throw Error('PUBLIC_SESSION_MISMATCH');return session;}},
 };
 vm.createContext(context);
 // Exact browser-safe carrier parser in this PUBLIC VM realm. The Node PQ
 // decoder is exercised with actual provider signatures by its dedicated test.
 vm.runInContext(clean(read('../src/original-wallet-service-private-reference.js')),context);
 vm.runInContext('this.PUBLICCarrier=(()=>{'+clean(read('../src/original-wallet-service-private-carrier.js'))+';return {budget:originalPrivateCarrierBudget};})();',context);
 context.assertOriginalPrivatePQCarrier=value=>context.PUBLICCarrier.budget(value);
 vm.runInContext('this.hostAPI=(()=>{'+clean(read('../src/product-session-gateway-node-host.js'))+'\nreturn {Host:ProductSessionGatewayNodeHost,capture:captureOriginalWalletServiceRuntimeHostSource};})();',context);context.Host=context.hostAPI.Host;context.ProductSessionGatewayNodeHost=context.Host;context.captureOriginalWalletServiceRuntimeHostSource=context.hostAPI.capture;
 const host=new context.Host({products:[]},{now:()=>new Date(clock),statePath:'/PUBLIC/state',tokenFactory:()=>''});
 const original={expectedRequest:{service:'wallet-product-session-v2',productId:'developer',platform:'macos',gatewayOrigin:'https://wallet-auth.ynxweb4.com',operations:['beginYNX','handleReturn','restore','disconnect']},association};
 // PUBLIC local-transaction controls bind their existing journal standin;
 // this does not qualify Native or bypass the production terminal requirement.
 if(localTerminal)host.bindOriginalWalletServicePrivateTerminal(original);
 context.PUBLIC_NATIVE={capture:ref=>{if(ref!==original)throw Error('PUBLIC_NATIVE_REF');return original;},assertCurrent:()=>{if(!live)throw false;},assertAdmission(){},assertTerminal(){},retire(){},join(){return Promise.resolve();},close(){closed++;if(cleanupFail)throw undefined;}};
 context.prepareOriginalWalletServiceAdmission=()=>({assertCurrent(){if(!live)throw false;}});
 vm.runInContext('this.api=(()=>{'+clean(read('../src/original-wallet-service-private-dispatch.js')).replace('const originalNativeServiceBinding=loadFixedOriginalNativeServiceBinding();','const originalNativeServiceBinding=PUBLIC_NATIVE;')+'\nreturn {factory:createOriginalWalletServicePrivateDispatch,decode:decodeOriginalWalletServicePrivateRequest,begin:typeof beginOriginalWalletServicePrivateDispatchAcquisition===\"function\"?beginOriginalWalletServicePrivateDispatchAcquisition:null,closeAcquisition:typeof closeOriginalWalletServicePrivateDispatchAcquisition===\"function\"?closeOriginalWalletServicePrivateDispatchAcquisition:null,statusAcquisition:typeof originalWalletServicePrivateDispatchAcquisitionStatus===\"function\"?originalWalletServicePrivateDispatchAcquisitionStatus:null};})();',context);context.factory=context.api.factory;context.decode=context.api.decode;
 const runtime={capture:()=>({PUBLIC:true}),assertObservationCurrent(){if(late&&kernelCalls)live=false;}};
 const dispatcher=unselected?null:context.factory(host,runtime,original);
 const request={clientId:'public-client',productId:'developer',platform:'macos',applicationId:'PUBLIC_APPLICATION',deviceId:'PUBLIC_DEVICE'},approval={account:'PUBLIC_ACCOUNT'};
 const packet=(operation='beginYNX',phase='effect',requestId='req_PUBLIC_REQUEST_001')=>JSON.stringify({requestId,operation,phase,body:phase==='time'?null:JSON.stringify(operation==='beginYNX'?{request,approval}:operation==='handleReturn'?{request,approval,completion:{PUBLIC:true}}:operation==='restore'?{requiredScopes:['account:read']}:{}),proofHeader:phase==='time'||['beginYNX','handleReturn'].includes(operation)?null:'PUBLIC_PROOF'});
 return {context,host,dispatcher,packet,events,writes,original,runtime,kernelCalls:()=>kernelCalls,closed:()=>closed,invalidate(){live=false;}};
}
test('R15 actual Host owns original result and durable readback, refuses foreign/replay/copy owners',()=>{
 const f=fixture({unselected:true,localTerminal:true}),input=f.context.decode(f.packet()),row={result:null};
 const owner=f.host.reserveOriginalWalletServicePrivateTransaction(input,row,f.original.association);
 assert.ok(Object.isFrozen(owner));assert.throws(()=>f.host.executeOriginalWalletServicePrivateTransaction({}));
 const other=fixture({unselected:true,localTerminal:true});assert.throws(()=>other.host.executeOriginalWalletServicePrivateTransaction(owner));
 const result=f.host.executeOriginalWalletServicePrivateTransaction(owner);assert.equal(row.result,result);
 assert.equal(f.kernelCalls(),1);assert.ok(f.events.includes('persist'));assert.equal(JSON.parse(f.writes.get('/PUBLIC/state')).snapshot.revision,1);
 assert.equal(f.host.assertOriginalWalletServicePrivateTransactionReadback(owner,input,result),undefined);
 assert.equal(f.host.originalWalletServicePrivateTransactionOutcome(owner).nativeTerminal,false);
 assert.throws(()=>f.host.executeOriginalWalletServicePrivateTransaction(owner));
 assert.throws(()=>f.host.reserveOriginalWalletServicePrivateTransaction(input,{result:null},f.original.association));
 assert.throws(()=>f.host.assertOriginalWalletServicePrivateTransactionReadback(owner,input,{...result}));
 const outcome=f.host.originalWalletServicePrivateTransactionOutcome(owner);assert.equal(outcome.unknown,true);assert.equal(outcome.firstCausePresent,true);assert.equal(outcome.result,result);
 f.host.closeOriginalWalletServicePrivateTransaction(owner);assert.equal(f.host.originalWalletServicePrivateTransactionOutcome(owner).unknown,true);
});
test('R15 actual late persistence captures original partial result and falsy first cause, fences queued work',async()=>{
 for(const cause of [false,undefined]){
  const f=fixture({unselected:true,localTerminal:true}),input=f.context.decode(f.packet()),row={result:null};
  const owner=f.host.reserveOriginalWalletServicePrivateTransaction(input,row,f.original.association);
  f.context.renameSync=()=>{throw cause;};let thrown=false;
  try{f.host.executeOriginalWalletServicePrivateTransaction(owner);}catch(error){thrown=true;assert.equal(error,cause);}assert.equal(thrown,true);
  assert.equal(row.result.status,200);assert.equal(f.kernelCalls(),1);const out=f.host.originalWalletServicePrivateTransactionOutcome(owner);
  assert.equal(out.result,row.result);assert.equal(out.firstCausePresent,true);assert.equal(out.firstCause,cause);assert.equal(out.unknown,true);assert.equal(out.completed,false);
  f.host.markOriginalWalletServicePrivateTransactionUnknown(owner,Error('later'));assert.equal(f.host.originalWalletServicePrivateTransactionOutcome(owner).firstCause,cause);
  try{f.host.reserveOriginalWalletServicePrivateTransaction(f.context.decode(f.packet('disconnect','effect','req_PUBLIC_REQUEST_002')),{result:null},f.original.association);assert.fail('queue admitted');}catch(error){assert.equal(error,cause);}
  assert.equal(f.kernelCalls(),1);f.host.closeOriginalWalletServicePrivateTransaction(owner);
 }
 const f=fixture({persistFail:true}),first=f.dispatcher.dispatch(f.packet()),second=f.dispatcher.dispatch(f.packet('disconnect','effect','req_PUBLIC_REQUEST_002'));
 const outcomes=await Promise.allSettled([first,second]);assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'rejected');assert.equal(f.kernelCalls(),1);
 assert.equal(f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001').result.status,200);await f.dispatcher.close();
});
test('R15 local readback cannot replace Native terminal and source late failure stays UNKNOWN',async()=>{
 const f=fixture();let nativeTerminals=0;f.context.PUBLIC_NATIVE.assertTerminal=()=>{nativeTerminals++;throw Error('PUBLIC_NATIVE_TERMINAL_UNAVAILABLE');};
 const result=await f.dispatcher.dispatch(f.packet());assert.equal(result.status,200);
 assert.throws(()=>f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001','a'.repeat(64)),/PUBLIC_NATIVE_TERMINAL_UNAVAILABLE/);
 assert.equal(nativeTerminals,1);const out=f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001');assert.equal(out.result,result);assert.equal(out.unknown,true);assert.equal(out.terminal,false);
 assert.throws(()=>f.dispatcher.dispatch(f.packet('disconnect','effect','req_PUBLIC_REQUEST_002')));await f.dispatcher.close();assert.equal(f.closed(),1);
 const late=fixture({late:true});await assert.rejects(late.dispatcher.dispatch(late.packet()),error=>error===false);
 assert.equal(late.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001').result.status,200);assert.equal(late.kernelCalls(),1);await late.dispatcher.close();
});
test('R15 retained original sink and input cannot be substituted after persistence',()=>{
 for(const changed of ['sink','input']){
  const f=fixture({unselected:true,localTerminal:true}),input=f.context.decode(f.packet()),row={result:null},owner=f.host.reserveOriginalWalletServicePrivateTransaction(input,row,f.original.association),result=f.host.executeOriginalWalletServicePrivateTransaction(owner);
  if(changed==='sink')row.result={...result};
  const readback=changed==='input'?{...input,requestId:'req_PUBLIC_REQUEST_002'}:input;
  assert.throws(()=>f.host.assertOriginalWalletServicePrivateTransactionReadback(owner,readback,result));assert.equal(f.host.originalWalletServicePrivateTransactionOutcome(owner).unknown,true);
 }
});
test('R15 cleanup drains independently even when Native retire throws falsy first cause',async()=>{
 const f=fixture();await f.dispatcher.dispatch(f.packet());let joins=0;f.context.PUBLIC_NATIVE.retire=()=>{throw false;};f.context.PUBLIC_NATIVE.join=()=>{joins++;throw undefined;};
 await assert.rejects(f.dispatcher.close(),error=>error===false);assert.equal(joins,1);assert.equal(f.closed(),1);assert.equal(f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001').unknown,true);
});
test('R15 input/result accessors and proxies have no authority; changed current state fails closed',()=>{
 const f=fixture({unselected:true,localTerminal:true}),input=f.context.decode(f.packet());let accessed=0;
 const bad={...input};Object.defineProperty(bad,'body',{get(){accessed++;return input.body;},enumerable:true});
 assert.throws(()=>f.host.reserveOriginalWalletServicePrivateTransaction(bad,{result:null},f.original.association));
 assert.throws(()=>f.host.reserveOriginalWalletServicePrivateTransaction(new Proxy(input,{}),{result:null},f.original.association));assert.equal(accessed,0);assert.equal(f.kernelCalls(),0);
 const hostile=new Proxy(input,{getOwnPropertyDescriptor(){accessed++;throw Error('PUBLIC_PROXY_TRAP');}});
 assert.throws(()=>f.host.reserveOriginalWalletServicePrivateTransaction(hostile,{result:null},f.original.association));assert.equal(accessed,0);
 const row={result:null},owner=f.host.reserveOriginalWalletServicePrivateTransaction(input,row,f.original.association),result=f.host.executeOriginalWalletServicePrivateTransaction(owner);
 const stored=JSON.parse(f.writes.get('/PUBLIC/state'));stored.snapshot.revision=0;stored.snapshotDigest='a'.repeat(64);f.writes.set('/PUBLIC/state',JSON.stringify(stored));
 assert.throws(()=>f.host.assertOriginalWalletServicePrivateTransactionReadback(owner,input,result));assert.equal(f.host.originalWalletServicePrivateTransactionOutcome(owner).unknown,true);
 const g=fixture({unselected:true,localTerminal:true}),gi=g.context.decode(g.packet()),gr={result:null},go=g.host.reserveOriginalWalletServicePrivateTransaction(gi,gr,g.original.association),res=g.host.executeOriginalWalletServicePrivateTransaction(go);
 Object.defineProperty(res,'body',{get(){accessed++;return 'PUBLIC';},enumerable:true});assert.throws(()=>g.host.assertOriginalWalletServicePrivateTransactionReadback(go,gi,res));assert.equal(accessed,0);
 console.log('R15_ACTUAL_HOST_KERNEL_PERSIST_READBACK_TEST_ONLY REAL_NATIVE_LOADS=0 PRIVATE_CRYPTO=0 NATIVE_TERMINAL_GRANTED=0');
});
test('R8 PUBLIC strict four-op decoder rejects arbitrary routes/proofs and unbound factory',()=>{
 const f=fixture();for(const raw of ['{}',f.packet().replace('beginYNX','arbitrary'),f.packet().replace('"proofHeader":null','"proofHeader":"PUBLIC_PROOF"')])assert.throws(()=>f.context.decode(raw));
 const c={WalletAuthError:f.context.WalletAuthError,Buffer,canonicalJSON:JSON.stringify,exactFields(){},ProductSessionGatewayNodeHost:f.context.Host};vm.createContext(c);vm.runInContext(clean(read('../src/original-wallet-service-private-dispatch.js'))+'\nthis.factory=createOriginalWalletServicePrivateDispatch;',c);assert.throws(()=>c.factory({}, {},{}),/unavailable/);
 assert.throws(()=>f.context.factory(f.host,{capture(){},assertObservationCurrent(){}},f.original),/unavailable/);
});
// R9 controls execute the frozen parent bodies before repair. All Native,
// filesystem and kernel dependencies remain explicit PUBLIC lexical stand-ins.
function daemonFixture(f,{emitClose=false,privateJoin=null}={}){
 const server=new EventEmitter(),signals=new Map();let onListen,stops=0,exits=0,runtimeCloses=0;
 server.on('request',()=>{});server.listening=true;
 server.listen=(_p,_a,callback)=>{onListen=callback;};server.close=callback=>{stops++;server.listening=false;if(emitClose)server.emit('close');callback();};
 if(privateJoin)f.context.PUBLIC_NATIVE.join=()=>privateJoin;
 Object.assign(f.context,{server,productHost:f.host,originalAuthSourceCurrent:null,PUBLIC_BORROW:f.original,createOriginalWalletServicePrivateDispatch:f.context.factory,
  beginOriginalWalletServicePrivateDispatchAcquisition:f.context.api.begin,closeOriginalWalletServicePrivateDispatchAcquisition:f.context.api.closeAcquisition,originalWalletServicePrivateDispatchAcquisitionStatus:f.context.api.statusAcquisition,
  createOriginalWalletRuntimeObserverLifetime:()=>({...f.runtime,afterListen(){},retire(){},join:async()=>undefined,close:async()=>{runtimeCloses++;}}),emitEvent:event=>f.events.push(event),port:1,address:'127.0.0.1',build:null,remoteDeployed:false});
 f.context.process={on:(signal,callback)=>signals.set(signal,callback),exit(){exits++;}};
 const text=read('../scripts/ynx-wallet-gatewayd.mjs'),start=text.indexOf('const originalRuntimeLifetime='),end=text.indexOf('\nfunction integer(',start);
 vm.runInContext(text.slice(start,end).replace('const originalPrivateServiceBorrow=null;','const originalPrivateServiceBorrow=PUBLIC_BORROW;')+'\nthis.selectedPrivate=()=>originalPrivateDispatch;',f.context);
 return {listen:()=>onListen(),stop:()=>signals.get('SIGTERM')(),stops:()=>stops,exits:()=>exits,runtimeCloses:()=>runtimeCloses};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('R10 PUBLIC N1 simultaneous queued requests latch persistence failure before second Host effect',async()=>{
 const f=fixture({persistFail:true});
 const first=f.dispatcher.dispatch(f.packet('beginYNX','effect','req_PUBLIC_REQUEST_001'));
 const second=f.dispatcher.dispatch(f.packet('beginYNX','effect','req_PUBLIC_REQUEST_002'));
 const results=await Promise.allSettled([first,second]);assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'rejected');
 assert.equal(f.kernelCalls(),1);assert.equal(f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001').result.status,200);
 assert.equal(f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_002').result,null);
 assert.equal(f.dispatcher.status().unknown,true);assert.equal(f.dispatcher.status().firstCausePresent,true);
 assert.throws(()=>f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001','a'.repeat(64)));
});
test('R9 PUBLIC F1 normal daemon retains postcapture rejected and pending cleanup without API return',async()=>{
 for(const kind of ['rejected','pending','confirmed']){
  const f=fixture({unselected:true});f.context.PUBLIC_NATIVE.assertCurrent=()=>{throw false;};let release;
  if(kind==='rejected')f.context.PUBLIC_NATIVE.close=()=>{throw undefined;};
  if(kind==='pending')f.context.PUBLIC_NATIVE.close=()=>new Promise(resolve=>{release=resolve;});
  const d=daemonFixture(f);d.listen();assert.equal(f.context.selectedPrivate(),null);d.stop();await tick();
  assert.equal(d.stops(),1);
  if(kind==='confirmed'){assert.equal(d.exits(),1);assert.equal(f.context.process.exitCode,1);}
  else {assert.equal(d.exits(),0);if(kind==='pending'){release();await tick();assert.equal(d.exits(),1);}}
 }
});
test('R9 PUBLIC F2 captured failed persistence cannot ACK away UNKNOWN or enter a new effect',async()=>{
 const f=fixture({persistFail:true});await assert.rejects(f.dispatcher.dispatch(f.packet()));
 assert.throws(()=>f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001','a'.repeat(64)));
 assert.equal(f.dispatcher.status().unknown,true);assert.equal(f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001').result.status,200);
 assert.throws(()=>f.dispatcher.dispatch(f.packet('beginYNX','effect','req_PUBLIC_REQUEST_002')));assert.equal(f.kernelCalls(),1);
});
test('R9 PUBLIC F3 Server close event waits private drain while HTTP stop remains once',async()=>{
 let release;const joined=new Promise(resolve=>{release=resolve;}),f=fixture({unselected:true}),d=daemonFixture(f,{emitClose:true,privateJoin:joined});
 d.listen();d.stop();await tick();assert.equal(d.stops(),1);assert.equal(d.runtimeCloses(),0);
 release();await tick();assert.equal(d.runtimeCloses(),1);assert.equal(d.exits(),1);d.stop();await tick();assert.equal(d.stops(),1);
});
test('R9 PUBLIC cleanup outcome preserves falsy business and cleanup causes separately and closes once',async()=>{
 const f=fixture({unselected:true}),ref=f.context.api.begin();f.context.PUBLIC_NATIVE.assertCurrent=()=>{throw false;};let closed=0;
 f.context.PUBLIC_NATIVE.close=()=>{closed++;throw undefined;};
 let failed=false;try{f.context.factory(f.host,f.runtime,f.original,ref);}catch(cause){failed=true;assert.equal(cause,false);}assert(failed);
 const closing=f.context.api.closeAcquisition(ref);assert.equal(f.context.api.closeAcquisition(ref),closing);
 let cleanupFailed=false;try{await closing;}catch(cause){cleanupFailed=true;assert.equal(cause,undefined);}assert(cleanupFailed);assert.equal(closed,1);
 const status=f.context.api.statusAcquisition(ref);assert.equal(status.businessFailurePresent,true);assert.equal(status.cleanupFailurePresent,true);assert.equal(status.cleanupComplete,false);
});
test('R9 PUBLIC fulfilled response ACK settles only its happy row and external close does not stop HTTP twice',async()=>{
 const f=fixture({unselected:true}),d=daemonFixture(f);d.listen();const selected=f.context.selectedPrivate();await selected.dispatch(f.packet());
 selected.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001','a'.repeat(64));assert.equal(selected.status().unknown,false);
 f.context.server.listening=false;f.context.server.emit('close');await tick();assert.equal(d.stops(),0);assert.equal(d.runtimeCloses(),1);assert.equal(f.closed(),1);assert.equal(d.exits(),1);
});
test('R8 PUBLIC same Host transaction persists and retains result with once effect and terminal',async()=>{
 const f=fixture(),result=await f.dispatcher.dispatch(f.packet());assert.equal(result.status,200);assert.equal(f.kernelCalls(),1);assert.equal(f.events.includes('persist'),true);assert.equal(JSON.parse(f.writes.get('/PUBLIC/state')).snapshot.revision,1);
 assert.throws(()=>f.dispatcher.dispatch(f.packet()),/unavailable/);assert.equal(f.kernelCalls(),1);assert.equal(f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001').unknown,true);
 f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001','a'.repeat(64));assert.equal(f.dispatcher.status().unknown,false);assert.throws(()=>f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001','a'.repeat(64)));
});
test('R8 PUBLIC all fixed business routes preserve owned session binding and reject wrong device/proof',async()=>{
 const paths=['challenge','complete','introspect','revoke'],f=fixture();for(const [index,op] of ['beginYNX','handleReturn','restore','disconnect'].entries()){await f.dispatcher.dispatch(f.packet(op,'effect','req_PUBLIC_REQUEST_00'+index));assert.equal(f.events.includes('/v2/product-sessions/'+paths[index]),true);}assert.equal(f.kernelCalls(),4);
 const device=fixture();device.original.association.deviceId='OTHER_DEVICE';await assert.rejects(device.dispatcher.dispatch(device.packet('restore')),/association differs/);assert.equal(device.kernelCalls(),0);
 const proof=fixture();await assert.rejects(proof.dispatcher.dispatch(proof.packet('restore').replace('PUBLIC_PROOF','INVALID_PROOF')),/INVALID_PROOF/);assert.equal(proof.kernelCalls(),0);
});
test('R8 PUBLIC first result survives persistence error and late falsy current failure UNKNOWN',async()=>{
 for(const options of [{persistFail:true},{late:true}]){const f=fixture(options);await assert.rejects(f.dispatcher.dispatch(f.packet()));const outcome=f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001');assert.equal(outcome.result.status,200);assert.equal(outcome.unknown,true);assert.equal(f.kernelCalls(),1);assert.throws(()=>f.dispatcher.dispatch(f.packet()));}
});
test('R8 PUBLIC authority time phase uses actual floor and refuses retired or mismatched association',async()=>{
 const f=fixture(),clock=await f.dispatcher.dispatch(f.packet('beginYNX','time'));assert.equal(JSON.parse(clock.body).result.serverTime,'1970-01-01T00:00:01.000Z');assert.equal(f.kernelCalls(),0);await f.dispatcher.dispatch(f.packet());assert.equal(f.kernelCalls(),1);
 const rollback=fixture({clock:1000,floor:2000});await assert.rejects(rollback.dispatcher.dispatch(rollback.packet('beginYNX','time')),/clock moved/);assert.equal(rollback.kernelCalls(),0);
 const retired=fixture();retired.dispatcher.retire();assert.throws(()=>retired.dispatcher.dispatch(retired.packet('beginYNX','time')));
 const mismatch=fixture();mismatch.original.association.account='OTHER';await assert.rejects(mismatch.dispatcher.dispatch(mismatch.packet()));assert.equal(mismatch.kernelCalls(),0);
});
test('R8 PUBLIC once retire/join/close preserves same failed cleanup and no effect retry',async()=>{
 const f=fixture({cleanupFail:true});await f.dispatcher.dispatch(f.packet());f.dispatcher.retire();await f.dispatcher.join();const closing=f.dispatcher.close();let rejected=false;try{await closing;}catch(cause){rejected=true;assert.equal(cause,undefined);}assert.equal(rejected,true);assert.equal(f.dispatcher.close(),closing);assert.equal(f.closed(),1);assert.equal(f.dispatcher.status().cleanupFailurePresent,true);assert.equal(f.dispatcher.status().unknown,true);
});
test('R8 PUBLIC actual daemon fixed listen caller selects dispatcher and independently closes original borrow',async()=>{
 const f=fixture({unselected:true}),server=new EventEmitter(),signals=new Map();server.on('request',()=>{});let onListen,stops=0,exits=0;
 server.listen=(_port,_address,callback)=>{onListen=callback;};server.close=callback=>{stops++;callback();};
 Object.assign(f.context,{server,productHost:f.host,PUBLIC_BORROW:f.original,createOriginalWalletServicePrivateDispatch:f.context.factory,beginOriginalWalletServicePrivateDispatchAcquisition:f.context.api.begin,closeOriginalWalletServicePrivateDispatchAcquisition:f.context.api.closeAcquisition,originalWalletServicePrivateDispatchAcquisitionStatus:f.context.api.statusAcquisition,createOriginalWalletRuntimeObserverLifetime:()=>({...f.runtime,afterListen(){},retire(){},join:async()=>undefined,close:async()=>undefined}),emitEvent:event=>f.events.push(event),port:1,address:'127.0.0.1',build:null,remoteDeployed:false});
 f.context.process={pid:1,getuid:()=>1,on:(signal,callback)=>signals.set(signal,callback),exit(){exits++;}};
 const text=read('../scripts/ynx-wallet-gatewayd.mjs'),start=text.indexOf('const originalRuntimeLifetime='),end=text.indexOf('\nfunction integer(',start);
 vm.runInContext(text.slice(start,end).replace('const originalPrivateServiceBorrow=null;','const originalPrivateServiceBorrow=PUBLIC_BORROW;')+'\nthis.selectedPrivate=()=>originalPrivateDispatch;',f.context);
 onListen();const selected=f.context.selectedPrivate();assert(selected);await selected.dispatch(f.packet());assert.equal(f.kernelCalls(),1);signals.get('SIGTERM')();signals.get('SIGINT')();await new Promise(resolve=>setImmediate(resolve));assert.equal(stops,1);assert.equal(f.closed(),1);assert.equal(f.context.process.exitCode,1);assert.equal(exits,0);assert.equal(f.events.some(event=>event.privateTerminalUnknown===true),true);
});

test('candidate terminal preparation refusal preserves old durable state and the uncertain original result',()=>{
 const f=fixture({unselected:true,localTerminal:true,prepareFail:true}),input=f.context.decode(f.packet()),row={result:null},before=f.writes.get('/PUBLIC/state'),owner=f.host.reserveOriginalWalletServicePrivateTransaction(input,row,f.original.association);
 assert.throws(()=>f.host.executeOriginalWalletServicePrivateTransaction(owner),/PUBLIC_TERMINAL_PREPARE_REFUSED/);assert.equal(f.writes.get('/PUBLIC/state'),before);assert.equal(f.events.includes('persist'),false);assert.equal(f.kernelCalls(),1);assert.equal(row.result.status,200);
 const outcome=f.host.originalWalletServicePrivateTransactionOutcome(owner);assert.equal(outcome.unknown,true);assert.equal(outcome.completed,false);assert.equal(outcome.firstCausePresent,true);assert.equal(outcome.result,row.result);
 const g=fixture({unselected:true,localTerminal:true}),gi=g.context.decode(g.packet()),gr={result:null},go=g.host.reserveOriginalWalletServicePrivateTransaction(gi,gr,g.original.association);g.host.executeOriginalWalletServicePrivateTransaction(go);assert(g.events.indexOf('prepare')<g.events.indexOf('persist'));
});

test('normal delivery outcome rechecks current and retains forensic result after a late Source failure',async()=>{
 const f=fixture(),result=await f.dispatcher.dispatch(f.packet()),digest=f.context.createHash().update(JSON.stringify(result)).digest('hex');
 f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001',digest);
 const current=f.dispatcher.selectCurrentOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001');assert.equal(current.result,result);assert.equal(current.terminal,true);assert.equal(current.unknown,false);
 f.invalidate();let thrown=false;try{f.dispatcher.selectCurrentOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001');}catch(cause){thrown=true;assert.equal(cause,false);}assert.equal(thrown,true);
 const retained=f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001');assert.equal(retained.result,result);assert.equal(retained.unknown,true);assert.equal(f.dispatcher.status().firstCausePresent,true);
 await f.dispatcher.close();assert.equal(f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001').result,result);
});

test('normal delivery cannot publish when the second current fence fails with an undefined cause',async()=>{
 const f=fixture(),result=await f.dispatcher.dispatch(f.packet()),digest=f.context.createHash().update(JSON.stringify(result)).digest('hex');f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001',digest);
 let checks=0;f.context.PUBLIC_NATIVE.assertCurrent=()=>{if(++checks===2)throw undefined;};let threw=false;try{f.dispatcher.selectCurrentOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001');}catch(cause){threw=true;assert.equal(cause,undefined);}assert.equal(threw,true);assert.equal(checks,2);
 const out=f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001');assert.equal(out.result,result);assert.equal(out.unknown,true);assert.equal(f.dispatcher.status().firstCausePresent,true);await f.dispatcher.close();
});
