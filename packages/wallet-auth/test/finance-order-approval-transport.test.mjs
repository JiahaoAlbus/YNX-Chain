import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalJSON, createFinanceOrderApprovalRequest, createFinanceOrderApprovalReturnURL,
  createSignedFinanceOrderApproval, createSignedFinanceOrderApprovalRevocation,
  deriveFinanceSubjectId, encodeFinanceOrderApprovalWalletURL, financeOrderApprovalDigest,
  financeOrderApprovalRequestDigest, financeOrderApprovalRevocationDigest, financeOrderHash,
  parseFinanceOrder, parseFinanceOrderApprovalReturnURL, parseFinanceOrderApprovalWalletURL,
  parseProductSessionRegistry, parseSignedFinanceOrderApprovalRevocation,
  verifySignedFinanceOrderApprovalRevocation, verifySignedFinanceOrderApprovalRevocationAgainstUnsigned, walletIdentity,
} from "../src/index.js";

const vectors = JSON.parse(await readFile(new URL("../testdata/finance-order-approval-v1.vectors.json", import.meta.url), "utf8"));
const registry = parseProductSessionRegistry(JSON.parse(await readFile(new URL("../product-session-registry.json", import.meta.url), "utf8")));
const positive = vectors.positive, unsigned = positive.unsigned;
const secret = positive.testOnlyPublicSecretScalarHex;
const signed = Object.freeze({ ...unsigned, signature: positive.signature });
const ACTIVE = new Date("2026-09-19T09:02:00.000Z"), REVOKED = new Date("2026-09-19T09:03:00.000Z");

test("subject derives only from the frozen Finance Product Session identity", () => {
  assert.equal(deriveFinanceSubjectId({ account: unsigned.account, applicationId: unsigned.applicationId, platform: "web", productClientId: "ynx-finance-v1" }), unsigned.subjectId);
  for (const change of [{ applicationId: "com.ynxweb4.finance" }, { platform: "android" }, { productClientId: "other" }])
    assert.throws(() => deriveFinanceSubjectId({ account: unsigned.account, applicationId: unsigned.applicationId, platform: "web", productClientId: "ynx-finance-v1", ...change }));
});

test("provider UUID values do not assume v4 while YNX-generated IDs remain v4", () => {
  const order = { ...unsigned.order, assetId: "11111111-2222-0333-7444-555555555555" };
  assert.equal(parseFinanceOrder(order).assetId, order.assetId);
  const provider = { ...unsigned, brokerAccountId: "01234567-89ab-0cde-7fab-0123456789ab", order, orderHash: financeOrderHash(order) };
  assert.equal(createFinanceOrderApprovalRequest(provider, ACTIVE).unsigned.brokerAccountId, provider.brokerAccountId);
  for (const change of [{ requestId: "request_66666666-7777-0888-8999-000000000000" }, { challengeId: "challenge_11111111-2222-0333-8444-555555555555" }, { nonce: "99999999-8888-0777-8666-555555555555" }])
    assert.throws(() => createFinanceOrderApprovalRequest({ ...unsigned, ...change }, ACTIVE));
});

test("fixed Wallet request route round-trips canonical unsigned approval without a caller callback", () => {
  const request = createFinanceOrderApprovalRequest(unsigned, ACTIVE), url = encodeFinanceOrderApprovalWalletURL(request, ACTIVE);
  assert.ok(url.startsWith("ynxwallet://finance-order-approval?request="));
  assert.equal(Object.hasOwn(request, "callback"), false);
  assert.deepEqual(parseFinanceOrderApprovalWalletURL(url, ACTIVE), request);
  assert.match(financeOrderApprovalRequestDigest(request, ACTIVE), /^[0-9a-f]{64}$/);
  for (const malformed of [
    url.replace("ynxwallet://finance-order-approval", "ynxwallet://application-action"),
    `${url}&callback=https://evil.example`,
    url.replace("?request=", "?callback=https://evil.example&request="),
  ]) assert.throws(() => parseFinanceOrderApprovalWalletURL(malformed, ACTIVE));
});

test("approved and rejected results use only the registered Finance Web callback", () => {
  const request = createFinanceOrderApprovalRequest(unsigned, ACTIVE);
  const approvedURL = createFinanceOrderApprovalReturnURL(registry, request, { status: "approved", approval: signed }, ACTIVE);
  assert.ok(approvedURL.startsWith("https://finance.ynxweb4.com/wallet-auth/callback?financeOrderApprovalResult="));
  const approved = parseFinanceOrderApprovalReturnURL(registry, approvedURL, request, ACTIVE);
  assert.equal(approved.status, "approved"); assert.deepEqual(approved.approval, signed);
  const rejectedURL = createFinanceOrderApprovalReturnURL(registry, request, { status: "rejected", reason: "USER_REJECTED" }, ACTIVE);
  assert.equal(parseFinanceOrderApprovalReturnURL(registry, rejectedURL, request, ACTIVE).status, "rejected");
  assert.throws(() => createFinanceOrderApprovalReturnURL(registry, request, { status: "rejected", reason: "OTHER" }, ACTIVE));
  assert.throws(() => parseFinanceOrderApprovalReturnURL(registry, approvedURL.replace("finance.ynxweb4.com", "evil.example"), request, ACTIVE));
});

test("unused approval revocation is a separate exact account signature", () => {
  const request = createFinanceOrderApprovalRequest(unsigned, ACTIVE);
  const revocation = createSignedFinanceOrderApprovalRevocation({ accountSecret: secret, approval: signed }, REVOKED);
  assert.equal(revocation.approvalDigest, financeOrderApprovalDigest(signed));
  assert.equal(revocation.requestId, unsigned.requestId); assert.equal(revocation.reason, "USER_REVOKED");
  assert.match(financeOrderApprovalRevocationDigest(revocation), /^[0-9a-f]{64}$/);
  assert.deepEqual(parseSignedFinanceOrderApprovalRevocation(canonicalJSON(revocation)), revocation);
  assert.deepEqual(verifySignedFinanceOrderApprovalRevocation(revocation, signed, unsigned, REVOKED), revocation);
  assert.deepEqual(verifySignedFinanceOrderApprovalRevocationAgainstUnsigned(revocation, unsigned, REVOKED), revocation);
  const url = createFinanceOrderApprovalReturnURL(registry, request, { status: "revoked", approval: signed, revocation }, REVOKED);
  const withoutApproval = parseFinanceOrderApprovalReturnURL(registry, url, request, REVOKED);
  const withApproval = parseFinanceOrderApprovalReturnURL(registry, url, request, REVOKED, signed);
  assert.equal(withoutApproval.status, "revoked"); assert.deepEqual(withoutApproval.revocation, revocation);
  assert.deepEqual(withApproval, withoutApproval);
});

test("revocation without a delivered approval trusts only the authenticated unsigned challenge", () => {
  const revocation = createSignedFinanceOrderApprovalRevocation({ accountSecret: secret, approval: signed }, REVOKED);
  const other = walletIdentity("0".repeat(63) + "2");
  const wrongAccount = { ...unsigned, account: other.account, accountPublicKey: other.accountPublicKey,
    subjectId: deriveFinanceSubjectId({ account: other.account, applicationId: unsigned.applicationId, platform: "web", productClientId: "ynx-finance-v1" }) };
  for (const expected of [
    { ...unsigned, requestId: "request_77777777-7777-4777-8777-777777777777" },
    { ...unsigned, callbackStateHash: "b".repeat(64) }, wrongAccount,
  ]) assert.throws(() => verifySignedFinanceOrderApprovalRevocationAgainstUnsigned(revocation, expected, REVOKED), /authoritative unsigned challenge/);
  assert.throws(() => verifySignedFinanceOrderApprovalRevocationAgainstUnsigned(revocation, unsigned, ACTIVE), /lifetime/);
  assert.throws(() => verifySignedFinanceOrderApprovalRevocationAgainstUnsigned({ ...revocation, signature: "0".repeat(128) }, unsigned, REVOKED), /signature/);
  assert.throws(() => verifySignedFinanceOrderApprovalRevocationAgainstUnsigned({ ...revocation, approvalDigest: "0".repeat(64) }, unsigned, REVOKED), /signature/);
});

test("revocation fails for expiry, wrong account, wrong approval or unsigned correlation", () => {
  assert.throws(() => createSignedFinanceOrderApprovalRevocation({ accountSecret: secret, approval: signed }, new Date(unsigned.expiresAt)), /active/);
  assert.throws(() => createSignedFinanceOrderApprovalRevocation({ accountSecret: "0".repeat(63) + "2", approval: signed }, REVOKED), /signing key/);
  const revocation = createSignedFinanceOrderApprovalRevocation({ accountSecret: secret, approval: signed }, REVOKED);
  assert.throws(() => parseSignedFinanceOrderApprovalRevocation({ ...revocation, approvalDigest: "0".repeat(64) }), /signature/);
  assert.throws(() => parseSignedFinanceOrderApprovalRevocation({ ...revocation, signature: "0".repeat(128) }), /signature/);
  const request = createFinanceOrderApprovalRequest(unsigned, ACTIVE);
  const url = createFinanceOrderApprovalReturnURL(registry, request, { status: "revoked", revocation }, REVOKED);
  assert.equal(parseFinanceOrderApprovalReturnURL(registry, url, request, REVOKED).status, "revoked");
});

test("transport rejects field tampering before any product callback", () => {
  const request = createFinanceOrderApprovalRequest(unsigned, ACTIVE);
  for (const value of [
    { ...request, extra: true }, { ...request, route: "ynxwallet://finance-order-approval/" },
    { ...request, unsigned: { ...unsigned, platform: "android" } },
    { ...request, unsigned: { ...unsigned, subjectId: "subject_" + "0".repeat(64) } },
  ]) assert.throws(() => encodeFinanceOrderApprovalWalletURL(value, ACTIVE));
});

test("local approval signature never implies Broker submission or consumption state", () => {
  const generated = createSignedFinanceOrderApproval({ accountSecret: secret, approval: unsigned }, ACTIVE);
  assert.deepEqual(generated, signed);
  assert.equal(Object.hasOwn(generated, "providerOrderId"), false);
  assert.equal(Object.hasOwn(generated, "consumed"), false);
  assert.equal(Object.hasOwn(generated, "transactionHash"), false);
});
