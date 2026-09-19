import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {allSelectedBrowsersPassed,bounded,capturePwaFailure,pwaFrameReady} from '../scripts/runtime-evidence.mjs';

test('every selected browser must pass, including when another browser passes',()=>{
  assert.equal(allSelectedBrowsersPassed([]),false);
  assert.equal(allSelectedBrowsersPassed([{temporaryUnpackedRuntimeTested:true},{temporaryUnpackedRuntimeTested:false}]),false);
  assert.equal(allSelectedBrowsersPassed([{temporaryUnpackedRuntimeTested:true}]),true);
});
test('failure diagnostics preserve independent document/worker/cache observations if integrity snapshot hangs',async()=>{
  let index=0;
  const values=[{iframe:{pwa:'failed'}},[{scope:'/wallet/',active:{state:'activated'}}],[{name:'v8',entries:['app.js']}]];
  const page={evaluate:()=>index<3?Promise.resolve(values[index++]):new Promise(()=>{})};
  const result=await capturePwaFailure(page,{timeoutMs:20});
  assert.deepEqual(result.document,values[0]);assert.deepEqual(result.workers,values[1]);assert.deepEqual(result.caches,values[2]);
  assert.equal(result.detailedSnapshot.error.code,'GATE_TIMEOUT');
});
test('closed pages produce explicit per-component diagnostics, not a null snapshot',async()=>{
  const result=await capturePwaFailure({evaluate:()=>Promise.reject(new Error('Target closed'))});
  for(const value of Object.values(result))assert.equal(value.error.message,'Target closed');
  await assert.rejects(bounded(new Promise(()=>{}),10,'stalled read'),{code:'GATE_TIMEOUT'});
});
test('real page provider announces independently with a frozen preexisting foreign providers array',async()=>{
  const html=await readFile(new URL('./fixtures/dapp-eip6963-frozen.html',import.meta.url),'utf8');
  const source=await readFile(new URL('../extension/page-provider.js',import.meta.url),'utf8');
  const events=new EventTarget();
  const sandbox={Event,CustomEvent,location:{protocol:'https:',origin:'https://fixture.test'},crypto:globalThis.crypto,queueMicrotask,MessageChannel,Uint8Array,setTimeout,clearTimeout};
  sandbox.window=sandbox;sandbox.addEventListener=events.addEventListener.bind(events);sandbox.dispatchEvent=events.dispatchEvent.bind(events);
  const context=vm.createContext(sandbox);
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/u)[1],context);
  const foreign=context.ethereum;
  vm.runInContext(source,context);await new Promise(resolve=>queueMicrotask(resolve));
  events.dispatchEvent(new Event('eip6963:requestProvider'));
  const announcements=context.__YNX_EIP6963_FIXTURE__.announcements;
  assert.equal(announcements.length,1);assert.equal(announcements[0].info.rdns,'com.ynx.wallet');
  assert.equal(announcements[0].provider.__ynxCompanion,true);assert.notEqual(announcements[0].provider,foreign.providers[0]);
  assert.equal(context.ethereum,foreign);assert.equal(foreign.providers.length,1);assert.equal(Object.isFrozen(foreign.providers),true);
});

test('PWA readiness polls through detached or navigating iframe documents',()=>{
  for(const frame of [null,{contentDocument:null},{contentDocument:{documentElement:null}},{contentDocument:{documentElement:{dataset:{}}}}]){
    const context=vm.createContext({document:{querySelector:()=>frame}});
    assert.equal(vm.runInContext('('+pwaFrameReady.toString()+')()',context),false);
  }
  const context=vm.createContext({document:{querySelector:()=>({contentDocument:{documentElement:{dataset:{pwa:'ready'}}}})}});
  assert.equal(vm.runInContext('('+pwaFrameReady.toString()+')()',context),true);
});
