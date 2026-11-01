import test from 'node:test';
import assert from 'node:assert/strict';
import registry from '../product-session-registry.json' with {type:'json'};
import {WalletConnectDAppConnection} from '../src/walletconnect-dapp-connection.js';
const product='ynx_requestProductSessionV2',identity='ynx_requestCentralBrowserSignIn';
const ids=['cloud','docs','calendar','mail','developer','shop'],privateIds=['music','pay-merchant','card'];
const originFor=id=>registry.products.find(p=>p.productId===id).webOrigin;
const topic='a'.repeat(64),account='0x'+'1'.repeat(40),tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(origin,methods,extra=[]){let approve,reply;const calls=[];const session={topic,expiry:Math.floor(Date.now()/1000)+300,peer:{metadata:{url:'https://wallet.ynxweb4.com'}},namespaces:{eip155:{chains:['eip155:6423'],accounts:[`eip155:6423:${account}`],methods:[...methods,...extra]}}};const client={on(){},session:{getAll:()=>[]},core:{pairing:{disconnect:async()=>{}}},connect:async input=>{calls.push(input);return {uri:`wc:${topic}@2?relay-protocol=irn&symKey=${'2'.repeat(64)}`,approval:()=>new Promise(r=>approve=r)};},request:async input=>{calls.push(input);return new Promise(r=>reply=r);},disconnect:async()=>{}};return {calls,connection:new WalletConnectDAppConnection({origin,methods,clientFactory:async options=>{calls.push(options);return client;},deadlineMs:1000}),approve:()=>approve(session),reply:x=>reply(x)};}
test('fixed registry product origins and restricted methods preserve legacy policy',()=>{
 for(const id of [...ids,...privateIds]){const origin=originFor(id),methods=ids.includes(id)?[product,identity]:[product];assert.doesNotThrow(()=>new WalletConnectDAppConnection({origin,methods}));
 for(const method of ['personal_sign','eth_signTypedData_v4','eth_sendTransaction','wallet_addEthereumChain','ynx_requestCardApplicationApproval'])assert.throws(()=>new WalletConnectDAppConnection({origin,methods:[method]}),/CONFIGURATION_INVALID/);
 if(privateIds.includes(id))assert.throws(()=>new WalletConnectDAppConnection({origin,methods:[identity]}),/CONFIGURATION_INVALID/);
 for(const bad of [origin+'.evil.example',origin+'/',origin.replace('https:','http:'),origin.replace('https://','https://user@')])assert.throws(()=>new WalletConnectDAppConnection({origin:bad,methods}),/CONFIGURATION_INVALID/);}
 assert.equal(originFor('cloud'),'https://web4.ynxweb4.com');
 for(const host of ['cloud','merchant-console','seller-console','unknown'])assert.throws(()=>new WalletConnectDAppConnection({origin:`https://${host}.ynxweb4.com`,methods:[product]}),/CONFIGURATION_INVALID/);
 for(const host of ['finance','exchange','quant','wallet-auth'])assert.doesNotThrow(()=>new WalletConnectDAppConnection({origin:`https://${host}.ynxweb4.com`,methods:['personal_sign',product,identity]}));
 for(const host of ['social','assistant','video','creator'])assert.throws(()=>new WalletConnectDAppConnection({origin:`https://${host}.ynxweb4.com`,methods:[identity]}),/CONFIGURATION_INVALID/);
});
test('new origins require URI and user proposal approval before scoped 6423 request',async()=>{
 for(const id of [...ids,...privateIds]){const origin=originFor(id),methods=ids.includes(id)?[product,identity]:[product],f=fixture(origin,methods);let uri;const pending=f.connection.connect({onURI:x=>uri=x});await tick();assert.match(uri,/^wc:/);assert.equal(f.calls[0].metadata.url,origin);assert.equal(f.calls[0].storageOptions.database,`ynx-pair-${new URL(origin).hostname}`);assert.deepEqual(f.calls[1].requiredNamespaces.eip155.chains,['eip155:6423']);assert.deepEqual(f.calls[1].requiredNamespaces.eip155.methods,methods);await assert.rejects(f.connection.request({method:product}),/SESSION_EXPIRED/);f.approve();const provider=await pending;const req=provider.request({method:product,params:['original wallet URL']});await tick();assert.equal(f.calls.at(-1).chainId,'eip155:6423');assert.deepEqual(f.calls.at(-1).request.params,['original wallet URL']);f.reply({approval:'opaque fixture'});await req;await assert.rejects(provider.request({method:'eth_sendTransaction'}),/METHOD_NOT_APPROVED/);await f.connection.disconnect();}
});
test('overbroad namespace cannot upgrade new origins',async()=>{for(const id of [...ids,...privateIds]){const f=fixture(originFor(id),[product],['personal_sign']);const pending=f.connection.connect();await tick();f.approve();await assert.rejects(pending,/NAMESPACE_INVALID/);}});
