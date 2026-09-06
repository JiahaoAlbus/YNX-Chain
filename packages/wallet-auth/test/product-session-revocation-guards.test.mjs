import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionRequest, createProductSessionReturnURL, createWalletSessionControlProof,
  deviceBinding, httpBodyDigest, ProductSessionAuthority, ProductSessionGatewayFetchAdapter,
  ProductSessionGatewayHttpHandler, ProductSessionGatewayKernel, PRODUCT_SESSION_CLIENT_STATE,
  PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2, RecoverableProductSessionClient,
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

test("SDK lost-completion Retry after owner revoke never reconnects and only replays its exact completion", async () => {
  let sequence = 0, lost = false;
  const completionBodies=[],completionStatuses=[];
  let handler = new ProductSessionGatewayHttpHandler(registry, () => token(`sdk-guard-${sequence++}`));
  const fakeFetch = async (url, init) => {
    const path = new URL(url).pathname, headers = init.headers;
    if (path === "/v2/product-sessions/time") return new Response(canonicalJSON({ ok: true, requestId: headers["x-request-id"], result: { serverTime: at().toISOString() }, schemaVersion: 2 }), { headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": headers["x-request-id"] } });
    const result = handler.handle({ requestId: headers["x-request-id"], method: init.method, path, contentType: headers["content-type"], body: init.body, proofHeader: headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] ?? null, networkAvailable: true }, at());
    if (path === COMPLETE) { completionBodies.push(init.body);completionStatuses.push(result.status);if (!lost) { lost = true; throw new TypeError("completion response lost after commit"); } }
    return new Response(result.body, { status: result.status, headers: result.headers });
  };
  const gateway = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", fetch: fakeFetch, walletInstalled: async () => true, schemeRegistered: async () => true, timeoutMs: 5_000 });
  const values = new Map(), storage = { securityLevel: "os-protected", async get(key) { return values.get(key) ?? null; }, async set(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); } };
  const device = { id: "sdk-guard-device", key: deviceKey, secret: secretText, scopes: ["creator:account"], purpose: "Verify revocation during lost completion recovery." };
  const client = new RecoverableProductSessionClient({ registry, productId: "creator-studio", platform: "web", storage, gateway, device, tokenFactory: () => token(`sdk-client-${sequence++}`), clock: () => at() });
  const started = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, started.request, { accountSecret: OWNER, scopes: started.request.scopes, expiresAt: started.request.expiresAt }, at());
  const callback = createProductSessionReturnURL(registry, started.request, { result: "approved", approval }, at());
  assert.equal((await client.handleReturn(callback)).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  const session = handler.snapshot().authority.sessions[0], path = "/v2/product-sessions/wallet/sessions/revoke", body = { sessionBinding: session.sessionBinding };
  const proof = createWalletSessionControlProof({ accountSecret: OWNER, method: "POST", path, bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: token("sdk-owner-revoke"), issuedAt: at().toISOString(), expiresAt: at(30_000).toISOString() });
  const revoked = kernel(handler.snapshot());
  assert.equal(dispatch(revoked, "req_guard_sdk_owner_revoke", path, body, 0, proof).status, 200);
  // Restore the transport from the exact committed owner-revoked state.
  handler = new ProductSessionGatewayHttpHandler(registry, () => token(`sdk-restored-${sequence++}`), revoked.snapshot());
  assert.equal((await client.retry({ walletInstalled: true, schemeRegistered: true })).status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.equal(client.current.session, undefined);
  assert.equal(completionBodies.length,2);
  assert.equal(completionBodies[1],completionBodies[0]);
  assert.deepEqual(completionStatuses,[200,403]);
  assert.equal(values.size, 0);
  assert.equal(handler.snapshot().authority.sessions.length, 1);
});

const MIXED_TOKENS = ["Z", "a", "_", "-", "0", "A", "z"].map((character) => character.repeat(43));
function mixedPending(label, mixedToken) {
  const input = pending(label);
  const request = { ...input.request, nonce: `N${mixedToken}`, state: `S${mixedToken}` };
  const approval = signProductSessionApproval(registry, request, { accountSecret: OWNER, scopes: request.scopes, expiresAt: request.expiresAt }, at());
  return { request, approval };
}

test("mixed base64url pending challenges and consumed states use parser ordering across authority restart", () => {
  let authority = new ProductSessionAuthority(registry);
  const issued = [];
  for (const [index, mixedToken] of MIXED_TOKENS.entries()) {
    const input = mixedPending(`authority-mixed-${index}`, mixedToken);
    const challenge = authority.issueChallenge({ ...input, challenge: mixedToken }, at());
    issued.push({ input, challenge });
    const snapshot = authority.snapshot();
    assert.deepEqual(snapshot.issuedChallenges.map((item) => item.challenge), issued.map((item) => item.challenge.challenge).sort());
    authority = new ProductSessionAuthority(registry, snapshot);
    assert.deepEqual(authority.snapshot(), snapshot);
  }
  const reversed = { ...authority.snapshot(), issuedChallenges: [...authority.snapshot().issuedChallenges].reverse() };
  assert.throws(() => new ProductSessionAuthority(registry, reversed), { code: "INVALID_SESSION_STORE" });
  for (const { input, challenge } of [...issued].reverse()) {
    authority.complete(completion(input, challenge), at(10));
    const snapshot = authority.snapshot();
    for (const field of ["consumedNonces", "consumedStates", "consumedRequests", "consumedChallenges"]) assert.deepEqual(snapshot[field], [...snapshot[field]].sort());
    assert.deepEqual(snapshot.sessions.map((session) => session.sessionBinding), snapshot.sessions.map((session) => session.sessionBinding).sort());
    authority = new ProductSessionAuthority(registry, snapshot);
    assert.deepEqual(authority.snapshot(), snapshot);
  }
  assert.equal(authority.snapshot().sessions.length, MIXED_TOKENS.length);
  assert.equal(authority.snapshot().issuedChallenges.length, 0);
});

test("gateway keeps multiple mixed-case challenges through restart and exact completion replay after sixty seconds", () => {
  let sequence = 0;
  const gateway = new ProductSessionGatewayKernel(registry, () => MIXED_TOKENS[sequence++]);
  const entries = MIXED_TOKENS.map((mixedToken, index) => {
    const input = mixedPending(`gateway-mixed-${index}`, mixedToken), challengeId = `req_guard_mixed_${index}_challenge`, completeId = `req_guard_mixed_${index}_complete`;
    const response = dispatch(gateway, challengeId, CHALLENGE, input);
    assert.equal(response.status, 200, response.body);
    const body = completion(input, JSON.parse(response.body).result);
    return { input, body, challengeId, completeId, challengeResponse: response };
  });
  const pendingSnapshot = gateway.snapshot(), restarted = kernel(pendingSnapshot);
  assert.deepEqual(restarted.snapshot(), pendingSnapshot);
  for (const entry of [...entries].reverse()) {
    entry.completeResponse = dispatch(restarted, entry.completeId, COMPLETE, entry.body, 10);
    assert.equal(entry.completeResponse.status, 200, entry.completeResponse.body);
  }
  const completedSnapshot = restarted.snapshot(), recovered = kernel(completedSnapshot);
  assert.deepEqual(recovered.snapshot(), completedSnapshot);
  for (const entry of entries) {
    assert.equal(dispatch(recovered, entry.challengeId, CHALLENGE, entry.input, 61_000).body, entry.challengeResponse.body);
    assert.equal(dispatch(recovered, entry.completeId, COMPLETE, entry.body, 61_000).body, entry.completeResponse.body);
  }
  assert.equal(recovered.snapshot().authority.sessions.length, MIXED_TOKENS.length);
  assert.equal(recovered.snapshot().authority.issuedChallenges.length, 0);
});
