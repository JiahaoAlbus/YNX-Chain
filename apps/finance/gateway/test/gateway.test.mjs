import test from 'node:test';
import assert from 'node:assert/strict';
import {FinanceWalletGatewayProxy} from '../src/gateway.mjs';

test('forwards only exact central completion and proof-bound revocation routes',async()=>{
 const calls=[];const proxy=new FinanceWalletGatewayProxy({baseURL:'https://wallet-auth.ynxweb4.com',fetchImpl:async(url,init)=>{calls.push({url,init});return new Response('{"ok":true}',{status:200,headers:{'content-type':'application/json'}})}});
 let result=await proxy.forward('/v1/wallet/sessions/complete','{"authorizationRequest":{}}');assert.equal(result.status,200);
 result=await proxy.forward('/v1/wallet/sessions/revoke','{}','bounded-proof');assert.equal(result.status,200);
 assert.deepEqual(calls.map(v=>v.url),['https://wallet-auth.ynxweb4.com/v1/wallet/sessions/complete','https://wallet-auth.ynxweb4.com/v1/wallet/sessions/revoke']);
 assert.equal(calls[1].init.headers['x-ynx-product-session-proof'],'bounded-proof');
 assert.equal(calls.some(v=>Object.keys(v.init.headers).some(key=>key.toLowerCase()==='authorization')),false);
});

test('rejects route widening, insecure origins, missing proof and oversized bodies',async()=>{
 assert.throws(()=>new FinanceWalletGatewayProxy({baseURL:'http://wallet-auth.ynxweb4.com'}),/HTTPS origin/);
 const proxy=new FinanceWalletGatewayProxy({baseURL:'https://wallet-auth.ynxweb4.com',fetchImpl:async()=>{throw new Error('must not call')}});
 await assert.rejects(proxy.forward('/v1/wallet/sessions/introspect','{}'),/not allowed/);
 await assert.rejects(proxy.forward('/v1/wallet/sessions/revoke','{}'),/proof is required/);
 await assert.rejects(proxy.forward('/v1/wallet/sessions/complete','x'.repeat(70*1024)),/outside policy/);
});
