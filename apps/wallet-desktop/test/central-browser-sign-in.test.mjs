import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { walletIdentity } from "@ynx-chain/wallet-auth";
import { PRODUCT_SESSION_REGISTRY } from "../src/wallet-auth-contract.mjs";
import { CENTRAL_BROWSER_METHOD, parseCentralSignIn, signCentralSignIn } from "../src/central-browser-sign-in.mjs";
const base=import.meta.resolve("@ynx-chain/wallet-auth");
const requireAuth=createRequire(base);
const {secp256k1}=await import(requireAuth.resolve("@noble/curves/secp256k1.js"));
const {sha256}=await import(requireAuth.resolve("@noble/hashes/sha2.js"));
const {hexToBytes,utf8ToBytes}=await import(requireAuth.resolve("@noble/hashes/utils.js"));
const { createCentralBrowserSessionRegistry }=await import(new URL("./central-browser-session-registry.js",base));
const { CENTRAL_BROWSER_ISSUER, CENTRAL_BROWSER_PURPOSE, centralBrowserConsentSignBytes }=await import(new URL("./central-browser-session-contract.js",base));
const now=Date.parse("2026-09-30T15:40:00.000Z"), registry=createCentralBrowserSessionRegistry(PRODUCT_SESSION_REGISTRY);
const secret="1".padStart(64,"0"); // Public unit fixture only; never an installed wallet.
function challenge(){const client=registry[0];return {version:1,issuer:CENTRAL_BROWSER_ISSUER,purpose:CENTRAL_BROWSER_PURPOSE,challengeId:"a".repeat(43),browserBinding:"b".repeat(64),nonce:"c".repeat(43),initiator:{clientId:client.clientId,origin:client.origin,redirectUri:client.redirectUri,state:"d".repeat(43),codeChallenge:"e".repeat(43),codeChallengeMethod:"S256"},clients:registry.map(c=>({clientId:c.clientId,origin:c.origin,audience:c.audience,scopes:[...c.scopes]})).sort((a,b)=>a.clientId.localeCompare(b.clientId)),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+120000).toISOString()};}
test("central consent signs the exact native account and independent shared domain",()=>{
  const input=challenge(),identity=walletIdentity(secret),approval=signCentralSignIn(input,CENTRAL_BROWSER_ISSUER,secret,now);
  assert.equal(CENTRAL_BROWSER_METHOD,"ynx_requestCentralBrowserSignIn");
  assert.equal(approval.account,identity.account);
  const verify=c=>secp256k1.verify(hexToBytes(approval.walletSignature),sha256(utf8ToBytes(centralBrowserConsentSignBytes(c,approval.account,approval.accountPublicKey))),hexToBytes(approval.accountPublicKey),{prehash:false,format:"compact",lowS:true});
  assert.equal(verify(input),true);
  const swapped=structuredClone(input);swapped.initiator.state="f".repeat(43);assert.equal(verify(swapped),false);
  assert.equal(secp256k1.verify(hexToBytes(approval.walletSignature),sha256(utf8ToBytes("YNX_PRODUCT_SESSION_APPROVAL_V2\n")),hexToBytes(approval.accountPublicKey),{prehash:false,format:"compact",lowS:true}),false);
});
test("central consent rejects substituted peer, client, purpose, fields and exact expiry",()=>{
  const input=challenge();
  assert.throws(()=>parseCentralSignIn([input],"https://finance.ynxweb4.com",now));
  assert.throws(()=>parseCentralSignIn([input,input],CENTRAL_BROWSER_ISSUER,now));
  for(const mutate of [c=>c.extra=true,c=>c.purpose="Sign anything",c=>c.initiator.redirectUri="https://attacker.invalid/callback",c=>c.clients[0].scopes.push("planning:write"),c=>c.issuer="https://attacker.invalid"]){const c=structuredClone(input);mutate(c);assert.throws(()=>parseCentralSignIn([c],CENTRAL_BROWSER_ISSUER,now));}
  assert.throws(()=>signCentralSignIn(input,CENTRAL_BROWSER_ISSUER,secret,now+120000));
});
