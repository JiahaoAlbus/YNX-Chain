import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createCentralBrowserSessionRegistry,centralBrowserClient} from '../src/central-browser-session-registry.js';
import {createHostedWalletAdapter} from '@ynx-chain/wallet-auth/hosted-adapter';
import * as nativeRoot from '../src/index.js';
import {RecoverableProductSessionClient,createProductSessionRequest,productPlatformBinding} from '../src/index.js';
const registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url)));
test('AI official subentry maps exact identity only; browser identity cannot create private scope',()=>{
 const clients=createCentralBrowserSessionRegistry(registry),ai=centralBrowserClient(clients,{clientId:'ynx-ai-v1-sso-v1',origin:'https://assistant.ynxweb4.com',redirectUri:'https://assistant.ynxweb4.com/sso/callback'});
 assert.deepEqual(ai,{productId:'ai',clientId:'ynx-ai-v1-sso-v1',origin:'https://assistant.ynxweb4.com',redirectUri:'https://assistant.ynxweb4.com/sso/callback',audience:'ynx:ai:identity',scopes:['identity:read']});
 const binding=productPlatformBinding(registry,'ai','android');assert.equal(binding.origin,'app://android/com.ynxweb4.ai');assert.notEqual(binding.callback,ai.redirectUri);assert.notEqual(binding.clientId,ai.clientId);assert(!binding.scopes.includes('identity:read'));
 assert.throws(()=>createProductSessionRequest(registry,{productId:'ai',platform:'android',deviceId:'a'.repeat(43),deviceKey:'invalid',scopes:['identity:read'],purpose:'private AI',nonce:'b'.repeat(43),state:'c'.repeat(43)}));
});
test('SDK Hosted adapter closes package import graph without apps source or invented Card approval',()=>{
 const source=readFileSync(new URL('../src/central-browser-session-browser.js',import.meta.url),'utf8'),adapter=readFileSync(new URL('../src/hosted-adapter.js',import.meta.url),'utf8');
 assert(source.includes("from './hosted-adapter.js'"));assert(!source.includes("from '../../../apps/"));assert(!/^import .*from /m.test(adapter));
 assert.equal(typeof createHostedWalletAdapter,'function');assert.equal(Object.hasOwn(nativeRoot,'createHostedWalletAdapter'),false);assert.equal(typeof RecoverableProductSessionClient.prototype.createBusinessProof,'function');assert.equal(typeof RecoverableProductSessionClient.prototype.createBusinessProofCommitment,'function');
 assert(!adapter.includes('ynx_requestCardApplicationApproval'));
});
