import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('../src/walletconnect-dapp-connection.js',import.meta.url));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const core=`export const RELAYER_EVENTS={connect:'relay'};export class Core{constructor(){const s=globalThis.__snapshotQA;s.constructors++;this.customStoragePrefix='';this.relayer={on(){},transportClose:async()=>{s.closes++;if(s.closeGate)await s.closeGate;if(s.closeFailure)throw s.closeFailure}};this.pairing={pairings:{getAll(){s.reads++;return []}},disconnect:async()=>{s.disconnects++;if(s.pairingGate)await s.pairingGate}};globalThis._walletConnectCore_=this;globalThis._walletConnectCore__count=1;}}`;
const sign=`export default class SignClient{static async init(options){const s=globalThis.__snapshotQA;s.factories++;if(s.initGate)await s.initGate;if(s.failInit)throw s.failure;return {core:options.core,on(){},session:{getAll(){s.reads++;return []}},proposal:{getAll(){s.reads++;return []}},connect(){s.connects++;return s.connectGate},disconnect:async()=>{s.disconnects++}};}}`;
let serial=0;
async function fixture(options={}){
 const previous={core:globalThis._walletConnectCore_,count:globalThis._walletConnectCore__count};delete globalThis._walletConnectCore_;delete globalThis._walletConnectCore__count;
 let resolveConnect;const state={constructors:0,factories:0,connects:0,disconnects:0,closes:0,reads:0,...options};state.connectGate??=new Promise(resolve=>resolveConnect=resolve);globalThis.__snapshotQA=state;
 const result=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'PUBLIC-snapshot-dependencies',setup(b){b.onResolve({filter:/^@walletconnect\/(core|sign-client)$/},a=>({path:a.path,namespace:'PUBLIC'}));b.onLoad({filter:/.*/,namespace:'PUBLIC'},a=>({contents:a.path.endsWith('/core')?core:sign,loader:'js'}));}}]});
 const api=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#snapshot${++serial}`);
 return {connection:api.createWalletAddressConnection({deadlineMs:100}),state,resolveConnect,close(){delete globalThis.__snapshotQA;if(previous.core===undefined)delete globalThis._walletConnectCore_;else globalThis._walletConnectCore_=previous.core;if(previous.count===undefined)delete globalThis._walletConnectCore__count;else globalThis._walletConnectCore__count=previous.count;}};
}
const counters=s=>JSON.stringify([s.constructors,s.factories,s.connects,s.disconnects,s.closes,s.reads]);
function observe(c,s){const before=counters(s),snapshot=c.cleanupSnapshot();assert.equal(counters(s),before);assert.equal(snapshot.scope,'local-only');assert.equal(snapshot.remoteCleanup,'not-proven');assert.equal(snapshot.remoteCleanupUnconfirmed,true);assert.equal(Object.isFrozen(snapshot),true);assert.equal(Object.isFrozen(snapshot.firstCause),true);assert.throws(()=>{snapshot.attempt=100;},TypeError);assert.throws(()=>{snapshot.firstCause.present=false;},TypeError);return snapshot;}
test('public cleanup observation exists and initial absence is never success or an SDK operation',async()=>{
 const f=await fixture();try{assert.equal(typeof f.connection.cleanupSnapshot,'function');const a=observe(f.connection,f.state);assert.equal(a.attempt,0);assert.equal(a.stage,'idle');assert.equal(a.connection,'not-started');assert.equal(a.initialization,'not-started');assert.equal(a.cleanup,'unobserved');assert.equal(a.firstCause.present,false);assert.equal(a.firstCause.code,null);assert.equal(a.inFlight,false);assert.equal(f.state.constructors,0);}finally{f.close();}
});
test('concurrent observations retain one original connect and expose cancel/init pending before late failure',async()=>{
 let release;const initGate=new Promise(resolve=>release=resolve),f=await fixture({initGate,failInit:true,failure:Error('SECRET_LATE_FAILURE')});try{const c=f.connection,pending=c.connect(),rejected=assert.rejects(pending,e=>e.code==='YNX_PAIR_CANCELLED');assert.equal(pending,c.connect());await tick();const before=counters(f.state);
 const snapshots=await Promise.all(Array.from({length:16},()=>Promise.resolve().then(()=>observe(c,f.state))));assert.equal(counters(f.state),before);for(const s of snapshots){assert.equal(s.connection,'pending');assert.equal(s.initialization,'pending');assert.equal(s.attempt,1);}
 await c.cancel().catch(e=>assert.equal(e.code,'YNX_PAIR_CLEANUP_UNCONFIRMED'));await rejected;let s=observe(c,f.state);assert.equal(s.cancelled,true);assert.equal(s.connection,'rejected');assert.equal(s.initialization,'pending');assert.equal(s.cleanup,'unknown');assert.equal(s.firstCause.code,'YNX_PAIR_CANCELLED');
 release();await tick();s=observe(c,f.state);assert.equal(s.initialization,'rejected');assert.equal(s.firstCause.code,'YNX_PAIR_CANCELLED');assert.equal(s.cleanup,'unknown');assert.equal(JSON.stringify(s).includes('SECRET'),false);assert.equal(f.state.constructors,1);assert.equal(f.state.factories,1);assert.equal(f.state.connects,0);assert.equal(f.state.closes,0);
 }finally{release();await tick();f.close();}
});
test('raw primitive first failure is present and code accessors/messages are never inspected',async()=>{
 for(const failure of [undefined,false,0,null,'SECRET_TEXT',Object.defineProperty(Error('SECRET_MESSAGE'),'code',{get(){throw Error('GETTER_MUST_NOT_RUN')}})]){const f=await fixture({failInit:true,failure});try{await assert.rejects(f.connection.initialize(),e=>e===failure);const s=observe(f.connection,f.state);assert.equal(s.initialization,'rejected');assert.equal(s.firstCause.present,true);assert.equal(s.firstCause.code,'UNCLASSIFIED');assert.equal(JSON.stringify(s).includes('SECRET'),false);assert.equal(f.state.constructors,1);assert.equal(f.state.factories,1);}finally{f.close();}}
});
test('local fulfilled session promise does not prove remote cleanup and snapshots contain no session material',async()=>{
 const f=await fixture();try{const c=f.connection,pending=c.connect();await tick();const topic='a'.repeat(64),key='b'.repeat(64),account='0x'+'1'.repeat(40);f.resolveConnect({uri:`wc:${topic}@2?relay-protocol=irn&symKey=${key}`,approval:async()=>({topic,expiry:Math.floor(Date.now()/1000)+100,peer:{metadata:{url:'https://wallet.ynxweb4.com'}},namespaces:{eip155:{chains:['eip155:6423'],methods:[],events:[],accounts:[`eip155:6423:${account}`]}}})});await pending;const s=observe(c,f.state);assert.equal(s.connection,'fulfilled');assert.equal(s.initialization,'fulfilled');assert.equal(s.inFlight,false);for(const secret of [topic,key,account,'symKey','uri','topic','stack','message'])assert.equal(JSON.stringify(s).includes(secret),false);assert.equal(s.remoteCleanupUnconfirmed,true);}finally{f.close();}
});

test('approval cancellation remains in flight until original connect and cleanup promises actually settle',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),topic='c'.repeat(64),f=await fixture({closeGate:gate,pairingGate:gate,connectGate:Promise.resolve({uri:`wc:${topic}@2?relay-protocol=irn&symKey=${'d'.repeat(64)}`,approval:()=>new Promise(()=>{})})});
 try{const c=f.connection,pending=c.connect(),rejected=assert.rejects(pending,e=>e.code==='YNX_PAIR_CANCELLED');await tick();assert.equal(c.cleanupSnapshot().stage,'approval');const cancelled=c.cancel();await tick();const s=observe(c,f.state);assert.equal(s.connection,'pending');assert.equal(s.initialization,'fulfilled');assert.equal(s.draining,false);assert.equal(s.cancelled,true);assert.equal(s.inFlight,true);
 release();await cancelled;await rejected;assert.equal(observe(c,f.state).inFlight,false);
 }finally{release();await tick();f.close();}
});
test('late draining result and later local pause cannot clear original UNKNOWN or first cause',async()=>{
 const f=await fixture({closeFailure:Error('SECRET_CLOSE_FAILURE')});try{const c=f.connection,pending=c.connect(),rejected=assert.rejects(pending,e=>e.code==='YNX_PAIR_CANCELLED');await tick();await c.cancel();await rejected;let s=observe(c,f.state);assert.equal(s.draining,true);assert.equal(s.cleanup,'unknown');assert.equal(s.firstCause.code,'YNX_PAIR_CANCELLED');
 f.resolveConnect({uri:`wc:${'e'.repeat(64)}@2?relay-protocol=irn&symKey=${'f'.repeat(64)}`,approval:async()=>undefined});await tick();s=observe(c,f.state);assert.equal(s.draining,false);assert.equal(s.cleanup,'unknown');assert.equal(s.remoteCleanupUnconfirmed,true);
 f.state.closeFailure=null;f.state.connectGate=new Promise(()=>{});const second=c.connect(),secondRejected=assert.rejects(second,e=>e.code==='YNX_PAIR_CANCELLED');await tick();await c.cancel();await secondRejected;s=observe(c,f.state);assert.equal(s.attempt,2);assert.equal(f.state.closes,2);assert.equal(s.cleanup,'unknown','later successful transport pause is only local and cannot clear debt');assert.equal(s.firstCause.code,'YNX_PAIR_CANCELLED');assert.equal(s.remoteCleanup,'not-proven');
 }finally{f.close();}
});
