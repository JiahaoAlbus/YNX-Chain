import assert from 'node:assert/strict';
import test from 'node:test';
import {createFinanceHostedWalletController} from '../web/hosted-wallet-controller.js';

const ACCOUNT='0x'+'a'.repeat(40);
function fixture({account=ACCOUNT,chainId='0x1917',reject=null,emptyEvent=false}={}){
  const listeners=new Map(),calls=[],changes=[];
  const adapter={
    detached:0,disconnected:0,
    on(name,listener){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(listener)},
    removeListener(name,listener){listeners.get(name)?.delete(listener)},
    emit(name,value){for(const listener of listeners.get(name)??[])listener(value)},
    connect(){calls.push('connect');if(emptyEvent||reject){this.emit('accountsChanged',[]);this.emit('disconnect',{code:reject??'HOSTED_DISCONNECTED'});}else this.emit('accountsChanged',[account]);return reject?Promise.reject(Object.assign(new Error(reject),{code:reject})):Promise.resolve([account])},
    request({method}){calls.push(method);if(method!=='eth_chainId')throw new Error('unexpected Wallet method');return Promise.resolve(chainId)},
    async disconnect(){this.disconnected++;this.emit('disconnect',{code:'HOSTED_DISCONNECTED'})},
    detach(){this.detached++},
  };
  let factories=0;
  const controller=createFinanceHostedWalletController({createHostedWalletAdapter:()=>{factories++;return adapter},window:{},onChange:state=>changes.push(state)});
  return {adapter,controller,calls,changes,get factories(){return factories}};
}

test('Hosted account only becomes connected after visible approval result and exact 0x1917 readback',async()=>{
  const value=fixture();assert.equal(value.factories,0);assert.equal(value.controller.getState().status,'disconnected');
  const result=await value.controller.connect();
  assert.deepEqual(value.changes.map(state=>state.status),['connecting','connected']);
  assert.equal(result.account,ACCOUNT);assert.equal(result.transport,'hosted-wallet-web');
  assert.deepEqual(value.calls,['connect','eth_chainId']);
  assert.equal(value.factories,1);
  value.adapter.emit('accountsChanged',['0x'+'b'.repeat(40)]);
  assert.equal(value.controller.getState().status,'disconnected');
  assert.equal(value.controller.getState().account,null);
  assert.equal(value.controller.getState().error,'HOSTED_ACCOUNT_CHANGED');
  await value.controller.disconnect();
  assert.equal(value.controller.getState().status,'disconnected');
  assert.equal(value.adapter.detached,1);
  assert.equal(value.adapter.disconnected,1);
});

test('Hosted request is unavailable after account change and requires a fresh approval',async()=>{
  const value=fixture();await value.controller.connect();
  value.adapter.emit('accountsChanged',['0x'+'b'.repeat(40)]);
  await assert.rejects(value.controller.request({method:'personal_sign',params:[]}),error=>error.code==='HOSTED_NOT_CONNECTED');
  assert.equal(value.controller.getState().account,null);
});
test('Hosted transport close and explicit user disconnect have distinct reasons, not remote revoke receipts',async()=>{
  const transport=fixture();await transport.controller.connect();transport.adapter.emit('disconnect',{code:'HOSTED_DISCONNECTED'});
  assert.equal(transport.controller.getState().error,'HOSTED_DISCONNECTED');
  const explicit=fixture();await explicit.controller.connect();await explicit.controller.disconnect();
  assert.equal(explicit.controller.getState().error,'HOSTED_LOCAL_DISCONNECT');
  const revoke=fixture();await revoke.controller.connect();
  const result=await revoke.controller.revoke();
  assert.equal(result.permissionRevoked,false);
});

test('Hosted rejection and a late event never create a connection',async()=>{
  const value=fixture({reject:'USER_REJECTED'});
  const result=await value.controller.connect();
  assert.equal(result.status,'rejected');assert.equal(result.account,null);
  value.adapter.emit('accountsChanged',[ACCOUNT]);
  assert.equal(value.controller.getState().status,'rejected');
  assert.equal(value.adapter.detached,1);
});

test('only a same-batch typed transport close retains the previously approved account',async()=>{
  for(const code of ['HOSTED_POPUP_CLOSED','HOSTED_REQUEST_EXPIRED_OR_RELOADED']){
    const value=fixture();await value.controller.connect();
    value.adapter.emit('accountsChanged',[]);value.adapter.emit('disconnect',{code});await Promise.resolve();
    assert.equal(value.controller.getState().status,'transport-unavailable');assert.equal(value.controller.getState().account,ACCOUNT);
    assert.equal(value.controller.getState().error,code);
    await assert.rejects(value.controller.request({method:'ynx_requestProductSessionV2',params:[]}),error=>error.code==='HOSTED_NOT_CONNECTED');
  }
  const empty=fixture();await empty.controller.connect();empty.adapter.emit('accountsChanged',[]);await Promise.resolve();
  assert.equal(empty.controller.getState().error,'HOSTED_ACCOUNT_CHANGED');assert.equal(empty.controller.getState().account,null);
  empty.adapter.emit('disconnect',{code:'HOSTED_POPUP_CLOSED'});assert.equal(empty.controller.getState().account,null,'late transport label cannot restore a removed identity');
  const unknown=fixture();await unknown.controller.connect();unknown.adapter.emit('accountsChanged',[]);unknown.adapter.emit('disconnect',{code:'unclassified'});await Promise.resolve();
  assert.equal(unknown.controller.getState().status,'disconnected');assert.equal(unknown.controller.getState().account,null);
});

test('Hosted wrong chain and empty accounts fail closed without a standard-wallet fallback',async()=>{
  const wrong=fixture({chainId:'0x1'});assert.equal((await wrong.controller.connect()).status,'wrong-chain');
  assert.equal(wrong.controller.getState().account,null);assert.equal(wrong.adapter.detached,1);
  const empty=fixture({emptyEvent:true});assert.equal((await empty.controller.connect()).status,'unavailable');
  assert.equal(empty.controller.getState().error,'HOSTED_CONNECTION_INTERRUPTED');assert.equal(empty.controller.getState().account,null);
  assert.equal(empty.calls.includes('eth_chainId'),false);
});

test('Hosted refresh requires new approval; disconnect cannot be promoted by an old Promise',async()=>{
  const first=fixture();await first.controller.connect();
  const second=fixture();assert.equal(second.controller.getState().status,'disconnected');assert.equal(second.factories,0);
  let resolve;
  const slow=fixture();slow.adapter.connect=()=>new Promise(done=>{resolve=done});
  const pending=slow.controller.connect();await slow.controller.disconnect();resolve([ACCOUNT]);
  assert.equal(await pending,null);assert.equal(slow.controller.getState().status,'disconnected');
});
