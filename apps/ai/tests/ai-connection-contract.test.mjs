import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createCentralBrowserSessionRegistry,centralBrowserClient,WalletConnectDAppConnection} from '../web/vendor/wallet-connection-ai039-shared1a8.mjs';
const registry=JSON.parse(readFileSync(new URL('../web/vendor/product-session-registry.json',import.meta.url)));
test('AI SSO has one exact identity-only official registration and preserves adopted products',()=>{
 const clients=createCentralBrowserSessionRegistry(registry),ai=clients.find(value=>value.productId==='ai');
 assert.deepEqual(ai,{productId:'ai',clientId:'ynx-ai-v1-sso-v1',origin:'https://assistant.ynxweb4.com',redirectUri:'https://assistant.ynxweb4.com/sso/callback',audience:'ynx:ai:identity',scopes:['identity:read']});
 for(const product of ['finance','exchange','quant','social'])assert.ok(clients.some(client=>client.productId===product));
 assert.equal(centralBrowserClient(clients,{clientId:ai.clientId,origin:ai.origin,redirectUri:ai.redirectUri}),ai);
 for(const origin of ['https://assistant.ynxweb4.com.evil.test','https://evil.test','http://assistant.ynxweb4.com'])assert.throws(()=>centralBrowserClient(clients,{clientId:ai.clientId,origin,redirectUri:ai.redirectUri}));
});
test('official Pair accepts only the exact AI origin, without using network during construction',()=>{
 const options={origin:'https://assistant.ynxweb4.com',methods:['ynx_requestProductSessionV2'],clientFactory:()=>assert.fail('Construction must not connect')};
 assert.ok(new WalletConnectDAppConnection(options));assert.throws(()=>new WalletConnectDAppConnection({...options,origin:'https://assistant.ynxweb4.com.evil.test'}));
});
