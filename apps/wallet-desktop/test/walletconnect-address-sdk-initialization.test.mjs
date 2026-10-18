import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFileSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {createAddressConnectionConsumer,ADDRESS_CONNECTION_ORIGIN} from '../src/walletconnect-address-consumer.mjs';

// Actual same-copy public SDK default factory and App controller, with only
// public Core/SignClient imports instrumented. No Relay, browser, account,
// database contents, installed application or actual cleanup is exercised.
const sdkPackage=fileURLToPath(new URL('../../../packages/wallet-auth/package.json',import.meta.url));
const toolPackage=process.env.YNX_WALLET_TEST_TOOLCHAIN_PACKAGE??sdkPackage;
const toolRequire=createRequire(toolPackage);
const toolRoot=realpathSync(path.join(path.dirname(toolPackage),'node_modules'))+path.sep;
const toolPath=realpathSync(toolRequire.resolve('esbuild'));
assert.ok(toolPath.startsWith(toolRoot),'test bundler must belong to the explicitly selected SDK install');
assert.equal(toolRequire('esbuild/package.json').version,JSON.parse(readFileSync(sdkPackage)).devDependencies.esbuild);
const {build}=toolRequire('esbuild');
const entry=fileURLToPath(new URL('../../../packages/wallet-auth/src/walletconnect-dapp-connection.js',import.meta.url));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let serial=0;
async function fixture({gated=false}={}){
 const prior={core:globalThis._walletConnectCore_,count:globalThis._walletConnectCore__count};
 delete globalThis._walletConnectCore_;delete globalThis._walletConnectCore__count;
 let release;const state={constructions:0,initializations:0,closes:0,causes:[],databases:[],firstCause:Error('PUBLIC_SIGNCLIENT_INIT_FAILED')};
 if(gated)state.gate=new Promise(resolve=>release=resolve);
 globalThis.__walletAppInitFixture=state;
 const core=`export const RELAYER_EVENTS={connect:'connect'};export class Core{constructor(options){const s=globalThis.__walletAppInitFixture;s.constructions++;s.databases.push(options.storageOptions.database);globalThis._walletConnectCore__count=(globalThis._walletConnectCore__count||0)+1;this.customStoragePrefix='';this.relayer={on(){},transportClose:async()=>s.closes++};this.pairing={pairings:{getAll:()=>[]}};globalThis._walletConnectCore_=this;}}`;
 const client=`export default class SignClient{static async init(){const s=globalThis.__walletAppInitFixture;s.initializations++;if(s.gate)await s.gate;throw s.firstCause;}}`;
 const result=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'explicit-public-initialization-instrument',setup(b){b.onResolve({filter:/^@walletconnect\/(core|sign-client)$/},a=>({path:a.path,namespace:'PUBLIC'}));b.onLoad({filter:/.*/,namespace:'PUBLIC'},a=>({contents:a.path.endsWith('/core')?core:client,loader:'js'}));}}]});
 const {createWalletAddressConnection}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#app-init-${++serial}`);
 const sdk=createWalletAddressConnection(),events=[],uris=[],states=[];
 sdk.on('cancelUnconfirmed',v=>events.push(v));sdk.on('disconnect',v=>events.push({falseDisconnect:v}));
 // Observes the original public rejection without changing it or injecting
 // a different clientFactory: the official initialization latch still runs.
 const adapter={on:(...args)=>sdk.on(...args),connect:async(...args)=>{try{return await sdk.connect(...args);}catch(error){state.causes.push(error);throw error;}},cancel:()=>sdk.cancel(),disconnect:()=>sdk.disconnect()};
 const ui=createAddressConnectionConsumer({origin:ADDRESS_CONNECTION_ORIGIN,createConnection:()=>adapter,onURI:v=>uris.push(v),onState:v=>states.push(v)});
 return {state,sdk,ui,events,uris,states,release,async close(){release?.();await tick();delete globalThis.__walletAppInitFixture;if(prior.core===undefined)delete globalThis._walletConnectCore_;else globalThis._walletConnectCore_=prior.core;if(prior.count===undefined)delete globalThis._walletConnectCore__count;else globalThis._walletConnectCore__count=prior.count;}};
}
function unknown(f){
 assert.equal(f.ui.snapshot().phase,'cleanup-unconfirmed');assert.equal(f.ui.snapshot().cleanupUnconfirmed,true);
 assert.equal(f.ui.snapshot().account,null);assert.equal(f.ui.snapshot().chainId,null);assert.equal(f.ui.snapshot().pendingOriginal,false);
 assert.equal(f.state.constructions,1);assert.equal(f.state.initializations,1);assert.equal(f.state.closes,0);
 assert.deepEqual(f.state.databases,['ynx-pair-wallet.ynxweb4.com']);assert.deepEqual(f.uris,[]);
 assert.ok(f.events.some(v=>v.current===true&&v.reason==='initialization-unresolved'));
 assert.ok(!f.events.some(v=>v.falseDisconnect));
 assert.ok(!f.states.some(v=>['connected','disconnected'].includes(v.phase)));
}
test('same-copy SDK310 partial initialization stays UNKNOWN in Wallet and blocks replay',async()=>{
 const f=await fixture();try{
  await f.ui.connect();unknown(f);assert.equal(f.state.causes[0].code,'YNX_PAIR_INITIALIZATION_UNAVAILABLE');assert.equal(f.state.causes[0].cause,f.state.firstCause);
  for(const method of ['connect','cancel','disconnect','connect'])await f.ui[method]();unknown(f);
  await assert.rejects(f.sdk.initialize(),error=>error===f.state.firstCause);unknown(f);
 }finally{await f.close();}
});
test('same-copy SDK310 late failed initialization cannot turn prior cancel into confirmed cleanup',async()=>{
 const f=await fixture({gated:true});try{
  const pending=f.ui.connect();for(let i=0;i<100&&!f.state.initializations;i++)await tick();
  assert.equal(f.state.initializations,1,'controlled initialization must begin within the bounded fixture window');
  await f.ui.cancel();await pending;f.release();await tick();unknown(f);
  assert.equal(f.state.causes[0].code,'YNX_PAIR_CANCELLED');
  for(const method of ['connect','disconnect','cancel'])await f.ui[method]();unknown(f);
  await assert.rejects(f.sdk.initialize(),error=>error===f.state.firstCause);unknown(f);
 }finally{await f.close();}
});
