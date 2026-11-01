import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {AsyncLocalStorage} from 'node:async_hooks';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {createOriginalWalletProductContextBridge} from '../src/original-policy-supplier/product-native-context.mjs';
const account='0x'+'12'.repeat(20),network='34'.repeat(32);
// Execute the normal Main composition body unchanged with the actual key
// lifecycle and actual context bridge. Native identity/Root are controlled
// fixtures here; this test cannot qualify a Source or enter a real transport.
const main=fs.readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
const actual=main.slice(main.indexOf('function captureOriginalMainProductFactories(){'),main.indexOf('function invalidateOriginalMainContexts(){'));
function fixture(t,{wait=async()=>{}}={}){
 let bridge,retired=0,captures=0,peer,readback,saved;
 const nativeOwner=Object.freeze({retire(){retired++;}}),productNativeContext=new AsyncLocalStorage();
 const keyAccess=new DesktopKeyLifecycle({focused:()=>true,authorizer:{available:()=>true,method:'PUBLIC-CONTROL',authenticate:async()=>({account})},beforeInvalidate:()=>bridge?.invalidateAll()});
 const state={isChanging:false};
 const factories=Object.freeze({async acquireOriginalProductSource(){captures++;peer=bridge.capture();bridge.associate(peer,nativeOwner);readback=peer.readOriginalContextDATA();await wait();saved=nativeOwner;return nativeOwner;},isOriginalProductSource:v=>v===nativeOwner});
 bridge=createOriginalWalletProductContextBridge(()=>productNativeContext.getStore(),{isOriginalNativeOwner:factories.isOriginalProductSource});
 const build=new Function('captureOriginalProductSourceFactories','productNativeContext','keyAccess','mainWindow','walletAuthority','PQ_CANONICAL_NETWORK_ID','state',`let originalProductFactories=null;${actual.replaceAll('accountChangeInProgress','state.isChanging')}return captureOriginalMainProductFactories;`);
 const getFactories=build(()=>factories,productNativeContext,keyAccess,{isFocused:()=>true},{vault:{status:async()=>({initialized:true,account})}},network,state);
 t.after(async()=>{bridge.invalidateAll();if(peer){await peer.join();await peer.close();}keyAccess.lock();});
 return{keyAccess,bridge,getFactories,nativeOwner,get peer(){return peer;},get readback(){return readback;},get saved(){return saved;},get retired(){return retired;},get captures(){return captures;},state};
}
test('normal Main factory captures exact2 only under actual key lifecycle request and retires it when that request ends',async t=>{
 const f=fixture(t),factories=f.getFactories();await assert.rejects(factories.acquireOriginalProductSource());assert.equal(f.captures,0);await f.keyAccess.unlock();
 await f.keyAccess.run(async()=>{assert.equal(await factories.acquireOriginalProductSource(),f.nativeOwner);assert.deepEqual(f.readback,{networkId:network,account});assert.equal(f.peer.current(),undefined);});
 assert.equal(f.retired,1);assert.throws(()=>f.peer.current(),/RETIRED/);await f.peer.join();await f.peer.close();f.bridge.assertSafeToClose();
});
test('late Native owner remains adopted before the enclosing real guard rejects after lock',async t=>{
 let release,entered;const ready=new Promise(r=>{entered=r;}),f=fixture(t,{wait:()=>{entered();return new Promise(r=>{release=r;});}});await f.keyAccess.unlock();let received;
 const task=f.keyAccess.run(async()=>{received=await f.getFactories().acquireOriginalProductSource();});const rejection=assert.rejects(task);await ready;f.keyAccess.lock();release();await rejection;
 assert.equal(received,f.nativeOwner);assert.equal(f.saved,f.nativeOwner);assert.equal(f.retired,1);assert.throws(()=>f.peer.current(),/RETIRED/);
});
