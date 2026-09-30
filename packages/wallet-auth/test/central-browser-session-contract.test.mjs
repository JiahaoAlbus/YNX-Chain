import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createCentralBrowserSessionRegistry} from '../src/central-browser-session-registry.js';
import {CENTRAL_BROWSER_ISSUER,CENTRAL_BROWSER_PURPOSE,CENTRAL_BROWSER_RPC_METHOD,centralBrowserConsentSignBytes,parseCentralBrowserSignInChallenge,parseCentralBrowserSignInApproval} from '../src/central-browser-session-contract.js';
import * as publicContract from '@ynx-chain/wallet-auth/central-browser-session-contract';
import * as publicRegistry from '@ynx-chain/wallet-auth/central-browser-session-registry';
const registry=createCentralBrowserSessionRegistry(JSON.parse(await readFile(new URL('../product-session-registry.json',import.meta.url)))),now=Date.now();
const client=registry.find(value=>value.productId==='finance');
const challenge=()=>({version:1,issuer:CENTRAL_BROWSER_ISSUER,purpose:CENTRAL_BROWSER_PURPOSE,challengeId:'A'.repeat(43),browserBinding:'a'.repeat(64),nonce:'B'.repeat(43),initiator:{clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state:'C'.repeat(43),codeChallenge:'D'.repeat(43),codeChallengeMethod:'S256'},clients:registry.map(value=>({clientId:value.clientId,origin:value.origin,audience:value.audience,scopes:[...value.scopes]})).sort((a,b)=>a.clientId.localeCompare(b.clientId)),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+120000).toISOString()});
const parse=value=>parseCentralBrowserSignInChallenge(value,registry,{peerOrigin:CENTRAL_BROWSER_ISSUER,now});

test('stable self-package browser subpaths expose the same sole contract and registry',()=>{
  assert.equal(publicContract.centralBrowserConsentSignBytes,centralBrowserConsentSignBytes);
  assert.equal(publicRegistry.createCentralBrowserSessionRegistry,createCentralBrowserSessionRegistry);
  assert.equal(publicContract.CENTRAL_BROWSER_RPC_METHOD,'ynx_requestCentralBrowserSignIn');
});

test('one canonical contract validates issuer/real peer/initiator/exact identity scopes and finite expiry',()=>{
  assert.equal(parse(challenge()).initiator.clientId,client.clientId);assert.equal(CENTRAL_BROWSER_RPC_METHOD,'ynx_requestCentralBrowserSignIn');
  assert.throws(()=>parseCentralBrowserSignInChallenge(challenge(),registry,{peerOrigin:client.origin,now}),error=>error.code==='SSO_CHALLENGE_INVALID');
  for(const mutate of [value=>value.issuer='https://unknown.ynxweb4.com',value=>value.extra=true,value=>value.initiator.redirectUri+='?next=evil',value=>value.clients[0].scopes.push('finance.profile.write'),value=>value.expiresAt=new Date(now-1).toISOString(),value=>value.expiresAt=new Date(now+121000).toISOString(),value=>value.nonce='short']){
    const changed=challenge();mutate(changed);assert.throws(()=>parse(changed));
  }
});
test('canonical sign bytes contain exactly the domain newline and full initiator; response has no extra token or subject fields',()=>{
  const value=challenge(),account='ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80',accountPublicKey='02'+'a'.repeat(64),bytes=centralBrowserConsentSignBytes(value,account,accountPublicKey);
  assert.ok(bytes.startsWith('YNX Central Browser Sign-In v1\n{'));assert.equal(Buffer.from(bytes)[30],10);assert.equal(bytes.includes('\\n{'),false);
  assert.notEqual(bytes,centralBrowserConsentSignBytes({...value,initiator:{...value.initiator,state:'E'.repeat(43)}},account,accountPublicKey));
  const approval={challengeId:value.challengeId,account,accountPublicKey,walletSignature:'b'.repeat(128)};assert.deepEqual(parseCentralBrowserSignInApproval(approval),approval);
  assert.throws(()=>parseCentralBrowserSignInApproval({...approval,token:'not-allowed'}));assert.throws(()=>parseCentralBrowserSignInApproval({...approval,walletSignature:'0x'+'b'.repeat(128)}));
});
test('the sole contract builds for browser without any Node builtin or server-session credential code',async()=>{
  const result=await build({absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),entryPoints:['src/central-browser-session-contract.js'],bundle:true,platform:'browser',target:'es2022',write:false,metafile:true});
  assert.ok(result.outputFiles[0].contents.length>0);
  assert.equal(Object.keys(result.metafile.inputs).some(path=>path.endsWith('/central-browser-session.js')||path.endsWith('/central-browser-session-store.js')),false);
  assert.equal(Buffer.from(result.outputFiles[0].contents).toString().includes('node:crypto'),false);
});
