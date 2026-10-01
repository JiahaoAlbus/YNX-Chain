import test from 'node:test';
import assert from 'node:assert/strict';
import {WalletConnectDAppConnection,YNX_PAIR_PROJECT_ID} from '../src/walletconnect-dapp-connection.js';
import {StandardWalletConnection} from '../src/standard-wallet-connection.js';
import {SignClient,SESSION_REQUEST_EXPIRY_BOUNDARIES} from '@walletconnect/sign-client';
const topic='a'.repeat(64),account='0x'+'1'.repeat(40),method='ynx_requestCentralBrowserSignIn';
const session=(extra={})=>({topic,expiry:Math.floor(Date.now()/1000)+300,peer:{metadata:{url:'https://wallet.ynxweb4.com'}},namespaces:{eip155:{accounts:[`eip155:6423:${account}`],chains:['eip155:6423'],methods:[method],events:['accountsChanged','chainChanged']}},...extra});
function fixture(existing=[]){let approve,reply;const events=new Map(),calls=[];const client={on:(name,fn)=>events.set(name,fn),session:{getAll:()=>existing},core:{pairing:{disconnect:async input=>calls.push(['cancel',input.topic])}},connect:async input=>{calls.push(['connect',input]);return {uri:`wc:${topic}@2?relay-protocol=irn&symKey=${'2'.repeat(64)}`,approval:()=>new Promise(resolve=>approve=resolve)};},request:input=>{calls.push(['request',input]);return new Promise(resolve=>reply=resolve);},disconnect:async input=>calls.push(['disconnect',input.topic])};
  const connection=new WalletConnectDAppConnection({origin:'https://wallet-auth.ynxweb4.com',methods:[method],clientFactory:async options=>{calls.push(['init',options]);return client;},deadlineMs:50});return {connection,client,calls,events,approve:value=>approve(value),reply:value=>reply(value)};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('locked real SignClient validates the transport envelope without extending YNX local deadline',async()=>{
  const real=new SignClient({logger:'silent',projectId:YNX_PAIR_PROJECT_ID});
  assert.equal(SESSION_REQUEST_EXPIRY_BOUNDARIES.min,300);
  for(const expiry of [1,30,299])assert.throws(()=>real.engine.validateRequestExpiry(expiry),/between 300/);
  assert.doesNotThrow(()=>real.engine.validateRequestExpiry(300));
  const f=fixture([session()]);await f.connection.restore();
  const pending=f.connection.request({method,params:[{}]});
  await tick();const input=f.calls.find(call=>call[0]==='request')[1];
  assert.equal(input.expiry,300);real.engine.validateRequestExpiry(input.expiry);
  await assert.rejects(pending,/TIMEOUT|DEADLINE/);
  f.reply({});await tick();
});
test('numeric WalletConnect chain events normalize only the approved chain for the real standard connection',async()=>{
  const f=fixture([session()]),provider=await f.connection.restore(),standard=new StandardWalletConnection({provider,origin:'https://wallet-auth.ynxweb4.com',metadata:{name:'Isolated Pair regression',url:'https://wallet-auth.ynxweb4.com'}});
  await standard.connect();
  for(const chain of [6423,'6423','0x1917']){
    f.events.get('session_event')({topic,params:{event:{name:'chainChanged',data:chain}}});
    assert.equal(standard.current.selectedChain,'0x1917');assert.equal(standard.current.selectedAccount,account);
  }
  const signing=provider.request({method,params:[{}]});await tick();f.events.get('session_event')({topic,params:{event:{name:'chainChanged',data:6423}}});f.reply({});await assert.rejects(signing,/CONTEXT_CHANGED/);
  f.events.get('session_event')({topic,params:{event:{name:'chainChanged',data:'0x1'}}});
  assert.notEqual(standard.current?.selectedChain,'0x1917');await assert.rejects(provider.request({method:'eth_accounts'}),/SESSION_EXPIRED/);
  standard.disconnect();
});
test('official DApp proposal is explicit, single-flight, scoped and approves only the exact Wallet peer/account',async()=>{
  const f=fixture();await f.connection.initialize();assert.equal(f.calls[0][1].projectId,YNX_PAIR_PROJECT_ID);assert.equal(f.calls[0][1].metadata.url,'https://wallet-auth.ynxweb4.com');assert.equal(f.calls.filter(c=>c[0]==='connect').length,0);
  let uri;const first=f.connection.connect({onURI:value=>uri=value});assert.equal(first,f.connection.connect());await tick();assert.match(uri,/^wc:/);assert.equal(f.calls.filter(c=>c[0]==='connect').length,1);
  f.approve(session());const provider=await first;assert.equal(provider.isMetaMask,false);assert.deepEqual(await provider.request({method:'eth_accounts'}),[account]);
  const request=provider.request({method,params:[{challengeId:'opaque bounded challenge'}]});await tick();f.reply({challengeId:'same challenge'});assert.deepEqual(await request,{challengeId:'same challenge'});
  assert.equal(f.calls.find(c=>c[0]==='request')[1].topic,topic);await assert.rejects(provider.request({method:'personal_sign'}),/METHOD_NOT_APPROVED/);
});

test('late connect timeout/cancel retires the original pairing and eventual approval',async()=>{
  for(const mode of ['cancel','timeout']){
    const f=fixture();let release,approve;
    f.client.connect=()=>new Promise(resolve=>release=resolve);
    const pending=f.connection.connect();await tick();
    if(mode==='cancel')await f.connection.cancel();
    const rejected=assert.rejects(pending,mode==='cancel'?/CANCELLED/:/TIMEOUT/);
    if(mode==='timeout')await rejected;
    release({uri:`wc:${topic}@2?relay-protocol=irn&symKey=${'2'.repeat(64)}`,approval:()=>new Promise(resolve=>approve=resolve)});
    await tick();approve(session());await rejected;await tick();
    assert.ok(f.calls.some(call=>call[0]==='cancel'&&call[1]===topic));
    assert.ok(f.calls.some(call=>call[0]==='disconnect'&&call[1]===topic));
    await assert.rejects(f.connection.request({method:'eth_accounts'}),/SESSION_EXPIRED/);
  }
});
test('late cancelled proposal cannot overwrite the new pairing cancellation target',async()=>{
  const f=fixture(),other='b'.repeat(64),proposals=[],cancelled=[];
  f.client.connect=()=>new Promise(resolve=>proposals.push(resolve));f.client.core.pairing.disconnect=async({topic})=>cancelled.push(topic);
  const old=f.connection.connect();const oldRejected=assert.rejects(old,/CANCELLED/);await tick();await f.connection.cancel();
  const next=f.connection.connect();const nextRejected=assert.rejects(next,/YNX_PAIR_TIMEOUT/);await tick();
  proposals[1]({uri:`wc:${other}@2?relay-protocol=irn&symKey=${'3'.repeat(64)}`,approval:()=>new Promise(()=>{})});await tick();
  proposals[0]({uri:`wc:${topic}@2?relay-protocol=irn&symKey=${'2'.repeat(64)}`,approval:()=>Promise.reject(new Error('cancelled fixture'))});await oldRejected;
  await f.connection.cancel();await tick();assert.ok(cancelled.includes(other));
  // Resolve the wait through its existing deadline, never a fabricated reply.
  await nextRejected;
});
test('old retirement failure is tagged stale while current cancellation failure remains visible',async()=>{
  const f=fixture(),notices=[];f.connection.on('cancelUnconfirmed',value=>notices.push(value));f.client.disconnect=async()=>{throw new Error('offline');};
  const old=f.connection.connect();const oldRejected=assert.rejects(old,/CANCELLED/);await tick();
  let resolveNew;await f.connection.cancel();
  // The existing A approval is still pending; its forwarding resolver is
  // captured before the second connect overwrites fixture state.
  const originalApprove=f.approve;
  f.client.connect=async()=>({uri:`wc:${'b'.repeat(64)}@2?relay-protocol=irn&symKey=${'3'.repeat(64)}`,approval:()=>new Promise(resolve=>resolveNew=resolve)});
  const next=f.connection.connect();await tick();originalApprove(session());await oldRejected;await tick();
  assert.equal(notices.at(-1)?.current,false);
  f.client.core.pairing.disconnect=async()=>{throw new Error('offline');};await f.connection.cancel();assert.equal(notices.at(-1)?.current,true);
  resolveNew(session({topic:'b'.repeat(64)}));await assert.rejects(next,/CANCELLED/);await tick();
});

test('invalid approved peer/namespace is retired; remote cleanup failure stays unconfirmed',async()=>{
  for(const invalid of [session({peer:{metadata:{url:'https://attacker.example'}}}),session({namespaces:{eip155:{accounts:[`eip155:1:${account}`],methods:[method]}}})]){
    const f=fixture();const pending=f.connection.connect();await tick();f.approve(invalid);
    await assert.rejects(pending,/PEER_INVALID|NAMESPACE_INVALID/);
    assert.ok(f.calls.some(call=>call[0]==='disconnect'&&call[1]===topic));
  }
  const f=fixture();let unconfirmed=0;f.connection.on('cancelUnconfirmed',()=>unconfirmed++);
  f.client.disconnect=async()=>{throw new Error('offline');};
  const pending=f.connection.connect();await tick();f.approve(session({peer:{metadata:{url:'https://attacker.example'}}}));
  await assert.rejects(pending,/PEER_INVALID/);assert.equal(unconfirmed,1);
});

test('concurrent restore/connect initializes one SDK; cancellation fences the late factory result',async()=>{
  const f=fixture();let release,initializations=0;
  const connection=new WalletConnectDAppConnection({origin:'https://wallet-auth.ynxweb4.com',methods:[method],deadlineMs:50,clientFactory:()=>{initializations++;return new Promise(resolve=>release=resolve);}});
  const restoring=connection.restore(),connecting=connection.connect();await tick();assert.equal(initializations,1);
  await connection.cancel();release(f.client);
  await assert.rejects(restoring,/CANCELLED/);await assert.rejects(connecting,/CANCELLED/);
  assert.equal(f.calls.filter(call=>call[0]==='connect').length,0);
  assert.equal(await connection.restore(),null);assert.equal(initializations,1);
});
test('cold restoration does not sign, rejects unapproved peer/chain/expiry and never silently selects multiple sessions',async()=>{
  const f=fixture([session()]);const provider=await f.connection.restore();assert.deepEqual(await provider.request({method:'eth_accounts'}),[account]);assert.equal(f.calls.length,1);
  assert.equal(await fixture([session({expiry:1})]).connection.restore(),null);
  assert.equal(await fixture([session({peer:{metadata:{url:'https://attacker.example'}}})]).connection.restore(),null);
  const wrong=session();wrong.namespaces.eip155.accounts=[`eip155:1:${account}`];assert.equal(await fixture([wrong]).connection.restore(),null);
  await assert.rejects(fixture([session(),session({topic:'b'.repeat(64)})]).connection.restore(),/SELECTION_REQUIRED/);
});
test('cancel and timeout cannot adopt late approval; account/chain events fence an in-flight reply',async()=>{
  const f=fixture();const pending=f.connection.connect();await tick();await f.connection.cancel();f.approve(session());await assert.rejects(pending,/CANCELLED/);assert.ok(f.calls.some(c=>c[0]==='disconnect'));
  const timed=fixture();const timeout=timed.connection.connect();await tick();await assert.rejects(timeout,/TIMEOUT/);timed.approve(session());await tick();assert.ok(timed.calls.some(c=>c[0]==='disconnect'));
  const bound=fixture([session()]),provider=await bound.connection.restore(),read=provider.request({method,params:[{}]});await tick();bound.events.get('session_event')({topic,params:{event:{name:'accountsChanged',data:[]}}});bound.reply({});await assert.rejects(read,/CONTEXT_CHANGED/);await assert.rejects(provider.request({method:'eth_accounts'}),/SESSION_EXPIRED/);
});
