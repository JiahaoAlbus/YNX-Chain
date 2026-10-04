import assert from "node:assert/strict";
import test from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, concatBytes } from "@noble/hashes/utils.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  createEvmProductLoginChallenge, createEvmProductLoginSigningRequest,
  ethereumPersonalMessageDigest, evmProductLoginMessage,
  parseEvmProductLoginProof, verifyAndConsumeEvmProductLoginProof,
  verifyEvmProductLoginProof,
} from "../src/index.js";

const SECRET = new Uint8Array(32).fill(7);
const NOW = new Date("2026-09-24T06:00:00.000Z");
const challengeInput = {
  domain: "finance.ynxweb4.com", uri: "https://finance.ynxweb4.com/auth/wallet",
  account: ethereumAddress(SECRET), accountType: "eoa", chainId: 6423,
  nonce: "a1b2c3d4e5f6g7h8", issuedAt: "2026-09-24T05:59:30.000Z",
  notBefore: "2026-09-24T05:59:30.000Z", expirationTime: "2026-09-24T06:04:30.000Z",
  requestId: "finance-login-00000001", statement: "Sign in to YNX Finance.",
  productId: "finance", scopes: ["finance.account.read", "finance.order.create"], providerKind: "metamask",
};

function challenge(overrides = {}) { return createEvmProductLoginChallenge({ ...challengeInput, ...overrides }); }
function sign(value, secret = SECRET) {
  const message = evmProductLoginMessage(value), digest = ethereumPersonalMessageDigest(message);
  const recovered = secp256k1.sign(digest, secret, { prehash: false, format: "recovered" });
  const ethereum = concatBytes(recovered.slice(1), Uint8Array.of(recovered[0] + 27));
  return { challenge: value, message, signature: `0x${bytesToHex(ethereum)}` };
}
function context(value, overrides = {}) {
  return { challenge: value, clockSkewMs: 120000, verifyContractSignature: null, ...overrides };
}
function ethereumAddress(secret) {
  const publicKey = secp256k1.getPublicKey(secret, false);
  const digest = keccak_256(publicKey.slice(1));
  return `0x${bytesToHex(digest.slice(-20))}`;
}

test("challenge renders one exact ERC-4361 message and personal_sign request", () => {
  const value = challenge(), message = evmProductLoginMessage(value), request = createEvmProductLoginSigningRequest(value);
  assert.match(message, /^finance\.ynxweb4\.com wants you to sign in with your Ethereum account:/);
  assert.match(message, /Chain ID: 6423/);
  assert.match(message, /urn:ynx:product:finance/);
  assert.match(message, /urn:ynx:provider:metamask/);
  assert.equal(request.method, "personal_sign");
  assert.equal(Buffer.from(request.params[0].slice(2), "hex").toString("utf8"), message);
  assert.equal(request.params[1], value.account);
});

test("EOA proof verifies exact signed bytes and is consumed atomically once", async () => {
  const value = challenge(), proof = sign(value), consumed = new Set();
  const consume = async ({ nonce, requestId }) => {
    const key = `${nonce}:${requestId}`; if (consumed.has(key)) return false; consumed.add(key); return true;
  };
  assert.equal((await verifyAndConsumeEvmProductLoginProof(proof, context(value), consume, NOW)).account, value.account);
  await assert.rejects(verifyAndConsumeEvmProductLoginProof(proof, context(value), consume, NOW), { code: "REPLAY" });
});

test("message substitution, scope widening, account changes and expiry fail closed", async () => {
  const value = challenge(), proof = sign(value);
  assert.throws(() => parseEvmProductLoginProof({ ...proof, message: `${proof.message} ` }), { code: "MESSAGE_MISMATCH" });
  await assert.rejects(verifyEvmProductLoginProof(proof, context(value, { challenge: { ...value, scopes: ["finance.account.read"] } }), NOW), { code: "LOGIN_BINDING_MISMATCH" });
  await assert.rejects(verifyEvmProductLoginProof(proof, context(value, { challenge: { ...value, account: "0x" + "11".repeat(20) } }), NOW), { code: "LOGIN_BINDING_MISMATCH" });
  await assert.rejects(verifyEvmProductLoginProof(proof, context(value, { challenge: { ...value, nonce: "z9y8x7w6v5u4t3s2" } }), NOW), { code: "LOGIN_BINDING_MISMATCH" });
  await assert.rejects(verifyEvmProductLoginProof(proof, context(value), new Date("2026-09-24T06:04:30.000Z")), { code: "LOGIN_EXPIRED" });
  const other = new Uint8Array(32).fill(8);
  await assert.rejects(verifyEvmProductLoginProof(sign(value, other), context(value), NOW), { code: "INVALID_SIGNATURE" });
});

test("contract accounts require an explicit EIP-1271 verifier", async () => {
  const value = challenge({ accountType: "contract", account: "0x" + "22".repeat(20) }), proof = { challenge: value, message: evmProductLoginMessage(value), signature: "0x123456" };
  await assert.rejects(verifyEvmProductLoginProof(proof, context(value), NOW), { code: "CONTRACT_ACCOUNT_UNSUPPORTED" });
  let received;
  const verified = await verifyEvmProductLoginProof(proof, context(value, { verifyContractSignature: async (input) => { received = input; return true; } }), NOW);
  assert.equal(verified.accountType, "contract"); assert.equal(received.account, value.account); assert.match(received.digest, /^0x[0-9a-f]{64}$/);
});

test("EOA stays fixed at 65 bytes while EIP-1271 signatures are bounded variable bytes", async () => {
  const eoa = challenge();
  assert.throws(() => parseEvmProductLoginProof({ challenge: eoa, message: evmProductLoginMessage(eoa), signature: "0x1234" }), { code: "INVALID_SIGNATURE" });
  const contract = challenge({ accountType: "contract", account: "0x" + "22".repeat(20) });
  assert.throws(() => parseEvmProductLoginProof({ challenge: contract, message: evmProductLoginMessage(contract), signature: `0x${"12".repeat(2049)}` }), { code: "INVALID_SIGNATURE" });
  const proof = { challenge: contract, message: evmProductLoginMessage(contract), signature: `0x${"12".repeat(257)}` };
  assert.equal((await verifyEvmProductLoginProof(proof, context(contract, { verifyContractSignature: async () => true }), NOW)).accountType, "contract");
});
