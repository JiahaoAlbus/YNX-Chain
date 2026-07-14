import assert from "node:assert/strict";
import { test } from "node:test";
import { accountIdentity } from "../crypto/ynxSigner";
import { decodeIdentityRecord, encodeIdentityRecord } from "./identityRecord";

const accountSecret = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 1 : 0);
const deviceSecret = new Uint8Array(32).fill(0x41);

test("round trips a strict secure identity record", () => {
  const decoded = decodeIdentityRecord(encodeIdentityRecord(accountSecret, deviceSecret));
  assert.equal(accountIdentity(decoded.accountSecret).account, accountIdentity(accountSecret).account);
  assert.deepEqual(decoded.deviceSecret, deviceSecret);
  assert.notEqual(decoded.accountSecret, accountSecret);
  assert.notEqual(decoded.deviceSecret, deviceSecret);
});

test("rejects unreadable, extra-field, and malformed secure records", () => {
  assert.throws(() => decodeIdentityRecord("{"), /unreadable/);
  const valid = JSON.parse(encodeIdentityRecord(accountSecret, deviceSecret));
  assert.throws(() => decodeIdentityRecord(JSON.stringify({ ...valid, unexpected: true })), /invalid/);
  assert.throws(() => decodeIdentityRecord(JSON.stringify({ ...valid, deviceSecret: "00" })), /invalid/);
});

test("rejects a secure record whose account does not match its secret", () => {
  const valid = JSON.parse(encodeIdentityRecord(accountSecret, deviceSecret));
  assert.throws(() => decodeIdentityRecord(JSON.stringify({ ...valid, account: "ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" })), /does not match/);
});
