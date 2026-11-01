import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
// New R14 caller integration cases only; prior frozen suites are not duplicated here.
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const clean=s=>s.replace(/^import .*;$/mg,'').replace(/^import \{[\s\S]*?\} from .*;$/mg,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify('file:///PUBLIC/original-module.js'));
function fixture({late=false,persistFail=false,clock=1000,floor=0,cleanupFail=false,unselected=false}={}){
 const events=[],writes=new Map(),fds=new Map();let next=1,live=true,kernelCalls=0,closed=0;
 const hash=s=>String(s).includes('"revision":1')?'b'.repeat(64):'a'.repeat(64);
 const association={account:'PUBLIC_ACCOUNT',clientId:'public-client',productId:'developer',platform:'macos',applicationId:'PUBLIC_APPLICATION',deviceId:'PUBLIC_DEVICE'};
 const initial={authority:{sessions:[{sessionBinding:'PUBLIC_BINDING',...association}]},revision:0};
 const envelope={schemaVersion:1,snapshotDigest:hash(JSON.stringify(initial)),snapshot:initial};writes.set('/PUBLIC/state',JSON.stringify(envelope));
 const context={URL,Buffer,Date,types,process:{pid:1,getuid:()=>1},isAbsolute:p=>p.startsWith('/'),dirname:()=>'/PUBLIC',constants:{O_RDONLY:1,O_NOFOLLOW:2,O_WRONLY:4,O_CREAT:8,O_EXCL:16},
  canonicalJSON:JSON.stringify,exactFields:(v,keys)=>{assert.deepEqual(Object.keys(v).sort(),[...keys].sort());},WalletAuthError:class extends Error{constructor(code,message){super(message);this.code=code;}},
  createHash:()=>({value:'',update(v){this.value+=v;return this;},digest(){return hash(this.value);}}),randomUUID:()=> 'PUBLIC_TEMP',parseProductSessionRegistry:v=>v,
  openSync:p=>{const fd=next++;fds.set(fd,p);return fd;},closeSync:fd=>fds.delete(fd),readFileSync:fd=>writes.get(fds.get(fd)),writeFileSync:(fd,b)=>{writes.set(fds.get(fd),b);},mkdirSync(){},fchmodSync(){},chmodSync(){},fsyncSync(){},
  lstatSync:p=>({dev:1,ino:1,uid:1,nlink:1,mode:p==='/PUBLIC'?0o700:0o600,size:(writes.get(p)??'').length,isDirectory:()=>p==='/PUBLIC',isFile:()=>p!=='/PUBLIC',isSymbolicLink:()=>false}),
  fstatSync:fd=>context.lstatSync(fds.get(fd)),renameSync:(from,to)=>{if(persistFail)throw Error('PUBLIC_PERSIST_FAIL');writes.set(to,writes.get(from));writes.delete(from);events.push('persist');},unlinkSync:p=>writes.delete(p),
  WALLET_SESSION_CONTROL_PATHS:[],WALLET_SESSION_CONTROL_PROOF_HEADER:'PUBLIC',PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION:2,walletSessionControlClockFloor:()=>floor,
  decodeProductSessionGatewayProofHeaderV2:header=>{if(header!=='PUBLIC_PROOF')throw Error('PUBLIC_INVALID_PROOF');return {sessionBinding:'PUBLIC_BINDING'};},
  ProductSessionGatewayHttpHandler:class{constructor(_r,_t,s){this.s=JSON.parse(JSON.stringify(s));}snapshot(){return this.s;}handle(input){kernelCalls++;events.push(input.path);this.s.revision=1;return {status:200,headers:{},body:JSON.stringify({ok:true,requestId:input.requestId})};}revalidate(session){if(session.account!=='PUBLIC_ACCOUNT')throw Error('PUBLIC_SESSION_MISMATCH');return session;}},
 };
 context.OriginalHostTerminalJournal=class {open(){events.push('PUBLIC_JOURNAL_BOUND');}reserve(){return Object.freeze({PUBLIC_NOT_AUTHORITY:true});}commit(){}assertTerminal(){events.push('PUBLIC_HOST_TERMINAL');if(context.PUBLIC_TERMINAL_FAIL)throw context.PUBLIC_TERMINAL_CAUSE;}retire(){events.push('PUBLIC_JOURNAL_RETIRE');}join(){events.push('PUBLIC_JOURNAL_JOIN');}close(){events.push('PUBLIC_JOURNAL_CLOSE');}};
 vm.createContext(context);
 // Exact browser-safe carrier parser in this PUBLIC VM realm. The Node PQ
 // decoder is exercised with actual provider signatures by its dedicated test.
 vm.runInContext('this.PUBLICCarrier=(()=>{'+clean(read('../src/original-wallet-service-private-carrier.js'))+';return {budget:originalPrivateCarrierBudget};})();',context);
 context.assertOriginalPrivatePQCarrier=value=>context.PUBLICCarrier.budget(value);
 vm.runInContext('this.hostAPI=(()=>{'+clean(read('../src/product-session-gateway-node-host.js'))+'\nreturn {Host:ProductSessionGatewayNodeHost,capture:captureOriginalWalletServiceRuntimeHostSource};})();',context);context.Host=context.hostAPI.Host;context.ProductSessionGatewayNodeHost=context.Host;context.captureOriginalWalletServiceRuntimeHostSource=context.hostAPI.capture;
 const host=new context.Host({products:[]},{now:()=>new Date(clock),statePath:'/PUBLIC/state',tokenFactory:()=>''});

 const original={expectedRequest:{service:'wallet-product-session-v2',productId:'developer',platform:'macos',gatewayOrigin:'https://wallet-auth.ynxweb4.com',operations:['beginYNX','handleReturn','restore','disconnect']},association};
 context.PUBLIC_NATIVE={capture:ref=>{if(ref!==original)throw Error('PUBLIC_NATIVE_REF');return original;},assertCurrent:()=>{if(!live)throw false;},assertAdmission(){},assertTerminal(){},retire(){},join(){return Promise.resolve();},close(){closed++;if(cleanupFail)throw undefined;}};
 context.prepareOriginalWalletServiceAdmission=()=>({assertCurrent(){if(!live)throw false;}});
 vm.runInContext('this.api=(()=>{'+clean(read('../src/original-wallet-service-private-dispatch.js')).replace('const originalNativeServiceBinding=loadFixedOriginalNativeServiceBinding();','const originalNativeServiceBinding=PUBLIC_NATIVE;')+'\nreturn {factory:createOriginalWalletServicePrivateDispatch,decode:decodeOriginalWalletServicePrivateRequest,begin:typeof beginOriginalWalletServicePrivateDispatchAcquisition===\"function\"?beginOriginalWalletServicePrivateDispatchAcquisition:null,closeAcquisition:typeof closeOriginalWalletServicePrivateDispatchAcquisition===\"function\"?closeOriginalWalletServicePrivateDispatchAcquisition:null,statusAcquisition:typeof originalWalletServicePrivateDispatchAcquisitionStatus===\"function\"?originalWalletServicePrivateDispatchAcquisitionStatus:null};})();',context);context.factory=context.api.factory;context.decode=context.api.decode;
 const runtime={capture:()=>({PUBLIC:true}),assertObservationCurrent(){if(late&&kernelCalls)live=false;}};
 const dispatcher=unselected?null:context.factory(host,runtime,original);
 const request={clientId:'public-client',productId:'developer',platform:'macos',applicationId:'PUBLIC_APPLICATION',deviceId:'PUBLIC_DEVICE'},approval={account:'PUBLIC_ACCOUNT'};
 const packet=(operation='beginYNX',phase='effect',requestId='req_PUBLIC_REQUEST_001')=>JSON.stringify({requestId,operation,phase,body:phase==='time'?null:JSON.stringify(operation==='beginYNX'?{request,approval}:operation==='handleReturn'?{request,approval,completion:{PUBLIC:true}}:operation==='restore'?{requiredScopes:['account:read']}:{}),proofHeader:phase==='time'||['beginYNX','handleReturn'].includes(operation)?null:'PUBLIC_PROOF'});
 return {context,host,dispatcher,packet,events,writes,original,runtime,kernelCalls:()=>kernelCalls,closed:()=>closed,invalidate(){live=false;}};
}
test('R14 intake PUBLIC Native ACK failure preserves original UNKNOWN and fences later dispatch',async()=>{
 const f=fixture(),result=await f.dispatcher.dispatch(f.packet());f.context.PUBLIC_NATIVE.assertTerminal=()=>{throw false};
 const digest=f.context.createHash().update(JSON.stringify(result)).digest('hex');let threw=false;try{f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001',digest)}catch(cause){threw=true;assert.equal(cause,false)}assert.equal(threw,true);
 const outcome=f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001');assert.equal(outcome.result.status,200);assert.equal(outcome.terminal,false);assert.equal(outcome.unknown,true);assert.equal(f.dispatcher.status().firstCausePresent,true);
 assert.throws(()=>f.dispatcher.dispatch(f.packet('restore','time','req_PUBLIC_OTHER_0001')));assert.equal(f.kernelCalls(),1);
});
test('R14 intake PUBLIC Host terminal refusal prevents Native ACK and preserves UNKNOWN',async()=>{
 const f=fixture(),result=await f.dispatcher.dispatch(f.packet());let acks=0;f.context.PUBLIC_NATIVE.assertTerminal=()=>{acks++};f.context.PUBLIC_TERMINAL_FAIL=true;f.context.PUBLIC_TERMINAL_CAUSE=undefined;
 const digest=f.context.createHash().update(JSON.stringify(result)).digest('hex');let threw=false;try{f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001',digest)}catch(cause){threw=true;assert.equal(cause,undefined)}assert.equal(threw,true);assert.equal(acks,0);assert.equal(f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001').unknown,true);assert.equal(f.dispatcher.status().firstCausePresent,true);
});
test('R14 intake PUBLIC post-Native current failure cannot clear UNKNOWN',async()=>{
 const f=fixture(),result=await f.dispatcher.dispatch(f.packet());f.context.PUBLIC_NATIVE.assertTerminal=()=>f.invalidate();const digest=f.context.createHash().update(JSON.stringify(result)).digest('hex');let threw=false;try{f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001',digest)}catch(cause){threw=true;assert.equal(cause,false)}assert.equal(threw,true);const out=f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001');assert.equal(out.unknown,true);assert.equal(out.terminal,false);
});
test('R14 intake PUBLIC independent Host and Native terminal fences both surround completed ACK',async()=>{
 const f=fixture(),result=await f.dispatcher.dispatch(f.packet());const start=f.events.length;let acks=0;f.context.PUBLIC_NATIVE.assertTerminal=()=>{acks++;f.events.push('PUBLIC_NATIVE_TERMINAL')};const digest=f.context.createHash().update(JSON.stringify(result)).digest('hex');f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001',digest);const events=f.events.slice(start).filter(e=>e==='PUBLIC_HOST_TERMINAL'||e==='PUBLIC_NATIVE_TERMINAL');assert.deepEqual(events,['PUBLIC_HOST_TERMINAL','PUBLIC_NATIVE_TERMINAL','PUBLIC_HOST_TERMINAL']);assert.equal(acks,1);assert.equal(f.dispatcher.selectOutcome('beginYNX','effect','req_PUBLIC_REQUEST_001').terminal,true);assert.throws(()=>f.dispatcher.acknowledge('beginYNX','effect','req_PUBLIC_REQUEST_001',digest));assert.equal(acks,1);
});
test('R14 intake PUBLIC retire failure drains independent journal and Native cleanup exactly once',async()=>{
 const f=fixture();await f.dispatcher.dispatch(f.packet());f.context.PUBLIC_NATIVE.retire=()=>{throw false};const closing=f.dispatcher.close();let threw=false;try{await closing}catch(cause){threw=true;assert.equal(cause,false)}assert.equal(threw,true);assert.equal(f.closed(),1);assert.equal(f.dispatcher.close(),closing);assert.equal(f.dispatcher.status().cleanupFailurePresent,true);assert.equal(f.events.filter(x=>x==='PUBLIC_JOURNAL_CLOSE').length,1);
});
test('R14 intake PUBLIC factory retains original acquisition when journal binding refuses',async()=>{
 const f=fixture({unselected:true});f.context.OriginalHostTerminalJournal.prototype.open=()=>{throw null};const acquisition=f.context.api.begin();let threw=false;try{f.context.factory(f.host,f.runtime,f.original,acquisition)}catch(cause){threw=true;assert.equal(cause,null)}assert.equal(threw,true);await f.context.api.closeAcquisition(acquisition);assert.equal(f.closed(),1);assert.equal(f.kernelCalls(),0);
});
