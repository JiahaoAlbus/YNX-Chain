import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { test } from "node:test";
import { canonicalJSON } from "../src/canonical.js";
import { ynxAddressFromEVM } from "../src/crypto.js";
import {
  CARD_APPLICATION_APPROVAL_DOMAIN, createSignedCardApplicationApproval,
  parseSignedCardApplicationApproval, verifySignedCardApplicationApproval,
  cardApplicationDetailsHash, cardApplicationApprovalId,
} from "../src/card-application-approval.js";

// Public fixed test key 1; never read wallet storage or submit a Card request.
const SECRET = "0".repeat(63) + "1";
const ADDRESS = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const ACCOUNT = ynxAddressFromEVM(ADDRESS);
const PUBLIC_KEY = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const NOW = new Date("2026-09-12T00:00:30.000Z");
const sha = value => createHash("sha256").update(value).digest("hex");
const DETAILS = { nickname: "Travel & café", useCase: 'Testnet "travel" spending', limitWei: "10000000000000000000", riskAccepted: true, termsVersion: "card-testnet-v1" };
// Exact Card service digestInput behavior, independently implemented with Node
// SHA-256. This intentionally does not use production canonicalJSON/hash helpers.
const digestInput = value => Array.isArray(value) ? value.map(digestInput) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, digestInput(entry)])) : value;
const serviceJSON = value => JSON.stringify(digestInput(value));
const CHALLENGE = {
  id: "challenge_11111111-1111-4111-8111-111111111111",
  applicationId: "application_22222222-2222-4222-8222-222222222222",
  owner: ADDRESS, chainId: "0x1917", purpose: "create-testnet-card", payloadHash: sha(serviceJSON(DETAILS)),
  nonce: "33333333-3333-4333-8333-333333333333", issuedAt: "2026-09-12T00:00:00.000Z", expiresAt: "2026-09-12T00:05:00.000Z",
};
const input = (overrides = {}) => ({ accountSecret: SECRET, challenge: { ...CHALLENGE }, details: { ...DETAILS }, ...overrides });
const context = (overrides = {}) => ({ challenge: { ...CHALLENGE }, details: { ...DETAILS }, account: ACCOUNT, ...overrides });
const jwk = { kty: "EC", crv: "secp256k1", x: Buffer.from(PUBLIC_KEY.slice(2), "hex").toString("base64url"), y: Buffer.from("483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8", "hex").toString("base64url") };
const PUBLIC = createPublicKey({ key: jwk, format: "jwk" });
const PRIVATE = createPrivateKey({ key: { ...jwk, d: Buffer.from(SECRET, "hex").toString("base64url") }, format: "jwk" });
function unsignedFixture(overrides = {}) { return { version: "1", productId: "card", challenge: { ...CHALLENGE }, details: { ...DETAILS }, account: ACCOUNT, accountPublicKey: PUBLIC_KEY, issuedAt: NOW.toISOString(), expiresAt: CHALLENGE.expiresAt, ...overrides }; }
function independentSignature(unsigned, domain = "YNX_CARD_APPLICATION_APPROVAL_V1", lowS = true) {
  const bytes = sign("sha256", Buffer.from(`${domain}\n${serviceJSON(unsigned)}`), { key: PRIVATE, dsaEncoding: "ieee-p1363" });
  const s = BigInt(`0x${bytes.subarray(32).toString("hex")}`);
  const normalized = lowS ? (s > ORDER / 2n ? ORDER - s : s) : (s <= ORDER / 2n ? ORDER - s : s);
  return bytes.subarray(0, 32).toString("hex") + normalized.toString(16).padStart(64, "0");
}
function independentProof(overrides = {}, domain, lowS = true) { const unsigned = unsignedFixture(overrides); return { ...unsigned, signature: independentSignature(unsigned, domain, lowS) }; }

test("Card five-field digest matches independent sorted JSON including UTF-8 and escaping", () => {
  const literal = '{"limitWei":"10000000000000000000","nickname":"Travel & café","riskAccepted":true,"termsVersion":"card-testnet-v1","useCase":"Testnet \\"travel\\" spending"}'.replaceAll('\\\\"', '\\"');
  assert.equal(serviceJSON(DETAILS), literal);
  assert.equal(cardApplicationDetailsHash(DETAILS), sha(literal));
  // Also checked against a read-only import of Card's actual contracts.ts
  // digestInput, so this vector does not depend solely on the local transcription.
  assert.equal(cardApplicationDetailsHash(DETAILS), "c70ed75f022e6122e986d75f872765d73cb7491dd3e0713e60ed019ee5cb39b3");
  assert.equal(CHALLENGE.payloadHash, cardApplicationDetailsHash(DETAILS));
  assert.equal(cardApplicationDetailsHash(Object.fromEntries(Object.entries(DETAILS).reverse())), CHALLENGE.payloadHash);
});

test("creation binds full business details and challenge using independent OpenSSL verification", () => {
  const proof = createSignedCardApplicationApproval(input(), NOW);
  const { signature, ...unsigned } = proof;
  assert.equal(CARD_APPLICATION_APPROVAL_DOMAIN, "YNX_CARD_APPLICATION_APPROVAL_V1");
  assert.equal(proof.account, ACCOUNT); assert.equal(proof.accountPublicKey, PUBLIC_KEY);
  assert.deepEqual(proof.challenge, CHALLENGE); assert.deepEqual(proof.details, DETAILS);
  assert.equal(verify("sha256", Buffer.from(`YNX_CARD_APPLICATION_APPROVAL_V1\n${serviceJSON(unsigned)}`), { key: PUBLIC, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "hex")), true);
  assert.deepEqual(verifySignedCardApplicationApproval(proof, context(), NOW), proof);
  assert.equal(cardApplicationApprovalId(proof), `card_approval_${sha(serviceJSON(proof))}`);
  assert.deepEqual(createSignedCardApplicationApproval(input(), NOW), proof);
});

test("independently signed compact low-S Card proof is accepted", () => {
  const fixture = independentProof();
  assert.deepEqual(parseSignedCardApplicationApproval(serviceJSON(fixture)), fixture);
  assert.deepEqual(verifySignedCardApplicationApproval(fixture, context(), NOW), fixture);
});

test("native owner and EVM owner derive from the verified public key and require authenticated account context", () => {
  for (const owner of [ACCOUNT, ADDRESS]) {
    const challenge = { ...CHALLENGE, owner };
    const proof = createSignedCardApplicationApproval(input({ challenge }), NOW);
    for (const account of [ACCOUNT, ADDRESS]) assert.deepEqual(verifySignedCardApplicationApproval(proof, context({ challenge, account }), NOW), proof);
  }
  const other = `0x${"22".repeat(20)}`;
  assert.throws(() => createSignedCardApplicationApproval(input({ challenge: { ...CHALLENGE, owner: other } }), NOW), { code: "ACCOUNT_MISMATCH" });
  const proof = createSignedCardApplicationApproval(input(), NOW);
  assert.throws(() => verifySignedCardApplicationApproval(proof, context({ account: other }), NOW), { code: "BINDING_MISMATCH" });
  assert.throws(() => parseSignedCardApplicationApproval(independentProof({ account: ynxAddressFromEVM(other) })), { code: "INVALID_CARD_APPROVAL_SIGNATURE" });
  assert.throws(() => parseSignedCardApplicationApproval(independentProof({ challenge: { ...CHALLENGE, owner: other } })), { code: "INVALID_CARD_APPROVAL_SIGNATURE" });
  const missing = context(); delete missing.account;
  assert.throws(() => verifySignedCardApplicationApproval(proof, missing, NOW));
  assert.throws(() => verifySignedCardApplicationApproval(proof, context({ sessionActive: true }), NOW));
});

test("server context requires the exact application, challenge, nonce, owner spelling and timestamps", () => {
  const proof = createSignedCardApplicationApproval(input(), NOW);
  for (const [key, value] of [
    ["id", "challenge_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    ["applicationId", "application_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    ["nonce", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    ["owner", ACCOUNT], ["issuedAt", "2026-09-12T00:00:01.000Z"], ["expiresAt", "2026-09-12T00:04:59.000Z"],
  ]) assert.throws(() => verifySignedCardApplicationApproval(proof, context({ challenge: { ...CHALLENGE, [key]: value } }), NOW), { code: "BINDING_MISMATCH" });
  assert.deepEqual(verifySignedCardApplicationApproval(proof, context(), NOW), proof, "Pure verification deliberately does not mutate a replay ledger");
});

test("changing any approved business field or recomputing only its hash cannot authorize new details", () => {
  const proof = createSignedCardApplicationApproval(input(), NOW);
  for (const patch of [{ nickname: "Other card" }, { useCase: "Other Testnet use" }, { limitWei: "1" }]) {
    const details = { ...DETAILS, ...patch }, challenge = { ...CHALLENGE, payloadHash: sha(serviceJSON(details)) };
    assert.throws(() => parseSignedCardApplicationApproval({ ...proof, details }));
    assert.throws(() => parseSignedCardApplicationApproval({ ...proof, challenge, details }), { code: "INVALID_CARD_APPROVAL_SIGNATURE" });
    assert.throws(() => verifySignedCardApplicationApproval(proof, context({ challenge, details }), NOW), { code: "BINDING_MISMATCH" });
  }
  for (const details of [{ ...DETAILS, riskAccepted: false }, { ...DETAILS, termsVersion: "card-live-v1" }]) assert.throws(() => createSignedCardApplicationApproval(input({ details }), NOW));
});

test("DEX, generic Wallet and P-256 domains cannot be substituted for Card approval", () => {
  for (const domain of ["YNX_APPLICATION_ACTION_V1", "YNX_WALLET_APPROVAL_V1", "YNX_PRODUCT_SESSION_PROOF_V2", ""]) {
    assert.throws(() => parseSignedCardApplicationApproval(independentProof({}, domain)), { code: "INVALID_CARD_APPROVAL_SIGNATURE" });
  }
  for (const patch of [{ version: "2" }, { productId: "dex" }, { challenge: { ...CHALLENGE, chainId: "0x1" } }, { challenge: { ...CHALLENGE, purpose: "fund-card" } }]) assert.throws(() => parseSignedCardApplicationApproval(independentProof(patch)));
});

test("valid high-S and DER encodings are rejected for the compact low-S protocol", () => {
  const high = independentProof({}, undefined, false), { signature, ...unsigned } = high;
  assert.equal(verify("sha256", Buffer.from(`YNX_CARD_APPLICATION_APPROVAL_V1\n${serviceJSON(unsigned)}`), { key: PUBLIC, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "hex")), true);
  assert.throws(() => parseSignedCardApplicationApproval(high), { code: "INVALID_CARD_APPROVAL_SIGNATURE" });
  const proof = createSignedCardApplicationApproval(input(), NOW);
  const der = sign("sha256", Buffer.from(`YNX_CARD_APPLICATION_APPROVAL_V1\n${serviceJSON(unsigned)}`), PRIVATE).toString("hex");
  for (const signature of [der, "0".repeat(128), proof.signature.toUpperCase(), proof.signature + "00"]) assert.throws(() => parseSignedCardApplicationApproval({ ...proof, signature }));
  assert.throws(() => parseSignedCardApplicationApproval({ ...proof, accountPublicKey: `02${"ff".repeat(32)}` }), { code: "INVALID_CARD_APPROVAL_SIGNATURE" });
});

test("challenge lifetime is at most 300 seconds and creation cannot sign future or expired challenges", () => {
  for (const expiresAt of [CHALLENGE.issuedAt, "2026-09-12T00:05:00.001Z", "2026-09-12T00:00:29.000Z"]) {
    assert.throws(() => createSignedCardApplicationApproval(input({ challenge: { ...CHALLENGE, expiresAt } }), NOW));
  }
  assert.throws(() => createSignedCardApplicationApproval(input(), new Date("2026-09-11T23:59:59.999Z")), { code: "CARD_APPROVAL_EXPIRED" });
  assert.throws(() => createSignedCardApplicationApproval(input(), new Date(CHALLENGE.expiresAt)), { code: "CARD_APPROVAL_EXPIRED" });
  assert.throws(() => createSignedCardApplicationApproval(input(), new Date(NaN)));
  const proof = createSignedCardApplicationApproval(input(), NOW);
  assert.throws(() => verifySignedCardApplicationApproval(proof, context(), new Date(CHALLENGE.expiresAt)), { code: "CARD_APPROVAL_EXPIRED" });
  assert.throws(() => verifySignedCardApplicationApproval(proof, context(), new Date(NOW.getTime() - 1)), { code: "CARD_APPROVAL_EXPIRED" });
  assert.doesNotThrow(() => parseSignedCardApplicationApproval(proof));
  assert.match(cardApplicationApprovalId(proof), /^card_approval_[0-9a-f]{64}$/);
});

test("even correctly signed approval timestamps must fit inside the exact challenge", () => {
  for (const patch of [{ issuedAt: "2026-09-11T23:59:59.999Z" }, { expiresAt: "2026-09-12T00:05:00.001Z" }, { expiresAt: NOW.toISOString() }, { issuedAt: "2026-02-30T00:00:00.000Z" }]) assert.throws(() => parseSignedCardApplicationApproval(independentProof(patch)));
  const future = independentProof({ issuedAt: "2026-09-12T00:00:31.000Z" });
  assert.throws(() => verifySignedCardApplicationApproval(future, context(), NOW), { code: "CARD_APPROVAL_EXPIRED" });
});

test("five details fields reject nested payloads, extra controls, ambiguous amounts and altered risk terms", () => {
  for (const patch of [
    { nickname: { text: DETAILS.nickname } }, { useCase: [DETAILS.useCase] }, { controls: { international: true } },
    { limitWei: 1 }, { limitWei: "01" }, { limitWei: "0" }, { limitWei: "-1" }, { limitWei: "1e18" }, { limitWei: (2n ** 256n).toString() },
    { nickname: "x" }, { nickname: " x " }, { nickname: "x".repeat(49) }, { useCase: "abc" }, { useCase: "x".repeat(161) },
    { riskAccepted: "true" }, { termsVersion: { value: "card-testnet-v1" } },
  ]) assert.throws(() => cardApplicationDetailsHash({ ...DETAILS, ...patch }));
  for (const key of Object.keys(DETAILS)) { const missing = { ...DETAILS }; delete missing[key]; assert.throws(() => cardApplicationDetailsHash(missing)); }
  assert.doesNotThrow(() => cardApplicationDetailsHash({ ...DETAILS, limitWei: (2n ** 256n - 1n).toString() }));
});

test("unknown challenge/proof fields and noncanonical UUID, owner and JSON encodings fail closed", () => {
  const proof = createSignedCardApplicationApproval(input(), NOW);
  for (const patch of [{ nonce: "random" }, { id: CHALLENGE.id.toUpperCase() }, { applicationId: CHALLENGE.id }, { nonce: "33333333-3333-1333-8333-333333333333" }, { owner: ADDRESS.toUpperCase() }, { controls: {} }]) assert.throws(() => createSignedCardApplicationApproval(input({ challenge: { ...CHALLENGE, ...patch } }), NOW));
  for (const key of Object.keys(CHALLENGE)) { const challenge = { ...CHALLENGE }; delete challenge[key]; assert.throws(() => createSignedCardApplicationApproval(input({ challenge }), NOW)); }
  assert.throws(() => parseSignedCardApplicationApproval({ ...proof, approved: true }));
  const canonical = canonicalJSON(proof);
  for (const raw of [` ${canonical}`, `${canonical}\n`, JSON.stringify(proof), canonical.replace('"version":"1"', '"version":"1","version":"1"'), " ".repeat(16385), "null"]) assert.throws(() => parseSignedCardApplicationApproval(raw));
});

test("approvals detach and freeze reviewed inputs and reject data accessors or hidden fields", () => {
  const draft = input(), proof = createSignedCardApplicationApproval(draft, NOW);
  draft.details.nickname = "Changed"; draft.challenge.nonce = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.deepEqual(proof.details, DETAILS); assert.deepEqual(proof.challenge, CHALLENGE);
  assert.equal(Object.isFrozen(proof), true); assert.equal(Object.isFrozen(proof.details), true); assert.equal(Object.isFrozen(proof.challenge), true);
  assert.throws(() => { proof.details.nickname = "Changed"; }, TypeError);
  let reads = 0; const accessor = { ...DETAILS };
  Object.defineProperty(accessor, "nickname", { enumerable: true, get() { reads++; return DETAILS.nickname; } });
  const hidden = { ...DETAILS }; Object.defineProperty(hidden, "toJSON", { value: () => DETAILS });
  for (const details of [accessor, hidden, { ...DETAILS, [Symbol("extra")]: true }, null, []]) assert.throws(() => cardApplicationDetailsHash(details));
  assert.equal(reads, 0);
});

test("invalid signing secrets and digest-only or session-shaped inputs never produce an approval", () => {
  for (const accountSecret of ["0".repeat(64), "f".repeat(64), "A".repeat(64), "1", null]) assert.throws(() => createSignedCardApplicationApproval(input({ accountSecret }), NOW), { code: "INVALID_SECRET" });
  for (const value of [{ payloadHash: CHALLENGE.payloadHash }, { active: true, account: ACCOUNT }, { approved: true, ...CHALLENGE }]) assert.throws(() => parseSignedCardApplicationApproval(value));
  const proof = createSignedCardApplicationApproval(input(), NOW);
  assert.equal(Object.hasOwn(proof, "active"), false); assert.equal(Object.hasOwn(proof, "session"), false); assert.equal(Object.hasOwn(proof, "transactionHash"), false);
});
