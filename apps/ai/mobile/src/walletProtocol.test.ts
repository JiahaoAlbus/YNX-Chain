import assert from "node:assert/strict";
import test from "node:test";
import {createDeviceIdentity,signGatewayChallenge,walletDeepLink} from "./walletProtocol";

test("formal Wallet request deep link and P-256 proof are deterministic",()=>{
  const identity=createDeviceIdentity("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI");
  assert.equal(identity.publicKey,"AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv");
  assert.match(walletDeepLink({version:"1",productDeviceKey:identity.publicKey}),/^ynxwallet:\/\/authorize\?request=/);
  const challenge={version:"1",challenge:"gateway_challenge_abcdefghijklmnop",requestDigest:"8af8ac0dd31e2aa874ef95d9c22c1aae25d1f42bf661b0427c9553aecc7f701d",productClientId:"ynx-ai-v1",bundleId:"com.ynxweb4.ai",productDeviceAlgorithm:"p256-sha256",productDeviceKey:identity.publicKey,account:"ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80",scopes:["ai:actions","ai:attachments","ai:conversations","ai:data-control","ai:generate","ai:permissions"],issuedAt:"2026-07-15T12:00:00.000Z",expiresAt:"2026-07-15T12:03:00.000Z"};
  assert.match(signGatewayChallenge(challenge,identity.secret).deviceSignature,/^[A-Za-z0-9_-]{90,96}$/);
});
