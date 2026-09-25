import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  createEvmProductSessionChallenge, createEvmProductSessionHttpProof, createEvmProductSessionHttpProofWith, createEvmProductSessionLoginProof, createEvmProductSessionLoginProofWith,
  createEvmProductSessionRevokeProof, createEvmProductSessionRevokeProofWith, EVM_PRODUCT_SESSION_REVOKE_TARGET,
  createEvmProductSessionSigningRequest, ethereumPersonalMessageDigest, evmProductSessionMessage,
  issueEvmProductSession, parseEvmProductSessionChallenge, verifyAndConsumeEvmProductSessionHttpProof, verifyAndConsumeEvmProductSessionRevokeProof,
} from "../src/index.js";
import { encodeBase64url } from "../src/base64url.js";
import { decodeBase64url } from "../src/base64url.js";

const vector = JSON.parse(readFileSync(new URL("../testdata/evm-product-session-v1.json", import.meta.url)));
const walletSecret = new Uint8Array(32).fill(7);
const deviceSecret = new Uint8Array(32).fill(9);
const at = new Date("2026-09-24T06:00:00.000Z");
const account = `0x${bytesToHex(keccak_256(secp256k1.getPublicKey(walletSecret, false).slice(1)).slice(-20))}`;
const secret = encodeBase64url(deviceSecret);
const challenge = createEvmProductSessionChallenge({ ...vector.challenge, account, deviceKey: encodeBase64url(p256.getPublicKey(deviceSecret, true)) });
const message = evmProductSessionMessage(challenge);
const recovered = secp256k1.sign(ethereumPersonalMessageDigest(message), walletSecret, { prehash: false, format: "recovered" });
const walletSignature = `0x${bytesToHex(concatBytes(recovered.slice(1), Uint8Array.of(recovered[0] + 27)))}`;
const loginProof = createEvmProductSessionLoginProof(challenge, walletSignature, secret);
const issue = { sessionId: "session_id_0123456789abcdefghijkl", expiresAt: "2026-09-24T06:10:00.000Z" };
const request = { method: "GET", target: "/api/private/account?view=balances", bodyDigest: "0".repeat(64), nonce: "proof_nonce_0123456789abcdefghijkl", issuedAt: "2026-09-24T06:00:01.000Z", expiresAt: "2026-09-24T06:00:31.000Z" };

test("positive vector signs the exact challenge, binds the P-256 device, and issues once", async () => {
  assert.equal(createEvmProductSessionSigningRequest(challenge).method, "personal_sign");
  assert.equal(Buffer.from(createEvmProductSessionSigningRequest(challenge).params[0].slice(2), "hex").toString(), message);
  const keys = new Set();
  const commit = async ({ challengeDigest, nonce, state, requestId, session }) => {
    const key = `${challengeDigest}:${nonce}:${state}:${requestId}`;
    if (keys.has(key)) return false;
    assert.equal(session.account, account); keys.add(key); return true;
  };
  const session = await issueEvmProductSession(loginProof, challenge, issue, commit, at);
  assert.equal(session.scope, "finance.account.read");
  assert.equal(session.account, account);
  await assert.rejects(issueEvmProductSession(loginProof, challenge, issue, commit, at), { code: "REPLAY_OR_STORE_FAILURE" });
  const proof = createEvmProductSessionHttpProof(session, request, secret), proofKeys = new Set();
  const consume = async ({ sessionId, nonce }) => { const key = `${sessionId}:${nonce}`; if (proofKeys.has(key)) return false; proofKeys.add(key); return true; };
  const context = { origin: challenge.origin, method: request.method, target: request.target, bodyDigest: request.bodyDigest, requiredScope: "finance.account.read", allowedTargets: ["/api/private/account"] };
  const authority = { currentAccount: account, currentChainId: 6423, connected: true, revoked: false };
  const load = async (id) => id === session.sessionId ? session : null;
  assert.equal((await verifyAndConsumeEvmProductSessionHttpProof(proof, load, context, authority, consume, new Date("2026-09-24T06:00:02.000Z"))).authorized, true);
  await assert.rejects(verifyAndConsumeEvmProductSessionHttpProof(proof, load, context, authority, consume, new Date("2026-09-24T06:00:02.000Z")), { code: "REPLAY" });
});

test("negative vectors reject challenge changes, wallet/device changes, and broad scopes", async () => {
  for (const changed of vector.invalidChallenges) assert.throws(() => parseEvmProductSessionChallenge({ ...challenge, ...changed }));
  await assert.rejects(issueEvmProductSession(loginProof, { ...challenge, state: "different_state_0123456789abcdef" }, issue, async () => true, at), { code: "CHALLENGE_MISMATCH" });
  const otherWallet = new Uint8Array(32).fill(8);
  const bad = secp256k1.sign(ethereumPersonalMessageDigest(message), otherWallet, { prehash: false, format: "recovered" });
  await assert.rejects(issueEvmProductSession({ ...loginProof, walletSignature: `0x${bytesToHex(concatBytes(bad.slice(1), Uint8Array.of(bad[0] + 27)))}` }, challenge, issue, async () => true, at), { code: "INVALID_SIGNATURE" });
  await assert.rejects(issueEvmProductSession({ ...loginProof, deviceSignature: createEvmProductSessionLoginProof(challenge, walletSignature, secret).deviceSignature.slice(0, -2) + "aa" }, challenge, issue, async () => true, at));
  await assert.rejects(issueEvmProductSession(loginProof, challenge, issue, async () => true, new Date(challenge.expiresAt)), { code: "CHALLENGE_EXPIRED" });
});

test("browser signer accepts WebCrypto-style 64-byte P-256 signatures", async () => {
  const signer = async ({ payload }) => encodeBase64url(p256.sign(decodeBase64url(payload), deviceSecret, { format: "compact" }));
  const browserLogin = await createEvmProductSessionLoginProofWith(challenge, walletSignature, signer);
  const session = await issueEvmProductSession(browserLogin, challenge, issue, async () => true, at);
  const browserHttp = await createEvmProductSessionHttpProofWith(session, request, signer);
  const context = { origin: challenge.origin, method: "GET", target: request.target, bodyDigest: request.bodyDigest, requiredScope: "finance.account.read", allowedTargets: ["/api/private/account"] };
  const authority = { currentAccount: account, currentChainId: 6423, connected: true, revoked: false };
  assert.equal((await verifyAndConsumeEvmProductSessionHttpProof(browserHttp, async () => session, context, authority, async () => true, new Date("2026-09-24T06:00:02.000Z"))).authorized, true);
});

test("HTTP proof denies crossed session, request, account, revocation and expiry", async () => {
  const session = await issueEvmProductSession(loginProof, challenge, issue, async () => true, at);
  const proof = createEvmProductSessionHttpProof(session, request, secret);
  const context = { origin: challenge.origin, method: "GET", target: request.target, bodyDigest: request.bodyDigest, requiredScope: "finance.account.read", allowedTargets: ["/api/private/account"] };
  const authority = { currentAccount: account, currentChainId: 6423, connected: true, revoked: false };
  const check = (p = proof, s = session, r = context, a = authority, when = new Date("2026-09-24T06:00:02.000Z")) => verifyAndConsumeEvmProductSessionHttpProof(p, async () => s, r, a, async () => true, when);
  await assert.rejects(verifyAndConsumeEvmProductSessionHttpProof(proof, async () => null, context, authority, async () => true), { code: "SESSION_NOT_FOUND" });
  await assert.rejects(check(proof, { ...session, sessionId: "other_session_0123456789abcdefgh" }), { code: "SESSION_BINDING_MISMATCH" });
  await assert.rejects(check(proof, session, { ...context, target: "/api/private/orders" }), { code: "ROUTE_DENIED" });
  await assert.rejects(check(proof, session, { ...context, target: "/api/private/account?view=orders" }), { code: "HTTP_BINDING_MISMATCH" });
  await assert.rejects(check(proof, session, { ...context, allowedTargets: [] }), { code: "ROUTE_DENIED" });
  await assert.rejects(check(proof, session, { ...context, allowedTargets: ["/api/private/orders"] }), { code: "ROUTE_DENIED" });
  await assert.rejects(check(proof, session, { ...context, requiredScope: "finance.order.create" }), { code: "SCOPE_DENIED" });
  await assert.rejects(check(proof, session, { ...context, method: "POST" }), { code: "SCOPE_DENIED" });
  await assert.rejects(check(proof, session, context, { ...authority, currentAccount: "0x" + "1".repeat(40) }), { code: "ACCOUNT_CHANGED" });
  await assert.rejects(check(proof, session, context, { ...authority, connected: false }), { code: "ACCOUNT_CHANGED" });
  await assert.rejects(check(proof, session, context, { ...authority, currentChainId: 1 }), { code: "CHAIN_CHANGED" });
  await assert.rejects(check(proof, session, context, { ...authority, revoked: true }), { code: "SESSION_REVOKED" });
  await assert.rejects(check(proof, session, context, authority, new Date(request.expiresAt)), { code: "SESSION_EXPIRED" });
});

test("POST revoke consumes the bound device proof once even after browser account or chain changes", async () => {
  const session = await issueEvmProductSession(loginProof, challenge, issue, async () => true, at);
  const revokeInput = { bodyDigest: "a".repeat(64), nonce: "revoke_nonce_0123456789abcdefghijk", issuedAt: "2026-09-24T06:00:01.000Z", expiresAt: "2026-09-24T06:00:31.000Z" };
  const proof = createEvmProductSessionRevokeProof(session, revokeInput, secret);
  assert.equal(proof.method, "POST"); assert.equal(proof.target, EVM_PRODUCT_SESSION_REVOKE_TARGET);
  const context = { origin: challenge.origin, method: "POST", target: EVM_PRODUCT_SESSION_REVOKE_TARGET, bodyDigest: revokeInput.bodyDigest };
  let revoked = false;
  const commit = async ({ sessionId, account: signedAccount, nonce }) => {
    assert.equal(sessionId, session.sessionId); assert.equal(signedAccount, account); assert.equal(nonce, revokeInput.nonce);
    if (revoked) return false; revoked = true; return true;
  };
  const load = async () => session;
  const when = new Date("2026-09-24T06:00:02.000Z");
  await assert.rejects(verifyAndConsumeEvmProductSessionHttpProof(proof, load, { ...context, requiredScope: "finance.account.read", allowedTargets: [EVM_PRODUCT_SESSION_REVOKE_TARGET] }, { currentAccount: account, currentChainId: 6423, connected: true, revoked: false }, async () => true, when), { code: "SCOPE_DENIED" });
  assert.equal((await verifyAndConsumeEvmProductSessionRevokeProof(proof, load, context, commit, when)).revoked, true);
  await assert.rejects(verifyAndConsumeEvmProductSessionRevokeProof(proof, load, context, commit, when), { code: "REPLAY_OR_REVOKED" });
});

test("revoke route, body, session, signature and time substitutions fail before revocation", async () => {
  const session = await issueEvmProductSession(loginProof, challenge, issue, async () => true, at);
  const signer = async ({ payload }) => encodeBase64url(p256.sign(decodeBase64url(payload), deviceSecret, { format: "compact" }));
  const revokeInput = { bodyDigest: "b".repeat(64), nonce: "revoke_nonce_0123456789abcdefghijk", issuedAt: "2026-09-24T06:00:01.000Z", expiresAt: "2026-09-24T06:00:31.000Z" };
  const proof = await createEvmProductSessionRevokeProofWith(session, revokeInput, signer);
  const context = { origin: challenge.origin, method: "POST", target: EVM_PRODUCT_SESSION_REVOKE_TARGET, bodyDigest: revokeInput.bodyDigest };
  let commits = 0;
  const check = (p = proof, s = session, r = context, when = new Date("2026-09-24T06:00:02.000Z")) => verifyAndConsumeEvmProductSessionRevokeProof(p, async () => s, r, async () => { commits++; return true }, when);
  await assert.rejects(check(proof, session, { ...context, method: "GET" }), { code: "REVOKE_ROUTE_MISMATCH" });
  await assert.rejects(check(proof, session, { ...context, target: "/api/private/account" }), { code: "REVOKE_ROUTE_MISMATCH" });
  await assert.rejects(check(proof, session, { ...context, bodyDigest: "c".repeat(64) }), { code: "HTTP_BINDING_MISMATCH" });
  await assert.rejects(check(proof, { ...session, sessionId: "other_session_0123456789abcdefgh" }), { code: "SESSION_BINDING_MISMATCH" });
  await assert.rejects(check({ ...proof, deviceSignature: proof.deviceSignature.slice(0, -2) + "aa" }));
  await assert.rejects(check(proof, session, context, new Date(revokeInput.expiresAt)), { code: "SESSION_EXPIRED" });
  assert.equal(commits, 0);
});
