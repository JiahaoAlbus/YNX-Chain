import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const entry=fileURLToPath(new URL('../src/walletconnect-dapp-connection.js',import.meta.url));
const fakeCore=`export const RELAYER_EVENTS={connect:'connect'};export class Core{constructor(options){const s=globalThis.__ynxPartialInit;s.constructions++;s.databases.push(options.storageOptions.database);globalThis._walletConnectCore__count=(globalThis._walletConnectCore__count||0)+1;if(s.throwConstructor)throw s.firstCause;if(!s.disabled&&globalThis._walletConnectCore_)return globalThis._walletConnectCore_;this.identity={};this.customStoragePrefix='';this.relayer={on(){},transportClose:async()=>{s.closes++}};this.pairing={pairings:{getAll:()=>[]}};if(!s.disabled)globalThis._walletConnectCore_=this;}}`;
const fakeClient=`export default class SignClient{static async init(options){const s=globalThis.__ynxPartialInit;s.initializations++;s.cores.push(options.core);if(s.gate)await s.gate;throw s.firstCause;}}`;
let serial=0;
async function fixture(options={}){
 const prior={core:globalThis._walletConnectCore_,count:globalThis._walletConnectCore__count};delete globalThis._walletConnectCore_;delete globalThis._walletConnectCore__count;
 const state={...options,constructions:0,initializations:0,closes:0,databases:[],cores:[],firstCause:Object.hasOwn(options,'failure')?options.failure:Object.assign(Error('ORIGINAL_PARTIAL_INIT_FAILURE'),{code:'PARTIAL_INIT'})};
 if(options.foreign){globalThis._walletConnectCore_={customStoragePrefix:'',relayer:{transportClose:async()=>state.closes++}};globalThis._walletConnectCore__count=1;}
 globalThis.__ynxPartialInit=state;
 const result=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'PUBLIC-partial-init',setup(b){b.onResolve({filter:/^@walletconnect\/(core|sign-client)$/},a=>({path:a.path,namespace:'PUBLIC'}));b.onLoad({filter:/.*/,namespace:'PUBLIC'},a=>({contents:a.path.endsWith('/core')?fakeCore:fakeClient,loader:'js'}));}}]});
 const {createWalletAddressConnection}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#partial-init-${++serial}`);
 return {state,connection:createWalletAddressConnection,close(){delete globalThis.__ynxPartialInit;if(prior.core===undefined)delete globalThis._walletConnectCore_;else globalThis._walletConnectCore_=prior.core;if(prior.count===undefined)delete globalThis._walletConnectCore__count;else globalThis._walletConnectCore__count=prior.count;}};
}
test('default initialization failure never replays Core construction or SignClient init over the original database',async()=>{
 for(const mode of [{},{disabled:true},{foreign:true},{throwConstructor:true}]){
  const f=await fixture(mode);try{const c=f.connection();
   for(const owner of [c,c,f.connection()])await assert.rejects(owner.initialize(),error=>error===f.state.firstCause);
   assert.equal(f.state.constructions,1);assert.equal(f.state.initializations,mode.throwConstructor?0:1);assert.deepEqual(f.state.databases,['ynx-pair-wallet.ynxweb4.com']);assert.equal(f.state.closes,0);
  }finally{f.close();}
 }
});
test('connect retains first initialization cause independently from cleanup UNKNOWN',async()=>{
 const f=await fixture();try{const c=f.connection(),notices=[];c.on('cancelUnconfirmed',v=>notices.push(v));
  for(let i=0;i<2;i++)await assert.rejects(c.connect(),error=>error.code==='YNX_PAIR_INITIALIZATION_UNAVAILABLE'&&error.cause===f.state.firstCause);
  assert.equal(f.state.constructions,1);assert.equal(f.state.initializations,1);assert.equal(f.state.closes,0);
  assert.ok(notices.some(v=>v.reason==='initialization-unresolved'));
 }finally{f.close();}
});
test('failed default initialization cancel/disconnect stay unconfirmed and never claim permission revocation',async()=>{
 for(const method of ['cancel','disconnect']){const f=await fixture({foreign:true});try{const c=f.connection(),notices=[],disconnected=[];c.on('cancelUnconfirmed',v=>notices.push(v));c.on('disconnect',v=>disconnected.push(v));await assert.rejects(c.initialize(),e=>e===f.state.firstCause);
  await assert.rejects(c[method](),e=>e.code==='YNX_PAIR_CLEANUP_UNCONFIRMED'&&e.cause===f.state.firstCause);assert.equal(notices.length,1);assert.equal(notices[0].reason,'initialization-unresolved');assert.equal(disconnected.length,0);assert.equal(f.state.closes,0);
  await assert.rejects(c.initialize(),e=>e===f.state.firstCause);assert.equal(f.state.constructions,1);
 }finally{f.close();}}
});
test('cancel before late initialization failure preserves cancellation first cause and permanently fences retry',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({gate});try{const c=f.connection(),notices=[];c.on('cancelUnconfirmed',v=>notices.push(v));const pending=c.connect(),rejected=assert.rejects(pending,e=>e.code==='YNX_PAIR_CANCELLED');await tick();
 await c.cancel().catch(error=>assert.equal(error.code,'YNX_PAIR_CLEANUP_UNCONFIRMED'));await rejected;release();await tick();
 await assert.rejects(c.initialize(),e=>e===f.state.firstCause);assert.equal(f.state.constructions,1);assert.equal(f.state.initializations,1);assert.equal(f.state.closes,0);assert.ok(notices.some(v=>v.reason==='initialization-unresolved'));
 }finally{release();await tick();f.close();}
});

test('primitive initialization causes remain exact across retries and independent cleanup rejection',async()=>{
 for(const failure of [undefined,null,false,0,'']){const f=await fixture({failure});try{const c=f.connection();
  for(let i=0;i<2;i++)await assert.rejects(c.initialize(),e=>e===failure);
  await assert.rejects(c.connect(),e=>e.code==='YNX_PAIR_INITIALIZATION_UNAVAILABLE'&&Object.hasOwn(e,'cause')&&e.cause===failure);
  await assert.rejects(c.disconnect(),e=>e.code==='YNX_PAIR_CLEANUP_UNCONFIRMED'&&Object.hasOwn(e,'cause')&&e.cause===failure);
  assert.equal(f.state.constructions,1);assert.equal(f.state.initializations,1);assert.equal(f.state.closes,0);
 }finally{f.close();}}
});
test('throwing cleanup listeners cannot replace initialization cause or independent cleanup UNKNOWN',async()=>{
 const f=await fixture();try{const c=f.connection(),notificationCause=Error('CONSUMER_NOTICE_FAILED');c.on('cancelUnconfirmed',()=>{throw notificationCause;});
 await assert.rejects(c.connect(),e=>e.code==='YNX_PAIR_INITIALIZATION_UNAVAILABLE'&&e.cause===f.state.firstCause&&e.cleanupError?.notificationCause===notificationCause);
 for(const method of ['cancel','disconnect'])await assert.rejects(c[method](),e=>e.code==='YNX_PAIR_CLEANUP_UNCONFIRMED'&&e.cause===f.state.firstCause&&e.notificationCause===notificationCause);
 assert.equal(f.state.constructions,1);assert.equal(f.state.closes,0);
 }finally{f.close();}
});
test('cancel before default factory constructs Core still reports late failed initialization debt',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),f=await fixture({gate});try{const c=f.connection(),notices=[];c.on('cancelUnconfirmed',v=>notices.push(v));
 const pending=c.connect(),rejected=assert.rejects(pending,e=>e.code==='YNX_PAIR_CANCELLED');await c.cancel().catch(e=>assert.equal(e.code,'YNX_PAIR_CLEANUP_UNCONFIRMED'));await rejected;
 const before=notices.length;release();await tick();
 assert.ok(notices.length>before,'late initialization rejection reports its own unresolved cleanup');assert.equal(notices.at(-1).reason,'initialization-unresolved');
 await assert.rejects(c.initialize(),e=>e===f.state.firstCause);assert.equal(f.state.constructions,1);assert.equal(f.state.closes,0);
 }finally{release();await tick();f.close();}
});
