import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalAuthorizeLaunch, parseAuthorizationRequest} from '@ynx-chain/wallet-auth';
import {quantWalletAuthorizationRegistry} from '../web/product-session-registry.js';

const now=new Date('2026-08-21T04:45:00.000Z');
const request=Object.freeze({version:'2',nonce:'a'.repeat(32),chainId:'ynx_6423-1',requestingProduct:'quant',productClientId:'ynx-quant-v1',bundleId:'com.ynxweb4.quant',productDeviceAlgorithm:'p256-sha256',productDeviceKey:'Aq'.padEnd(44,'A'),origin:'https://quant.ynxweb4.com',callback:'https://quant.ynxweb4.com/wallet-auth/callback',scopes:['quant:account'],purpose:'Connect Quant research only.',issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+60_000).toISOString()});

test('canonical launch is payload-bearing and binds the registered Quant product',()=>{const parsed=parseAuthorizationRequest(request,{registry:quantWalletAuthorizationRegistry,now});const launch=createCanonicalAuthorizeLaunch(parsed);assert.match(launch.uri,/\?request=/);assert.equal(launch.fallbackActions[0].url,'https://www.ynxweb4.com/dapp/download');assert.equal(launch.fallbackActions[1].url,'https://metamask.io/download/');});
test('tampered origin, callback, product, and scope fail closed before launch',()=>{for(const [key,value] of [['origin','https://attacker.example'],['callback','https://attacker.example/callback'],['requestingProduct','dex'],['scopes',['quant:account','wallet:sign']]])assert.throws(()=>parseAuthorizationRequest({...request,[key]:value},{registry:quantWalletAuthorizationRegistry,now}));});
