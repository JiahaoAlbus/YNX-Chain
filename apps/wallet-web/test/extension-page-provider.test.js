import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source=readFileSync(new URL('../extension/page-provider.js',import.meta.url),'utf8');
const origin='https://coexist.fixture.invalid';
function fixture(existing,setup){
  const listeners=new Map(),queue=[],announcements=[],packets=[],timers=new Set();
  const window={addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},dispatchEvent(event){if(event.type==='eip6963:announceProvider')announcements.push(event.detail);for(const fn of listeners.get(event.type)||[])fn(event);},postMessage(data,to){assert.equal(to,origin);packets.push(data);}};
  if(existing!==undefined)window.ethereum=existing;
  setup?.(window);
  const context=vm.createContext({window,location:{origin,protocol:'https:'},crypto:webcrypto,queueMicrotask:fn=>queue.push(fn),setTimeout(fn,ms){const timer=setTimeout(fn,ms);timers.add(timer);return timer;},clearTimeout(timer){clearTimeout(timer);timers.delete(timer);},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}}});
  const f={window,context,announcements,packets,listeners,flush(){while(queue.length)queue.shift()();},run(){vm.runInContext(source,context);f.flush();return context.__YNX_COMPANION_PROVIDER_V1__;},close(){for(const timer of timers)clearTimeout(timer);},reply(id,result){window.dispatchEvent({type:'message',source:window,origin,data:{type:'YNX_PAGE_RESPONSE_V1',version:1,origin,requestId:id,ok:true,result}});}};
  return f;
}
const metamask=()=>({isMetaMask:true,calls:[],request(input){this.calls.push(input);return Promise.resolve(['metamask-fixture']);}});
test('MetaMask first: original global and identity retained; chosen YNX request uses only YNX bridge',async t=>{
  const mm=metamask(),f=fixture(mm);t.after(()=>f.close());const ynx=f.run();
  assert.equal(f.window.ethereum,mm);assert.equal(mm.isMetaMask,true);assert.equal(mm.isYNXWallet,undefined);
  assert.equal(Object.hasOwn(mm,'providers'),false);
  assert.equal(ynx.isMetaMask,false);assert.equal(f.announcements[0].provider,ynx);
  const response=ynx.request({method:'eth_accounts'});assert.equal(mm.calls.length,0);assert.equal(f.packets[0].type,'YNX_PAGE_REQUEST_V1');
  f.reply(f.packets[0].requestId,[]);assert.deepEqual(await response,[]);
});
test('reannounce retains the same YNX object and metadata, with no automatic account request',t=>{
  const f=fixture();t.after(()=>f.close());const ynx=f.run();
  f.window.dispatchEvent({type:'eip6963:requestProvider'});f.window.dispatchEvent({type:'eip6963:requestProvider'});
  assert.equal(f.announcements.length,3);assert.ok(f.announcements.every(a=>a.provider===ynx&&a.info===ynx.providerInfo));assert.equal(f.packets.length,0);
  assert.ok(Object.isFrozen(ynx));assert.ok(Object.isFrozen(f.announcements[0]));
});
test('frozen external provider without providers array does not prevent EIP6963 announcement',t=>{
  const mm=Object.freeze(metamask()),f=fixture(mm);t.after(()=>f.close());assert.doesNotThrow(()=>f.run());assert.equal(f.announcements.length,1);assert.equal(f.window.ethereum,mm);
});
test('pre-existing frozen providers array cannot abort independent YNX EIP6963 registration',t=>{
  const mm=metamask();Object.defineProperty(mm,'providers',{value:Object.freeze([mm]),writable:false});
  const f=fixture(mm);t.after(()=>f.close());let error;try{f.run();}catch(e){error=e;}
  // A plain read-only array is legal third-party state; no malicious code needed.
  assert.equal(error,undefined,`Optional legacy aggregation aborted initialization: ${error?.message}; announcements=${f.announcements.length}; listener=${f.listeners.has('eip6963:requestProvider')}; sticky marker=${!!f.context.__YNX_COMPANION_PROVIDER_V1__}`);
  assert.equal(f.announcements.length,1);
});
test('third-party providers getter is never evaluated for YNX discovery',t=>{
  let getterCalls=0;
  const mm=metamask();Object.defineProperty(mm,'providers',{get(){getterCalls++;throw Error('third party unavailable');}});
  const f=fixture(mm);t.after(()=>f.close());let error;try{f.run();}catch(e){error=e;}
  assert.equal(error,undefined,`External optional providers accessor escaped: ${error?.message}`);
  assert.equal(f.announcements.length,1);assert.equal(getterCalls,0);
});
test('YNX-first legacy fallback remains compatible with later provider assignment',t=>{
  const f=fixture();t.after(()=>f.close());const ynx=f.run();const mm=metamask();f.context.laterProvider=mm;
  // MetaMask upstream setGlobalProvider uses this exact strict-module assignment;
  // it catches the failure. Its earlier EIP6963 announcement remains separate.
  let error;try{vm.runInContext('"use strict"; window.ethereum = laterProvider;',f.context);}catch(e){error=e;}
  assert.equal(error,undefined,`Later legacy injection failed: ${error?.message}; descriptor=${JSON.stringify(Object.getOwnPropertyDescriptor(f.window,'ethereum'),(key,value)=>key==='value'?'YNX provider':value)}`);
  assert.equal(f.window.ethereum,mm);assert.equal(f.announcements[0].provider,ynx);
});
test('throwing global getter or occupied nonconfigurable empty slot cannot block announcement or reannouncement',t=>{
  for(const descriptor of [{get(){throw Error('another wallet not ready');},configurable:false},{value:undefined,writable:false,configurable:false}]){
    const f=fixture(undefined,window=>Object.defineProperty(window,'ethereum',descriptor));t.after(()=>f.close());
    const ynx=f.run();assert.equal(f.announcements.length,1);
    f.window.dispatchEvent({type:'eip6963:requestProvider'});assert.equal(f.announcements.length,2);
    assert.equal(f.announcements[1].provider,ynx);
    // A repeated injection keeps the original event registration and provider.
    assert.equal(f.run(),ynx);assert.equal(f.announcements.length,2);
    assert.equal(f.listeners.get('eip6963:requestProvider').length,1);
  }
});
test('an existing mutable provider collection is preserved byte-for-byte and gains no YNX mutation',t=>{
  const mm=metamask(),other={request:async()=>[]},providers=[mm,other];mm.providers=providers;
  const before=Object.getOwnPropertyDescriptors(mm),f=fixture(mm);t.after(()=>f.close());const ynx=f.run();
  assert.equal(f.window.ethereum,mm);assert.equal(mm.providers,providers);
  assert.deepEqual(providers,[mm,other]);assert.deepEqual(Object.getOwnPropertyDescriptors(mm),before);
  assert.equal(f.announcements[0].provider,ynx);
});
