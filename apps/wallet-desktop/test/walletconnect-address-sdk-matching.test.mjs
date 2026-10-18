import test from 'node:test';
import assert from 'node:assert/strict';
import {createAddressConnectionConsumer,ADDRESS_CONNECTION_ORIGIN} from '../src/walletconnect-address-consumer.mjs';
import {createWalletAddressConnection} from '../../../packages/wallet-auth/src/walletconnect-dapp-connection.js';

// Actual same-copy SDK transport/namespace checks plus App controller. The
// SignClient network/remote session is an explicit PUBLIC instrument, not a
// real Relay, protocol-generated network URI or installed approval flow.
test('same-copy SDK address factory and normal Wallet controller connect with empty remote permission',async()=>{
 const now=2_000_000_000_000,account='0x'+'a'.repeat(40),topic='a'.repeat(64),reads=[],calls=[];
 const session={topic,expiry:now/1000+3600,peer:{metadata:{url:'https://wallet.ynxweb4.com'}},namespaces:{eip155:{chains:['eip155:6423'],accounts:[`eip155:6423:${account}`],methods:[],events:['accountsChanged','chainChanged']}}};
 const client={on(){},session:{getAll:()=>[]},core:{pairing:{disconnect:async()=>{calls.push('pairing-disconnect');}}},
  connect:async input=>{assert.deepEqual(input.requiredNamespaces.eip155,{chains:['eip155:6423'],methods:[],events:['accountsChanged','chainChanged']});return {uri:`wc:${'b'.repeat(64)}@2?relay-protocol=irn&symKey=${'c'.repeat(64)}&expiryTimestamp=${now/1000+300}`,approval:async()=>session};},
  disconnect:async()=>{calls.push('disconnect');},request:async()=>{calls.push('REMOTE_REQUEST_FORBIDDEN');throw Error('NO_REMOTE_RPC');}};
 let sdk;const ui=createAddressConnectionConsumer({origin:ADDRESS_CONNECTION_ORIGIN,createConnection:()=>{sdk=createWalletAddressConnection({now:()=>now,clientFactory:async options=>{assert.equal(options.metadata.url,ADDRESS_CONNECTION_ORIGIN);assert.equal(options.projectId,'41857128a14a593ca4e4a7cb7c838d71');return client;}});return sdk;},onURI:value=>reads.push(value)});
 await ui.connect();assert.equal(ui.snapshot().phase,'connected');assert.equal(ui.snapshot().account,account);assert.equal(reads.length,1);assert.equal(calls.length,0);
 for(const method of ['personal_sign','eth_sendTransaction','ynx_requestProductSessionV2','ynx_requestCentralBrowserSignIn'])await assert.rejects(sdk.request({method,params:[]}),error=>error.code==='YNX_PAIR_METHOD_NOT_APPROVED');
 assert.equal(calls.length,0);await ui.disconnect();assert.equal(ui.snapshot().phase,'disconnected');assert.deepEqual(calls,['disconnect']);
});
