import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertFinanceOrderApprovalActive, canonicalJSON, createSignedFinanceOrderApproval,
  financeOrderApprovalDigest, financeOrderApprovalId, financeOrderHash,
  parseFinanceOrder, parseFinanceOrderApprovalUnsigned, parseSignedFinanceOrderApproval,
  verifySignedFinanceOrderApproval,
} from "../src/index.js";

const vectors = JSON.parse(await readFile(new URL("../testdata/finance-order-approval-v1.vectors.json", import.meta.url), "utf8"));
const positive = vectors.positive;
const unsigned = positive.unsigned;
const proof = Object.freeze({ ...unsigned, signature: positive.signature });
const ACTIVE = new Date("2026-09-19T09:02:00.000Z");
const clone = value => structuredClone(value);

test("shared frozen vector reproduces canonical order, hashes, signature and account binding", () => {
  assert.equal(canonicalJSON(parseFinanceOrder(positive.order)), positive.orderCanonical);
  assert.equal(financeOrderHash(positive.order), positive.orderHash);
  assert.deepEqual(parseFinanceOrderApprovalUnsigned(unsigned), unsigned);
  assert.equal(financeOrderApprovalDigest(unsigned), positive.approvalDigest);
  assert.deepEqual(parseSignedFinanceOrderApproval(proof), proof);
  assert.deepEqual(parseSignedFinanceOrderApproval(canonicalJSON(proof)), proof);
  assert.deepEqual(verifySignedFinanceOrderApproval(proof, unsigned, ACTIVE), proof);
  assert.match(financeOrderApprovalId(proof), /^finance_order_approval_[0-9a-f]{64}$/);
});

test("signing the frozen vector yields its exact compact low-S signature", () => {
  const actual = createSignedFinanceOrderApproval({ accountSecret: positive.testOnlyPublicSecretScalarHex, approval: unsigned }, ACTIVE);
  assert.deepEqual(actual, proof);
  assert.equal(actual.signature, positive.signature);
  assert.throws(() => createSignedFinanceOrderApproval({ accountSecret: "0".repeat(63) + "2", approval: unsigned }, ACTIVE), /account.*signing key/i);
  assert.throws(() => createSignedFinanceOrderApproval({ accountSecret: positive.testOnlyPublicSecretScalarHex, approval: unsigned }), /authority time/i);
});

test("parse remains historical while active verification uses required server time and exact lifetime", () => {
  assert.deepEqual(parseSignedFinanceOrderApproval(proof), proof);
  assert.throws(() => assertFinanceOrderApprovalActive(proof, new Date(unsigned.expiresAt)), /not currently active/);
  assert.throws(() => verifySignedFinanceOrderApproval(proof, unsigned, new Date(unsigned.expiresAt)), /not currently active/);
  assert.throws(() => assertFinanceOrderApprovalActive(proof, new Date(Date.parse(unsigned.issuedAt) - 1)), /not currently active/);
  assert.throws(() => assertFinanceOrderApprovalActive(proof), /authority time/);
  for (const [issuedAt, expiresAt] of [
    [unsigned.issuedAt, unsigned.issuedAt],
    [unsigned.issuedAt, "2026-09-19T09:05:00.001Z"],
    ["invalid", unsigned.expiresAt],
  ]) assert.throws(() => parseFinanceOrderApprovalUnsigned({ ...unsigned, issuedAt, expiresAt }));
});

test("every trusted identity and order binding must match the authoritative unsigned record", () => {
  const validChanges = [
    { subjectId: "subject_" + "b".repeat(64) },
    { brokerAccountId: "11234567-89ab-4cde-8fab-0123456789ab" },
    { callbackStateHash: "b".repeat(64) },
    { challengeId: "challenge_21111111-2222-4333-8444-555555555555" },
    { nonce: "19999999-8888-4777-8666-555555555555" },
    { requestId: "request_76666666-7777-4888-8999-000000000000" },
  ];
  for (const change of validChanges) assert.throws(() => verifySignedFinanceOrderApproval(proof, { ...unsigned, ...change }));
  const order = { ...unsigned.order, symbol: "ACMEX" };
  assert.throws(() => verifySignedFinanceOrderApproval(proof, { ...unsigned, order, orderHash: financeOrderHash(order) }, ACTIVE), /authoritative challenge/);
});

test("fixed product, source, platform, chain and Sandbox boundaries fail closed", () => {
  for (const change of [
    { version: "2" }, { productId: "dex" }, { applicationId: "com.ynxweb4.card" },
    { origin: "https://evil.example" }, { platform: "watchos" }, { chainId: "0x1" },
    { chainEnvironment: "mainnet" }, { tradingEnvironment: "live" }, { provider: "personal_trading_api" },
  ]) assert.throws(() => parseFinanceOrderApprovalUnsigned({ ...unsigned, ...change }), /source, platform, chain or Sandbox provider/);
});

test("all order business fields and exact cost arithmetic are signed and validated", () => {
  const changes = [
    { assetClass: "option" }, { assetId: "21111111-2222-4333-8444-555555555555" }, { currency: "YNXT" },
    { extendedHours: true }, { feeBoundSource: "unknown" }, { limitPrice: "125.35" }, { maxCost: "251.94" },
    { maxFee: "1.26" }, { orderId: "baaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, { orderType: "market" },
    { qty: "3" }, { side: "sell" }, { symbol: "OTHER" }, { timeInForce: "gtc" },
  ];
  for (const change of changes) {
    const order = { ...unsigned.order, ...change };
    assert.throws(() => parseFinanceOrderApprovalUnsigned({ ...unsigned, order }), undefined, JSON.stringify(change));
  }
  assert.deepEqual(parseFinanceOrder({ ...unsigned.order, side: "sell", maxCost: unsigned.order.maxFee }), { ...unsigned.order, side: "sell", maxCost: unsigned.order.maxFee });
  assert.throws(() => parseFinanceOrder({ ...unsigned.order, side: "sell" }), /Sell maxCost/);
  assert.throws(() => parseFinanceOrder({ ...unsigned.order, maxCost: "251.929999" }), /Buy maxCost/);
});

test("canonical integer and decimal grammar rejects rounding, exponent, signs and overflow", () => {
  for (const qty of ["0", "01", "1000001", "1.0", "+1"])
    assert.throws(() => parseFinanceOrder({ ...unsigned.order, qty }));
  for (const limitPrice of ["0", "00.1", "1.", ".1", "1.2300", "1e2", "+1", "1000000000"])
    assert.throws(() => parseFinanceOrder({ ...unsigned.order, limitPrice }));
  for (const key of ["maxCost", "maxFee"]) for (const value of ["00", "01", "1.", ".1", "1.230000", "1e2", "-1", "10000000000000"])
    assert.throws(() => parseFinanceOrder({ ...unsigned.order, [key]: value }));
  const maximum = { ...unsigned.order, qty: "1000000", limitPrice: "999999999.9999", maxFee: "9999999999999.999999", maxCost: "9999999999999.999999" };
  assert.throws(() => parseFinanceOrder(maximum), /maxCost/);
});

test("unknown, missing, hidden, accessor and custom-prototype fields never reach signing", () => {
  assert.throws(() => parseFinanceOrderApprovalUnsigned({ ...unsigned, extra: true }), /fields|hidden/);
  const missing = clone(unsigned); delete missing.subjectId;
  assert.throws(() => parseFinanceOrderApprovalUnsigned(missing), /fields/);
  const hidden = clone(unsigned); Object.defineProperty(hidden, "hidden", { value: true });
  assert.throws(() => parseFinanceOrderApprovalUnsigned(hidden), /hidden/);
  let reads = 0; const accessor = clone(unsigned); Object.defineProperty(accessor, "subjectId", { enumerable: true, get() { reads++; return unsigned.subjectId; } });
  assert.throws(() => parseFinanceOrderApprovalUnsigned(accessor), /accessors/); assert.equal(reads, 0);
  const inherited = Object.assign(Object.create({ injected: true }), unsigned);
  assert.throws(() => parseFinanceOrderApprovalUnsigned(inherited), /JSON object/);
  const orderAccessor = clone(unsigned.order); Object.defineProperty(orderAccessor, "symbol", { enumerable: true, get() { reads++; return "ACME"; } });
  assert.throws(() => parseFinanceOrder(orderAccessor), /accessors/); assert.equal(reads, 0);
});

test("raw JSON must be exact canonical UTF-8 with no duplicate, whitespace or trailing bytes", () => {
  const raw = canonicalJSON(proof);
  assert.throws(() => parseSignedFinanceOrderApproval(` ${raw}`), /canonical/);
  assert.throws(() => parseSignedFinanceOrderApproval(`${raw}\n`), /canonical/);
  assert.throws(() => parseSignedFinanceOrderApproval(`${raw}x`), /JSON/);
  const duplicate = raw.replace('{"account":', `{"account":"${proof.account}","account":`);
  assert.throws(() => parseSignedFinanceOrderApproval(duplicate), /canonical/);
});

test("account, public key, order hash and signature mutations are rejected", () => {
  assert.throws(() => parseFinanceOrderApprovalUnsigned({ ...unsigned, account: "ynx1" + "q".repeat(38) }));
  assert.throws(() => parseFinanceOrderApprovalUnsigned({ ...unsigned, accountPublicKey: "02" + "00".repeat(32) }));
  assert.throws(() => parseFinanceOrderApprovalUnsigned({ ...unsigned, orderHash: "0".repeat(64) }), /order hash/);
  assert.throws(() => parseSignedFinanceOrderApproval({ ...proof, signature: "0".repeat(128) }), /signature/);
  const n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
  const s = BigInt(`0x${proof.signature.slice(64)}`), highS = (n - s).toString(16).padStart(64, "0");
  assert.throws(() => parseSignedFinanceOrderApproval({ ...proof, signature: proof.signature.slice(0, 64) + highS }), /signature/);
});

test("mutation coverage list remains synchronized with the shared frozen vector", () => {
  assert.deepEqual(vectors.requiredNegativeMutations, [
    "unknown-or-missing-field", "accessor-or-non-plain-object", "noncanonical-json-or-decimal",
    "wrong-product-source-platform", "wrong-chain-environment-provider", "wrong-account-public-key-subject-broker-account",
    "asset-id-symbol-side-qty-price-cost-fee-tamper", "request-state-challenge-nonce-tamper",
    "expired-or-over-300-seconds", "wrong-order-hash", "invalid-or-high-s-signature",
    "rejected-revoked-expired-or-concurrently-consumed", "live-or-mainnet", "unknown-submission-blind-retry",
    "self-asserted-or-wrong-derived-subject", "native-platform-under-web-v1", "price-trailing-zero",
    "provider-uuid-version-assumption", "arbitrary-callback-url", "revoke-after-consume-or-wrong-account",
  ]);
});
