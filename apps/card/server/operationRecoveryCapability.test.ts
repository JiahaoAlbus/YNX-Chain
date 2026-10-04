import test from 'node:test';
import assert from 'node:assert/strict';
import type {AddressInfo} from 'node:net';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {createCardServer} from './http.ts';
import {unavailableWallet,unavailableCore} from './contracts.ts';
import {CARD_OPERATION_RECOVERY_CONTRACT} from '../src/cardOperationRecoveryContract.ts';

test('actual HTTP version declares implemented original-key recovery without implying configuration or funding approval',async()=>{
 const store=new CardStore(':memory:',Buffer.alloc(32,23));
 const service=new CardService({store,wallet:unavailableWallet,core:unavailableCore});
 const server=createCardServer({service,wallet:unavailableWallet,sourceCommit:'a'.repeat(40),configurationReady:false});
 try{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as AddressInfo;
  const response=await fetch(`http://127.0.0.1:${address.port}/api/card/v1/version`);
  assert.equal(response.status,200);const value:unknown=await response.json();
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value));
  const version=value as Record<string,unknown>;
  assert.equal(version.sourceCommit,'a'.repeat(40));
  assert.deepEqual(version.features,{operationReadback:CARD_OPERATION_RECOVERY_CONTRACT});
  assert.equal(version.configurationReady,false);assert.equal(version.runtimeFundingVerified,false);assert.equal(version.productionRealPayments,false);
 }finally{
  if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  store.close();
 }
});
