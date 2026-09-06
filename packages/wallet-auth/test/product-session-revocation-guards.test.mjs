import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  createProductSessionRequest, deviceBinding, ProductSessionAuthority, ProductSessionGatewayKernel,
  signProductSessionApproval, signProductSessionChallenge,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-09-06T10:00:00.000Z"), at = (offset = 0) => new Date(NOW + offset);
const OWNER = "1".padStart(64, "0"), OTHER = "2".padStart(64, "0");
const token = (label) => createHash("sha256").update(label).digest("base64url");
const secret = Buffer.alloc(32, 31), secretText = secret.toString("base64url");
const deviceKey = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");
const CHALLENGE = "/v2/product-sessions/challenge", COMPLETE = "/v2/product-sessions/complete";

function pending(label, { owner = OWNER, offset = 0, productId = "creator-studio" } = {}) {
  const product = registry.products.find((item) => item.productId === productId);
  const request = createProductSessionRequest(registry, {
    productId, platform: "web", deviceId: "same-revocation-audit-device", deviceKey, scopes: [product.scopes[0]],
    purpose: "Verify exact revocation admission and lost-response recovery.", nonce: token(`${label}-nonce`), state: token(`${label}-state`),
  }, at(offset));
  const approval = signProductSessionApproval(registry, request, { accountSecret: owner, scopes: request.scopes, expiresAt: request.expiresAt }, at(offset));
  return { request, approval };
}
function issue(authority, input, label, offset = 0) { return authority.issueChallenge({ ...input, challenge: token(label) }, at(offset)); }
function completion(input, challenge) { return { ...input, completion: signProductSessionChallenge(challenge, secretText) }; }
function active(authority, session, offset = 0) {
  const context = Object.fromEntries(["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey"].map((key) => [key, session[key]]));
  return authority.introspect(session.sessionBinding, { ...context, requiredScopes: [] }, at(offset));
}
function kernel(snapshot) { let index = 0; return new ProductSessionGatewayKernel(registry, () => token(`guard-challenge-${index++}`), snapshot); }
function dispatch(gateway, requestId, path, body, offset = 0, walletControlProof) {
  return gateway.dispatch({ requestId, method: "POST", path, body, proof: null, networkAvailable: true, ...(walletControlProof ? { walletControlProof } : {}) }, at(offset));
}
function readyGateway() {
  const gateway = kernel(), input = pending("cached"), challengeId = "req_guard_challenge_cached", completeId = "req_guard_complete_cached";
  const challengeResponse = dispatch(gateway, challengeId, CHALLENGE, input);
  const challenge = JSON.parse(challengeResponse.body).result, body = completion(input, challenge);
  const completeResponse = dispatch(gateway, completeId, COMPLETE, body);
  return { gateway, input, body, challengeId, completeId, challengeResponse, completeResponse, session: JSON.parse(completeResponse.body).result };
}

test("account cutoff rejects the signed approval time including the same millisecond, without mutation", () => {
  for (const approvalOffset of [0, 9, 10]) {
    const authority = new ProductSessionAuthority(registry), input = pending(`old-${approvalOffset}`, { offset: approvalOffset });
    authority.revokeAccount(input.approval.account, at(10));
    const before = authority.snapshot();
    assert.throws(() => issue(authority, input, `late-challenge-${approvalOffset}`, 20), { code: "SESSION_REVOKED" });
    assert.deepEqual(authority.snapshot(), before);
  }
});

test("pending completions cannot cross account logout, while explicit later approval may reconnect", () => {
  const authority = new ProductSessionAuthority(registry), old = pending("pending-cutoff");
  const challenge = issue(authority, old, "pending-cutoff-challenge");
  authority.revokeAccount(old.approval.account, at(10));
  const before = authority.snapshot();
  assert.throws(() => authority.complete(completion(old, challenge), at(20)), { code: "SESSION_REVOKED" });
  assert.deepEqual(authority.snapshot(), before);
  // A request may predate logout; a new explicit account signature must not.
  const freshApproval = signProductSessionApproval(registry, old.request, { accountSecret: OWNER, scopes: old.request.scopes, expiresAt: old.request.expiresAt }, at(11));
  const fresh = { request: old.request, approval: freshApproval }, freshChallenge = issue(authority, fresh, "fresh-after-cutoff", 20);
  const session = authority.complete(completion(fresh, freshChallenge), at(20));
  assert.equal(active(authority, session, 20).active, true);
});

test("permanent device revocation rejects issue and pending complete only for its exact account and product", () => {
  const authority = new ProductSessionAuthority(registry), owner = pending("device-owner");
  const challenge = issue(authority, owner, "device-owner-challenge");
  authority.revokeDevice(deviceBinding(owner.request, owner.approval.account));
  const before = authority.snapshot();
  assert.throws(() => authority.complete(completion(owner, challenge), at(10)), { code: "SESSION_REVOKED" });
  assert.throws(() => issue(authority, pending("device-owner-new", { offset: 11 }), "device-owner-new-challenge", 11), { code: "SESSION_REVOKED" });
  assert.deepEqual(authority.snapshot(), before);
  for (const [label, options] of [["device-other-account", { owner: OTHER }], ["device-other-product", { productId: "dex" }]]) {
    const input = pending(label, options), next = issue(authority, input, `${label}-challenge`, 20);
    const session = authority.complete(completion(input, next), at(20));
    assert.equal(active(authority, session, 20).active, true);
  }
});

test("account revocation cutoff cannot move backward or affect another account", () => {
  const authority = new ProductSessionAuthority(registry), input = pending("monotonic", { offset: 5 });
  const session = authority.complete(completion(input, issue(authority, input, "monotonic-challenge", 5)), at(5));
  const record = authority.revokeAccount(session.account, at(10)), before = authority.snapshot();
  assert.deepEqual(authority.revokeAccount(session.account, at(0)), record);
  assert.deepEqual(authority.revokeAccount(session.account, at(10)), record);
  assert.deepEqual(authority.snapshot(), before);
  assert.throws(() => active(authority, session, 20), { code: "SESSION_REVOKED" });
  const other = pending("monotonic-other", { owner: OTHER });
  const otherSession = authority.complete(completion(other, issue(authority, other, "monotonic-other-challenge", 20)), at(20));
  assert.equal(active(authority, otherSession, 20).active, true);
});

test("revocation admission still verifies the account signature before disclosing revocation", () => {
  const authority = new ProductSessionAuthority(registry), input = pending("forged-revoked");
  authority.revokeAccount(input.approval.account, at(10));
  const forged = { ...input, approval: { ...input.approval, walletSignature: "0".repeat(128) } };
  assert.throws(() => issue(authority, forged, "forged-revoked-challenge", 20), { code: "INVALID_SIGNATURE" });
});

test("active lost-complete recovery replays consumed challenge and exact completion across restart", () => {
  const setup = readyGateway(), restarted = kernel(setup.gateway.snapshot());
  assert.equal(dispatch(restarted, setup.challengeId, CHALLENGE, setup.input, 10).body, setup.challengeResponse.body);
  assert.equal(dispatch(restarted, setup.completeId, COMPLETE, setup.body, 10).body, setup.completeResponse.body);
  assert.equal(restarted.snapshot().authority.sessions.length, 1);
  assert.equal(restarted.snapshot().authority.issuedChallenges.length, 0);
  // Both original receipts remain exact across the short challenge deadline;
  // the longer-lived session controls whether completed work is recoverable.
  for (const elapsed of [59_999,60_000,61_000]) {
    assert.equal(dispatch(restarted, setup.challengeId, CHALLENGE, setup.input, elapsed).body, setup.challengeResponse.body);
    assert.equal(dispatch(restarted, setup.completeId, COMPLETE, setup.body, elapsed).body, setup.completeResponse.body);
  }
  assert.equal(restarted.snapshot().authority.sessions.length,1);
  assert.equal(restarted.snapshot().authority.issuedChallenges.length,0);
});

for (const reason of ["session", "device", "account"]) test(`cached completion and consumed challenge reject current ${reason} revocation without erasing history`, () => {
  const setup = readyGateway(), snapshot = setup.gateway.snapshot();
  const authority = new ProductSessionAuthority(registry, snapshot.authority);
  if (reason === "session") authority.revokeSession(setup.session.sessionBinding);
  if (reason === "device") authority.revokeDevice(setup.session.deviceBinding);
  if (reason === "account") authority.revokeAccount(setup.session.account, at(10));
  const restarted = kernel({ ...snapshot, authority: authority.snapshot() }), before = restarted.snapshot();
  for (const elapsed of [20,60_000,61_000]) {
    for (const [id, path, body] of [[setup.completeId, COMPLETE, setup.body], [setup.challengeId, CHALLENGE, setup.input]]) {
      const rejected = dispatch(restarted, id, path, body, elapsed);
      assert.equal(rejected.status, 403); assert.equal(JSON.parse(rejected.body).error.code, "SESSION_REVOKED");
    }
  }
  assert.deepEqual(restarted.snapshot().authority, before.authority);
  assert.deepEqual(restarted.snapshot().idempotency, before.idempotency);
  assert.deepEqual(restarted.snapshot().consumedProofs, before.consumedProofs);
});

test("completed requests cannot be challenged again after their cached session expires",()=>{
  const setup=readyGateway(),expires=Date.parse(setup.session.expiresAt)-NOW;
  const before=setup.gateway.snapshot().authority;
  const lastValid=dispatch(setup.gateway,setup.challengeId,CHALLENGE,setup.input,expires-1);
  assert.equal(lastValid.body,setup.challengeResponse.body);
  for (const elapsed of [expires,expires+1]) {
    const challenge=dispatch(setup.gateway,setup.challengeId,CHALLENGE,setup.input,elapsed);
    const complete=dispatch(setup.gateway,setup.completeId,COMPLETE,setup.body,elapsed);
    assert.notEqual(challenge.status,200);
    assert.notEqual(complete.status,200);
    assert.deepEqual(setup.gateway.snapshot().authority,before);
  }
  assert.equal(setup.gateway.snapshot().idempotency.length,0);
});

test("a completed request whose challenge cache was removed by an old runtime cannot mint a replacement challenge",()=>{
  const setup=readyGateway(),snapshot=setup.gateway.snapshot();
  const restored=kernel({...snapshot,idempotency:snapshot.idempotency.filter(item=>item.path!==CHALLENGE)});
  const rejected=dispatch(restored,setup.challengeId,CHALLENGE,setup.input,61_000);
  assert.equal(rejected.status,409);assert.equal(JSON.parse(rejected.body).error.code,"REPLAY");
  assert.deepEqual(restored.snapshot().authority,snapshot.authority);
  // A client with its protected exact completion still recovers the active receipt.
  assert.equal(dispatch(restored,setup.completeId,COMPLETE,setup.body,61_000).body,setup.completeResponse.body);
});

test("retained challenge caches isolate device revocation by product and account while account logout covers its products",()=>{
  for (const reason of ["device","account"]) {
    const gateway=kernel(),entries=[];
    for (const [label,options] of [["owner-creator",{}],["other-creator",{owner:OTHER}],["owner-dex",{productId:"dex"}]]) {
      const input=pending(`cache-isolation-${reason}-${label}`,options);
      const challengeId=`req_guard_isolation_${label}_challenge`,completeId=`req_guard_isolation_${label}_complete`;
      const challenge=dispatch(gateway,challengeId,CHALLENGE,input);
      const body=completion(input,JSON.parse(challenge.body).result),complete=dispatch(gateway,completeId,COMPLETE,body);
      entries.push({label,input,challengeId,completeId,challenge,complete,body,session:JSON.parse(complete.body).result});
    }
    const snapshot=gateway.snapshot(),authority=new ProductSessionAuthority(registry,snapshot.authority),target=entries[0].session;
    if(reason==="device")authority.revokeDevice(target.deviceBinding);else authority.revokeAccount(target.account,at(10));
    const restored=kernel({...snapshot,authority:authority.snapshot()});
    for (const entry of entries) {
      const revoked=entry.label==="owner-creator" || reason==="account"&&entry.label==="owner-dex";
      for (const [id,path,body,receipt] of [[entry.challengeId,CHALLENGE,entry.input,entry.challenge],[entry.completeId,COMPLETE,entry.body,entry.complete]]) {
        const response=dispatch(restored,id,path,body,61_000);
        if(revoked){assert.equal(response.status,403);assert.equal(JSON.parse(response.body).error.code,"SESSION_REVOKED")}
        else assert.equal(response.body,receipt.body);
      }
    }
    assert.equal(restored.snapshot().authority.sessions.length,3);
    assert.equal(restored.snapshot().authority.issuedChallenges.length,0);
  }
});

test("unconsumed cached challenges cannot bypass account or permanent device revocation", () => {
  for (const reason of ["account", "device"]) {
    const gateway = kernel(), input = pending(`cached-pending-${reason}`), requestId = `req_guard_pending_${reason}`;
    assert.equal(dispatch(gateway, requestId, CHALLENGE, input).status, 200);
    const snapshot = gateway.snapshot(), authority = new ProductSessionAuthority(registry, snapshot.authority);
    if (reason === "account") authority.revokeAccount(input.approval.account, at(10));
    else authority.revokeDevice(deviceBinding(input.request, input.approval.account));
    const restarted = kernel({ ...snapshot, authority: authority.snapshot() });
    const rejected = dispatch(restarted, requestId, CHALLENGE, input, 20);
    assert.equal(rejected.status, 403); assert.equal(JSON.parse(rejected.body).error.code, "SESSION_REVOKED");
  }
});
