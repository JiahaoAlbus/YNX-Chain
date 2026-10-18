import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletAddressConnection} from '../../../packages/wallet-auth/src/walletconnect-dapp-connection.js';
import {createAddressConnectionConsumer,ADDRESS_CONNECTION_ORIGIN} from '../src/walletconnect-address-consumer.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
// Same-copy formal SDK class and real App controller. Only the PUBLIC client
// factory is controlled; this is not a Relay, installed App or remote proof.
test('same-copy SDK original local cancellation cannot erase the retry barrier after relay drain',async()=>{
 const effects={factory:0,connect:0,pairingDisconnect:0,sessionDisconnect:0,requests:0};let rejectRelay;
 const relay=new Promise((_,reject)=>rejectRelay=reject);
 const client={on(){},core:{pairing:{disconnect:async()=>{effects.pairingDisconnect++;}}},session:{getAll:()=>[]},connect(){effects.connect++;return relay;},disconnect:async()=>{effects.sessionDisconnect++;},request:async()=>{effects.requests++;throw Error('unexpected request');}};
 const original=createWalletAddressConnection({clientFactory:async()=>{effects.factory++;return client;},deadlineMs:1000});
 const ui=createAddressConnectionConsumer({origin:ADDRESS_CONNECTION_ORIGIN,createConnection:()=>original});
 const connecting=ui.connect();for(let i=0;i<20&&effects.connect===0;i++)await tick();assert.equal(effects.connect,1);
 await ui.cancel();await connecting;rejectRelay(Object.assign(Error('CONTROLLED_RELAY_REJECTED'),{code:'CONTROLLED_ONLY'}));await tick();
 const before={...effects},observed=ui.checkOriginal();assert.deepEqual(effects,before);
 assert.equal(observed.connect,'rejected');assert.equal(observed.cleanup,'fulfilled');assert.equal(observed.protocol.availability,'available');
 assert.equal(observed.protocol.value.draining,false);assert.equal(observed.protocol.value.remoteCleanup,'not-proven');assert.equal(observed.protocol.value.remoteCleanupUnconfirmed,true);
 for(let i=0;i<16;i++)ui.checkOriginal();await ui.connect();assert.deepEqual(effects,before);assert.equal(ui.checkOriginal().attempt,1);assert.equal(ui.snapshot().reconnectBlocked,true);
 assert.equal(effects.factory,1);assert.equal(effects.connect,1);assert.equal(effects.pairingDisconnect,0);assert.equal(effects.sessionDisconnect,0);assert.equal(effects.requests,0);
});
