import test from 'node:test';
import assert from 'node:assert/strict';
import {createAddressConnectionConsumer,ADDRESS_CONNECTION_ORIGIN} from '../src/walletconnect-address-consumer.mjs';
const account='0x'+'a'.repeat(40);
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture({connect,disconnect=async()=>{},cancel=async()=>{},chain='0x1917',accounts=[account]}={}){
 const handlers=new Map(),requests=[],states=[],uris=[];let factories=0,calls=0,cancels=0,disconnects=0;
 const provider={request:async input=>{requests.push(input);return input.method==='eth_chainId'?chain:accounts;}};
 const original={on:(name,fn)=>handlers.set(name,fn),connect:async options=>{calls++;return connect?connect(options,provider):provider;},cancel:()=>{cancels++;return cancel();},disconnect:()=>{disconnects++;return disconnect();}};
 const ui=createAddressConnectionConsumer({origin:ADDRESS_CONNECTION_ORIGIN,createConnection:options=>{factories++;assert.deepEqual(options,{origin:ADDRESS_CONNECTION_ORIGIN,methods:[]});return original;},onState:s=>states.push(s),onURI:uri=>uris.push(uri),clearURI:()=>uris.splice(0)});
 return {ui,original,provider,requests,states,uris,handlers,counts:()=>({factories,calls,cancels,disconnects})};
}
test('normal address consumer is lazy and reads only the one approved address and chain',async()=>{
 const f=fixture();assert.equal(f.counts().factories,0);const state=await f.ui.connect();
 assert.equal(state.phase,'connected');assert.equal(state.account,account);assert.equal(state.chainId,'0x1917');
 assert.deepEqual(f.requests,[{method:'eth_chainId'},{method:'eth_accounts'}]);
 assert.deepEqual(Object.keys(f.ui),['connect','cancel','disconnect','snapshot']);assert.equal(Object.isFrozen(state),true);
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
