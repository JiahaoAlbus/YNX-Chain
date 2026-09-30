import assert from "node:assert/strict";
import test from "node:test";
import {SigningKey,sha256,toUtf8Bytes} from "ethers";
import registry from "../vendor/product-session-registry-b754ffc42.json" with {type:"json"};
import {createCentralBrowserSessionRegistry} from "../../../packages/wallet-auth/src/central-browser-session-registry.js";
import {CENTRAL_BROWSER_ISSUER,CENTRAL_BROWSER_PURPOSE,centralBrowserConsentSignBytes} from "../../../packages/wallet-auth/src/central-browser-session-contract.js";
import {parseCentralRequest,signCentralApproval} from "../src/extension-central-sign-in.js";
const now=Date.parse("2026-09-30T16:00:00.000Z"),clients=createCentralBrowserSessionRegistry(registry),c=clients[0];
const challenge={version:1,issuer:CENTRAL_BROWSER_ISSUER,purpose:CENTRAL_BROWSER_PURPOSE,challengeId:"a".repeat(43),browserBinding:"b".repeat(64),nonce:"c".repeat(43),initiator:{clientId:c.clientId,origin:c.origin,redirectUri:c.redirectUri,state:"d".repeat(43),codeChallenge:"e".repeat(43),codeChallengeMethod:"S256"},clients:clients.map(c=>({clientId:c.clientId,origin:c.origin,audience:c.audience,scopes:[...c.scopes]})).sort((a,b)=>a.clientId.localeCompare(b.clientId)),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+120000).toISOString()};
test("extension native consent returns the exact compact lowS approval for the shared challenge",()=>{
  const approval=signCentralApproval(challenge,CENTRAL_BROWSER_ISSUER,"1".padStart(64,"0"),now);
  assert.equal(approval.challengeId,challenge.challengeId);assert.match(approval.account,/^ynx1/);
  const digest=sha256(toUtf8Bytes(centralBrowserConsentSignBytes(challenge,approval.account,approval.accountPublicKey)));
  const signature={r:`0x${approval.walletSignature.slice(0,64)}`,s:`0x${approval.walletSignature.slice(64)}`};
  assert.equal([27,28].some(v=>SigningKey.computePublicKey(SigningKey.recoverPublicKey(digest,{...signature,v}),true).slice(2)===approval.accountPublicKey),true);
  assert.ok(BigInt(signature.s)<=BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0"));
});
test("extension central consent rejects foreign pages, substituted scopes/redirect and exact expiry",()=>{
  assert.throws(()=>parseCentralRequest([challenge],c.origin,now));
  assert.throws(()=>parseCentralRequest([challenge,challenge],CENTRAL_BROWSER_ISSUER,now));
  for(const mutate of [c=>c.clients[0].scopes.push("finance.profile.write"),c=>c.initiator.redirectUri="https://attacker.invalid/sso/callback",c=>c.extra=true]){const changed=structuredClone(challenge);mutate(changed);assert.throws(()=>parseCentralRequest([changed],CENTRAL_BROWSER_ISSUER,now));}
  assert.throws(()=>signCentralApproval(challenge,CENTRAL_BROWSER_ISSUER,"1".padStart(64,"0"),now+120000));
});
