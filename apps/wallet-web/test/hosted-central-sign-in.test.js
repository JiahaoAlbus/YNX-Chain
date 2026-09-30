import assert from "node:assert/strict";
import test from "node:test";
import registry from "../vendor/product-session-registry-b754ffc42.json" with {type:"json"};
import {createCentralBrowserSessionRegistry} from "@ynx-chain/wallet-auth/central-browser-session-registry";
import {CENTRAL_BROWSER_ISSUER,CENTRAL_BROWSER_PURPOSE} from "@ynx-chain/wallet-auth/central-browser-session-contract";
import {approveHostedCentralSignIn} from "../src/hosted-central-sign-in.js";
import {assertHostedMethodAllowed,registeredProduct,encodeHostedConnect,parseHostedConnect} from "../src/hosted-protocol.js";
function fixture(overrides={}) {
 const now=Date.now(),clients=createCentralBrowserSessionRegistry(registry),c=clients.find(c=>c.clientId==='finance')??clients[0];
 const challenge={version:1,issuer:CENTRAL_BROWSER_ISSUER,purpose:CENTRAL_BROWSER_PURPOSE,challengeId:"a".repeat(43),browserBinding:"b".repeat(64),nonce:"c".repeat(43),initiator:{clientId:c.clientId,origin:c.origin,redirectUri:c.redirectUri,state:"d".repeat(43),codeChallenge:"e".repeat(43),codeChallengeMethod:"S256"},clients:clients.map(c=>({clientId:c.clientId,origin:c.origin,audience:c.audience,scopes:[...c.scopes]})).sort((a,b)=>a.clientId.localeCompare(b.clientId)),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+120000).toISOString()};
 const vault={account:'0x'+'1'.repeat(40)},events=[];
 const args={params:[challenge],origin:CENTRAL_BROWSER_ISSUER,vault,store:{consumeReplay:async(key,expiry)=>events.push(['replay',key,expiry])},review:async()=>{events.push(['review']);return{approved:true,password:'QA-only-password'}},assertLive:()=>{},assertAccount:async()=>{},unlock:async()=>{events.push(['unlock']);return{account:vault.account,secretHex:'1'.padStart(64,'0')}},...overrides};
 return {args,challenge,events,vault};
}
test('Hosted central approval uses strict challenge, explicit review and encrypted account unlock',async()=>{
 const {args,events,challenge}=fixture(),approval=await approveHostedCentralSignIn(args);
 assert.equal(approval.challengeId,challenge.challengeId);assert.match(approval.account,/^ynx1/);assert.equal(approval.walletSignature.length,128);
 assert.deepEqual(Object.keys(approval).sort(),['account','accountPublicKey','challengeId','walletSignature']);
 assert.deepEqual(events.map(e=>e[0]),['replay','review','unlock']);assert.ok(events[0][1].includes(challenge.browserBinding));
});
test('foreign origin and expiry fail before replay, UI or unlock',async()=>{
 for (const change of [args=>args.origin='https://finance.ynxweb4.com',args=>args.params[0].expiresAt=new Date(Date.now()-1).toISOString(),args=>args.params.push(args.params[0])]) {
  const {args,events}=fixture();change(args);await assert.rejects(approveHostedCentralSignIn(args));assert.equal(events.length,0);
 }
});
test('replay persistence failure and explicit reject never unlock or sign',async()=>{
 let unlocked=false;const first=fixture({store:{consumeReplay:async()=>{throw new Error('storage unavailable')}},unlock:async()=>{unlocked=true}});await assert.rejects(approveHostedCentralSignIn(first.args),/storage unavailable/);assert.equal(first.events.length,0);
 const rejected=fixture({review:async()=>({approved:false}),unlock:async()=>{unlocked=true}});await assert.rejects(approveHostedCentralSignIn(rejected.args),{code:'USER_REJECTED'});assert.equal(unlocked,false);
});
test('late UI approval after popup cancellation cannot unlock or sign',async()=>{
 let cancelled=false,choose;const {args}=fixture({assertLive:()=>{if(cancelled)throw Object.assign(new Error('canceled'),{code:'HOSTED_APPROVAL_CANCELLED'})},review:()=>new Promise(resolve=>{choose=resolve}),unlock:async()=>{assert.fail('late approval must not unlock')}});
 const pending=approveHostedCentralSignIn(args);while(!choose)await new Promise(resolve=>setImmediate(resolve));cancelled=true;choose({approved:true,password:'QA-only-password'});await assert.rejects(pending,{code:'HOSTED_APPROVAL_CANCELLED'});
});
test('account replacement during deferred unlock never returns approval',async()=>{
 let unlocked;const {args}=fixture({unlock:()=>new Promise(resolve=>{unlocked=resolve})});const pending=approveHostedCentralSignIn(args);while(!unlocked)await new Promise(resolve=>setImmediate(resolve));unlocked({account:'0x'+'2'.repeat(40),secretHex:'1'.padStart(64,'0')});await assert.rejects(pending,{code:'HOSTED_ACCOUNT_CHANGED'});
});
test('central origin grants only identity/lifecycle methods, no funds or private scopes',()=>{
 assert.ok(registeredProduct(CENTRAL_BROWSER_ISSUER));const connect={version:1,chainId:'0x1917',origin:CENTRAL_BROWSER_ISSUER,requestId:'a'.repeat(32),nonce:'b'.repeat(32),expiresAt:Date.now()+120000};assert.equal(parseHostedConnect(encodeHostedConnect(connect)).origin,CENTRAL_BROWSER_ISSUER);
 for(const method of ['ynx_requestCentralBrowserSignIn','eth_accounts','eth_chainId','wallet_disconnect'])assert.doesNotThrow(()=>assertHostedMethodAllowed(CENTRAL_BROWSER_ISSUER,method));
 for(const method of ['ynx_requestProductSessionV2','personal_sign','eth_sendTransaction','eth_getBalance'])assert.throws(()=>assertHostedMethodAllowed(CENTRAL_BROWSER_ISSUER,method),{code:'HOSTED_IDENTITY_ONLY'});
 assert.equal(registeredProduct('https://wallet-auth.ynxweb4.com.attacker.invalid'),null);
});
