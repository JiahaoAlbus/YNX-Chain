import test from 'node:test';
import assert from 'node:assert/strict';
import {createAddressConnectionConsumer,ADDRESS_CONNECTION_ORIGIN} from '../src/walletconnect-address-consumer.mjs';
const account='0x'+'a'.repeat(40);
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture({connect,disconnect=async()=>{},cancel=async()=>{},chain='0x1917',accounts=[account],cleanupSnapshot}={}){
 const handlers=new Map(),requests=[],states=[],uris=[];let factories=0,calls=0,cancels=0,disconnects=0;
 const provider={request:async input=>{requests.push(input);return input.method==='eth_chainId'?chain:accounts;}};
 const original={on:(name,fn)=>handlers.set(name,fn),connect:async options=>{calls++;return connect?connect(options,provider):provider;},cancel:()=>{cancels++;return cancel();},disconnect:()=>{disconnects++;return disconnect();}};
 if(cleanupSnapshot)original.cleanupSnapshot=cleanupSnapshot;
 const ui=createAddressConnectionConsumer({origin:ADDRESS_CONNECTION_ORIGIN,createConnection:options=>{factories++;assert.deepEqual(options,{origin:ADDRESS_CONNECTION_ORIGIN,methods:[]});return original;},onState:s=>states.push(s),onURI:uri=>uris.push(uri),clearURI:()=>uris.splice(0)});
 return {ui,original,provider,requests,states,uris,handlers,counts:()=>({factories,calls,cancels,disconnects})};
}
test('normal address consumer is lazy and reads only the one approved address and chain',async()=>{
 const f=fixture();assert.equal(f.counts().factories,0);const state=await f.ui.connect();
 assert.equal(state.phase,'connected');assert.equal(state.account,account);assert.equal(state.chainId,'0x1917');
 assert.deepEqual(f.requests,[{method:'eth_chainId'},{method:'eth_accounts'}]);
 assert.deepEqual(Object.keys(f.ui),['connect','cancel','disconnect','checkOriginal','snapshot']);assert.equal(Object.isFrozen(state),true);
});
test('wrong or local origin is rejected before a protocol client is constructed',()=>{
 for(const origin of ['http://localhost','https://wallet.ynxweb4.com.evil.invalid','https://developer.ynxweb4.com',null])assert.throws(()=>createAddressConnectionConsumer({origin,createConnection(){throw Error('MUST_NOT_RUN');}}),/WALLET_CONNECTION_ORIGIN_REQUIRED/);
});
test('reentry shares the same original connection and protocol-generated URI stays out of state',async()=>{
 const pending=defer(),f=fixture({connect:async options=>{options.onURI('PUBLIC_SYNTHETIC_URI_NOT_A_REAL_PAIRING');return pending.promise;}});
 const one=f.ui.connect(),two=f.ui.connect();assert.equal(one,two);await Promise.resolve();
 assert.equal(f.uris.length,1);assert.equal(JSON.stringify(f.ui.snapshot()).includes('URI'),false);
 pending.resolve(f.provider);await one;assert.equal(f.counts().calls,1);assert.deepEqual(f.uris,[]);
});
test('cancel hides pending URI and a late provider cannot become a connected approval',async()=>{
 const pending=defer(),f=fixture({connect:()=>pending.promise});const work=f.ui.connect();await Promise.resolve();await f.ui.cancel();pending.resolve(f.provider);await work;
 assert.equal(f.ui.snapshot().phase,'cancelled');assert.equal(f.ui.snapshot().account,null);assert.deepEqual(f.requests,[]);assert.equal(f.counts().cancels,1);
});
test('wrong chain or malformed account never claims connected',async()=>{
 for(const options of [{chain:'0x1'},{accounts:[]},{accounts:[account,account]},{accounts:['secret-value']}]){const f=fixture(options);await f.ui.connect();assert.equal(f.ui.snapshot().phase,'failed');assert.equal(f.ui.snapshot().account,null);assert.equal(f.ui.snapshot().code,'WALLET_CONNECTION_UNAVAILABLE');}
});
test('uncertain disconnect is retained without repeated cleanup or new connection writes',async()=>{
 const f=fixture({disconnect:async()=>{throw Error('PUBLIC_UNKNOWN');}});await f.ui.connect();await f.ui.disconnect();
 assert.equal(f.ui.snapshot().phase,'cleanup-unconfirmed');assert.equal(f.ui.snapshot().cleanupUnconfirmed,true);await f.ui.disconnect();await f.ui.connect();
 assert.deepEqual(f.counts(),{factories:1,calls:1,cancels:0,disconnects:1});
});
test('account and chain events invalidate display instead of silently adopting changed permission',async()=>{
 for(const name of ['accountsChanged','chainChanged','disconnect']){const f=fixture();await f.ui.connect();f.handlers.get(name)(['0x'+'b'.repeat(40)]);assert.equal(f.ui.snapshot().phase,'changed');assert.equal(f.ui.snapshot().account,null);assert.equal(f.counts().calls,1);}
});
test('transport errors expose bounded codes, never original error messages or pairing material',async()=>{
 const f=fixture({connect:async()=>{throw Object.assign(Error('SECRET_URI_AND_CREDENTIAL'),{code:'SECRET_URI_AND_CREDENTIAL'});}});await f.ui.connect();assert.equal(f.ui.snapshot().code,'WALLET_CONNECTION_UNAVAILABLE');assert.equal(JSON.stringify(f.states).includes('SECRET'),false);
});
test('late stage notifications cannot revive a cancelled original or erase cleanup uncertainty',async()=>{
 for(const mode of ['cancelled','unknown']){
  const pending=defer(),f=fixture({connect:()=>pending.promise});const work=f.ui.connect();await Promise.resolve();
  if(mode==='cancelled')await f.ui.cancel();else f.handlers.get('cancelUnconfirmed')({current:true});
  const before=f.ui.snapshot();f.handlers.get('stage')({stage:'approval',attempt:1});
  assert.deepEqual(f.ui.snapshot(),before);
  pending.resolve(f.provider);await work;assert.notEqual(f.ui.snapshot().phase,'connected');
 }
});
test('explicit initialization cleanup UNKNOWN is retained even after an earlier cancel and prevents reinitialization',async()=>{
 for(const cancelled of [false,true]){
  const pending=defer(),f=fixture({connect:()=>pending.promise});const work=f.ui.connect();await Promise.resolve();if(cancelled)await f.ui.cancel();
  pending.reject(Object.assign(Error('PUBLIC_INITIALIZATION_FAILURE'),{code:'YNX_PAIR_CLEANUP_UNCONFIRMED'}));await work;
  assert.equal(f.ui.snapshot().phase,'cleanup-unconfirmed');assert.equal(f.ui.snapshot().cleanupUnconfirmed,true);assert.equal(f.ui.snapshot().account,null);
  await f.ui.connect();assert.equal(f.counts().calls,1);
 }
});
test('original result review retains cancellation and cleanup first codes separately without another effect',async()=>{
 const pending=defer(),f=fixture({connect:()=>pending.promise,cancel:async()=>{throw Object.assign(Error('PRIVATE_CLEANUP_MATERIAL'),{code:'YNX_PAIR_CLEANUP_UNCONFIRMED'});}});
 const work=f.ui.connect();await Promise.resolve();await f.ui.cancel();
 pending.reject(Object.assign(Error('PRIVATE_PAIRING_MATERIAL'),{code:'YNX_PAIR_CANCELLED'}));await work;
 const status=f.ui.checkOriginal();
 assert.deepEqual(status,{attempt:1,connect:'rejected',connectCode:'YNX_PAIR_CANCELLED',cleanup:'rejected',cleanupKind:'cancel',cleanupCode:'YNX_PAIR_CLEANUP_UNCONFIRMED',remoteCleanup:'unconfirmed',reconnectBlocked:true,cleanupWitness:null,protocol:{availability:'not-supplied',value:null}});
 assert.ok(Object.isFrozen(status));assert.equal(f.ui.snapshot().phase,'cleanup-unconfirmed');assert.equal(f.ui.snapshot().code,'YNX_PAIR_CLEANUP_UNCONFIRMED');
 const counts=f.counts();for(let i=0;i<3;i++)assert.deepEqual(f.ui.checkOriginal(),status);
 await f.ui.connect();await f.ui.cancel();await f.ui.disconnect();assert.deepEqual(f.counts(),counts);
 assert.equal(JSON.stringify(f.states).includes('PRIVATE_'),false);
});
test('original result review observes pending and fulfilled local calls but never invents remote cleanup',async()=>{
 const pending=defer(),cleanup=defer(),f=fixture({connect:()=>pending.promise,cancel:()=>cleanup.promise});
 assert.deepEqual(f.ui.checkOriginal(),{attempt:0,connect:'not-started',connectCode:null,cleanup:'not-started',cleanupKind:null,cleanupCode:null,remoteCleanup:'not-established',reconnectBlocked:false,cleanupWitness:null,protocol:{availability:'not-started',value:null}});
 assert.equal(f.counts().factories,0);
 const work=f.ui.connect();await Promise.resolve();const cancelling=f.ui.cancel();await Promise.resolve();
 assert.equal(f.ui.checkOriginal().connect,'pending');assert.equal(f.ui.checkOriginal().cleanup,'pending');
 cleanup.resolve();await cancelling;assert.equal(f.ui.checkOriginal().cleanup,'fulfilled');assert.equal(f.ui.checkOriginal().remoteCleanup,'not-established');
 pending.reject(Object.assign(Error('PUBLIC_CANCEL'),{code:'YNX_PAIR_CANCELLED'}));await work;
 assert.equal(f.ui.checkOriginal().connect,'rejected');assert.equal(f.ui.checkOriginal().connectCode,'YNX_PAIR_CANCELLED');assert.equal(f.counts().calls,1);
});
test('original result review does not relabel a fulfilled SDK result after a local account validation failure',async()=>{
 const f=fixture({chain:'0x1'});await f.ui.connect();assert.equal(f.ui.snapshot().phase,'failed');
 assert.equal(f.ui.checkOriginal().connect,'fulfilled');assert.equal(f.ui.checkOriginal().connectCode,null);assert.equal(f.ui.checkOriginal().remoteCleanup,'not-established');
 assert.equal(f.ui.snapshot().account,null);assert.equal(f.counts().calls,1);
});
test('cancel with no remote cleanup proof keeps the original attempt and prevents a second dispatch',async()=>{
 const pending=defer(),f=fixture({connect:()=>pending.promise});const work=f.ui.connect();await Promise.resolve();
 await f.ui.cancel();pending.reject(Object.assign(Error('PUBLIC_CANCEL'),{code:'YNX_PAIR_CANCELLED'}));await work;
 const before=f.ui.checkOriginal(),counts=f.counts();await f.ui.connect();
 assert.deepEqual(f.counts(),counts);assert.deepEqual(f.ui.checkOriginal(),before);assert.equal(f.ui.snapshot().reconnectBlocked,true);
});
test('synchronous cancellation before selecting the SDK performs no effect and permits a later explicit first connection',async()=>{
 const f=fixture(),work=f.ui.connect();await f.ui.cancel();await work;
 assert.deepEqual(f.counts(),{factories:0,calls:0,cancels:0,disconnects:0});assert.equal(f.ui.snapshot().phase,'cancelled');
 assert.equal(f.ui.checkOriginal().cleanupWitness,'cancelled-before-sdk-selection');
 await f.ui.connect();assert.equal(f.ui.snapshot().phase,'connected');assert.equal(f.counts().calls,1);
});
test('unsolicited disconnect notice cannot launder a cancelled attempt or repeat its cleanup',async()=>{
 const pending=defer(),f=fixture({connect:()=>pending.promise});const work=f.ui.connect();await Promise.resolve();await f.ui.cancel();
 pending.reject(Object.assign(Error('PUBLIC_CANCEL'),{code:'YNX_PAIR_CANCELLED'}));await work;
 f.handlers.get('disconnect')({code:4900,message:'PAIR_EXPLICIT_DISCONNECT',reason:'permission-revoked'});
 await f.ui.disconnect();await f.ui.connect();assert.equal(f.ui.snapshot().reconnectBlocked,true);assert.equal(f.ui.checkOriginal().cleanupWitness,null);
 assert.deepEqual(f.counts(),{factories:1,calls:1,cancels:1,disconnects:0});
});
test('context change during original disconnect prevents a normal-session witness',async()=>{
 const cleanup=defer(),f=fixture({disconnect:()=>cleanup.promise,cleanupSnapshot:()=>({scope:'local-only',attempt:1,stage:'approval',connection:'fulfilled',initialization:'fulfilled',inFlight:false,draining:false,cancelled:false,cleanup:'unobserved',firstCause:{present:false,code:null},remoteCleanup:'not-proven',remoteCleanupUnconfirmed:true})});
 await f.ui.connect();const ending=f.ui.disconnect();await Promise.resolve();
 f.handlers.get('accountsChanged')([]);f.handlers.get('disconnect')({code:4900,message:'PAIR_EXPLICIT_DISCONNECT',reason:'permission-revoked'});cleanup.resolve();await ending;
 assert.equal(f.ui.snapshot().phase,'cleanup-unconfirmed');assert.equal(f.ui.snapshot().cleanupUnconfirmed,true);assert.equal(f.ui.snapshot().reconnectBlocked,true);assert.equal(f.ui.checkOriginal().cleanupWitness,null);
 await f.ui.connect();assert.equal(f.counts().calls,1);
});
