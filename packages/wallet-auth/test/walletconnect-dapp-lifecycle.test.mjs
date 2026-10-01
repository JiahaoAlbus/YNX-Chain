import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const entry=new URL('../src/walletconnect-dapp-connection.js',import.meta.url).pathname;
const fakeCore=`export const RELAYER_EVENTS={connect:'relayer_connect'};export class Core{constructor(options){const s=globalThis.__ynxPairLifecycleFixture;s.coreOptions.push(options);globalThis._walletConnectCore__count=(globalThis._walletConnectCore__count||0)+1;if(globalThis._walletConnectCore_)return globalThis._walletConnectCore_;this.customStoragePrefix='';this.pairing={pairings:{getAll:()=>s.pairings},disconnect:async()=>{}};this.relayer={on:(event,fn)=>s.events.set(event,fn),transportClose:async()=>{s.closed++}};globalThis._walletConnectCore_=this;}}`;
const fakeClient=`export default class SignClient{static async init(options){const s=globalThis.__ynxPairLifecycleFixture;s.initializations++;if(s.initWait)await s.initWait;const client={core:options.core,on:()=>{},session:{getAll:()=>s.sessions},proposal:{getAll:()=>s.proposals},connect:()=>{s.connects++;return s.connectWait},disconnect:async()=>{s.retired++},request:async()=>({ok:true})};s.client=client;return client;}}`;
let moduleSerial=0;
async function fixture(){
  const prior={core:globalThis._walletConnectCore_,count:globalThis._walletConnectCore__count};delete globalThis._walletConnectCore_;delete globalThis._walletConnectCore__count;
  let finishConnect;const state={coreOptions:[],initializations:0,closed:0,connects:0,retired:0,sessions:[],proposals:[],pairings:[],events:new Map(),connectWait:new Promise((_,reject)=>finishConnect=()=>reject(new Error('network ended')))};
  state.connectWait.catch(()=>{});
  globalThis.__ynxPairLifecycleFixture=state;
  const result=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'isolated-official-contract',setup(builder){builder.onResolve({filter:/^@walletconnect\/(core|sign-client)$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.endsWith('/core')?fakeCore:fakeClient,loader:'js'}));}}]});
  const {WalletConnectDAppConnection}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${++moduleSerial}`);
  const connection=()=>new WalletConnectDAppConnection({origin:'https://finance.ynxweb4.com',methods:['personal_sign'],deadlineMs:100});
  return {state,connection,finishConnect,close(){delete globalThis.__ynxPairLifecycleFixture;if(prior.core===undefined)delete globalThis._walletConnectCore_;else globalThis._walletConnectCore_=prior.core;if(prior.count===undefined)delete globalThis._walletConnectCore__count;else globalThis._walletConnectCore__count=prior.count;}};
}
test('controlled default singleton pauses its sole empty Core lease without changing historical storage',async()=>{
  const f=await fixture();try{
    const connection=f.connection(),cleanup=[];connection.on('transportCleanup',event=>cleanup.push(event));
    const pending=connection.connect(),rejected=assert.rejects(pending,/CANCELLED/);await tick();await tick();await connection.cancel();await rejected;
    assert.equal(f.state.closed,1);assert.equal(cleanup[0].status,'transport-paused');assert.equal(cleanup[0].inFlight,true);
    assert.equal(f.state.coreOptions[0].storageOptions.database,'ynx-pair-finance.ynxweb4.com');assert.equal(f.state.coreOptions[0].customStoragePrefix,undefined);
    await assert.rejects(connection.connect(),/TRANSPORT_DRAINING/);assert.equal(f.state.connects,1);
    // The SDK can reopen on network change. The paused empty owned lease
    // closes again, while no late connect/approval event reaches the consumer.
    f.state.events.get('relayer_connect')();await tick();assert.equal(f.state.closed,2);
    f.state.sessions.push({topic:'a'.repeat(64)});f.state.events.get('relayer_connect')();await tick();assert.equal(f.state.closed,2,'a session appearing on the Core disables the paused reconnect guard');f.state.sessions=[];
    f.finishConnect();await tick();const next=connection.connect();await assert.rejects(next,/RELAY_UNAVAILABLE/);assert.equal(f.state.initializations,1);
  }finally{f.finishConnect();await tick();f.close();}
});
test('only the single proposal created during the controlled lease may be paused',async()=>{
  for(const extra of [false,true]){
    const f=await fixture();try{
      const connection=f.connection(),pending=connection.connect(),rejected=assert.rejects(pending,/CANCELLED/);await tick();await tick();
      const topic='a'.repeat(64);f.state.proposals.push({pairingTopic:topic,proposer:{metadata:{url:'https://finance.ynxweb4.com'}}});f.state.pairings.push({topic,active:false});
      if(extra)f.state.proposals.push({pairingTopic:'b'.repeat(64)});
      await connection.cancel();await rejected;assert.equal(f.state.closed,extra?0:1);
    }finally{f.finishConnect();await tick();f.close();}
  }
});
test('existing global Core, extra consumer or historical approval preserves transport',async()=>{
  for(const mode of ['existing-global','global','consumer','proposal','session','unknown-count','external-client']){
    const f=await fixture();try{
      if(mode==='existing-global'){globalThis._walletConnectCore_={customStoragePrefix:'',pairing:{pairings:{getAll:()=>f.state.pairings},disconnect:async()=>{}},relayer:{on:(name,fn)=>f.state.events.set(name,fn),transportClose:async()=>{f.state.closed++;}}};globalThis._walletConnectCore__count=1;}
      const first=f.connection();await first.restore();
      if(mode==='global'){globalThis._walletConnectCore__count++;}
      if(mode==='consumer')await f.connection().restore();
      if(mode==='external-client')await first.initialize();
      if(mode==='unknown-count')globalThis._walletConnectCore__count=undefined;
      if(mode==='proposal')f.state.proposals.push({id:1,proposer:{metadata:{url:'https://finance.ynxweb4.com'}}});
      if(mode==='session')f.state.sessions.push({topic:'a'.repeat(64)});
      const pending=first.connect(),rejected=assert.rejects(pending,/CANCELLED/);await tick();await first.cancel();await rejected;
      assert.equal(f.state.closed,0,mode);assert.equal(f.state.initializations,1,mode);
      if(mode==='session')assert.deepEqual(await f.state.client.request({}),{ok:true},'shared session communication remains available');
    }finally{f.finishConnect();await tick();f.close();}
  }
});
test('late initialization closes only an owned empty Core and never starts a proposal',async()=>{
  const f=await fixture();let release;f.state.initWait=new Promise(resolve=>release=resolve);try{
    const connection=f.connection(),pending=connection.connect(),rejected=assert.rejects(pending,/CANCELLED/);await tick();await connection.cancel();await rejected;
    release();await tick();await tick();assert.equal(f.state.closed,1);assert.equal(f.state.connects,0);
  }finally{release();f.finishConnect();await tick();f.close();}
});
test('URI-less relay timeout is classified before approval and cannot create duplicate SDK attempts',async()=>{
  const f=await fixture();try{
    const connection=f.connection(),stages=[];connection.on('stage',value=>stages.push(value.stage));
    await assert.rejects(connection.connect(),error=>error.code==='YNX_PAIR_RELAY_TIMEOUT'&&error.stage==='relay');
    assert.deepEqual(stages,['initialization','relay']);await assert.rejects(connection.connect(),/TRANSPORT_DRAINING/);assert.equal(f.state.connects,1);
  }finally{f.finishConnect();await tick();f.close();}
});
