import assert from "node:assert/strict";
import { test } from "node:test";
import { accountIdentity, createNativeTransferPreview, signNativeTransfer } from "../crypto/ynxSigner";
import { broadcastNativeTransfer, fetchNativeAccount, fetchNativeActivity, fetchNativeWalletSnapshot, trackNativeTransferFinality } from "./nativeWallet";

const secret = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 1 : 0);
const identity = accountIdentity(secret);
const recipient = "0xffffffffffffffffffffffffffffffffffffffff";
const txHash = `0x${"a".repeat(64)}`;

test("loads exact live account fields and filters recent activity", async () => {
  const fetchImpl = async (url: string) => {
    if (url.includes("/accounts/")) return json({ account: { address: identity.evmAddress, balance: 90, staked: 5, nonce: 3 } });
    return json({ transactions: [
      transaction({ hash: txHash, from: identity.evmAddress, to: recipient, amount: 8, fee: 1, nonce: 3, blockNumber: 12 }),
      transaction({ hash: `0x${"b".repeat(64)}`, from: recipient, to: "0x1111111111111111111111111111111111111111", amount: 4, fee: 1, nonce: 1, blockNumber: 13 }),
    ] });
  };
  const snapshot = await fetchNativeWalletSnapshot(identity.account, { fetchImpl });
  assert.deepEqual(snapshot.account, { address: identity.evmAddress, ynxAddress: identity.account, balance: 90, staked: 5, nonce: 3, exists: true });
  assert.equal(snapshot.activity.length, 1);
  assert.equal(snapshot.activity[0]?.hash, txHash);
  assert.equal(snapshot.activityScope, "latest-100-network-transactions");
  assert.equal(snapshot.activityAvailable, true);
});

test("keeps verified account state when only recent activity is unavailable", async () => {
  const snapshot = await fetchNativeWalletSnapshot(identity.account, { fetchImpl: async (url) => {
    if (url.includes("/accounts/")) return json({ account: { address: identity.evmAddress, balance: 17, staked: 0, nonce: 2 } });
    return json({ error: "indexer window unavailable" }, 503);
  } });
  assert.equal(snapshot.account.balance, 17);
  assert.equal(snapshot.activityAvailable, false);
  assert.equal(snapshot.activity.length, 0);
  assert.equal(snapshot.activityError, "indexer window unavailable");
});

test("does not invent a zero balance when the account request fails", async () => {
  await assert.rejects(fetchNativeWalletSnapshot(identity.account, { fetchImpl: async (url) => url.includes("/accounts/") ? json({ error: "RPC unavailable" }, 503) : json({ transactions: [] }) }), /RPC unavailable/);
});

test("represents an unfunded account without inventing chain state", async () => {
  const account = await fetchNativeAccount(identity.account, { fetchImpl: async () => json({ error: "account not found" }, 404) });
  assert.deepEqual(account, { address: identity.evmAddress, ynxAddress: identity.account, balance: 0, staked: 0, nonce: 0, exists: false });
});

test("rejects unsafe account and transaction payloads", async () => {
  await assert.rejects(fetchNativeAccount(identity.account, { fetchImpl: async () => json({ account: { address: recipient, balance: 1, staked: 0, nonce: 0 } }) }), /different account/);
  await assert.rejects(fetchNativeActivity(identity.account, { fetchImpl: async () => json({ transactions: [transaction({ hash: "bad" })] }) }), /hash is not canonical/);
  await assert.rejects(fetchNativeAccount(identity.account, { fetchImpl: async () => json({ account: { address: identity.evmAddress, balance: Number.MAX_SAFE_INTEGER + 1, staked: 0, nonce: 0 } }) }), /exact/);
});

test("broadcasts canonical JSON and binds the response to the signature", async () => {
  const signed = signNativeTransfer({ accountSecret: secret, preview: createNativeTransferPreview({ from: identity.account, to: recipient, amount: 8, nonce: 4, balance: 90 }) });
  let observedBody = "";
  let observedContentType = "";
  const result = await broadcastNativeTransfer(signed, { fetchImpl: async (_url, init) => {
    observedBody = String(init?.body);
    observedContentType = String((init?.headers as Record<string, string>)["Content-Type"]);
    return json({ transaction: transaction({ hash: signed.hash, from: identity.evmAddress, to: recipient, amount: 8, fee: 1, nonce: 4 }), replayed: false, truthfulStatus: "signature-verified-authoritative-native-transfer" }, 201);
  } });
  assert.equal(observedBody, signed.payload);
  assert.equal(observedContentType, "application/json");
  assert.equal(result.transaction.hash, signed.hash);
  assert.equal(result.committed, false);

  await assert.rejects(broadcastNativeTransfer(signed, { fetchImpl: async () => json({ transaction: transaction({ hash: `0x${"c".repeat(64)}`, from: identity.evmAddress, to: recipient, amount: 8, fee: 1, nonce: 4 }), truthfulStatus: "wrong" }) }), /does not match/);
});

test("tracks block confirmation and reports an observable pending result honestly", async () => {
  let calls = 0;
  const confirmed = await trackNativeTransferFinality(txHash, {
    attempts: 3,
    intervalMs: 0,
    sleep: async () => undefined,
    fetchImpl: async () => json(transaction({ hash: txHash, blockNumber: ++calls === 2 ? 42 : 0 })),
  });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.transaction.blockNumber, 42);

  const pending = await trackNativeTransferFinality(txHash, { attempts: 2, intervalMs: 0, sleep: async () => undefined, fetchImpl: async () => json(transaction({ hash: txHash })) });
  assert.equal(pending.status, "submitted");
});

function transaction(overrides: Record<string, unknown> = {}) {
  return { hash: txHash, type: "transfer", from: identity.evmAddress, to: recipient, amount: 1, fee: 1, nonce: 1, blockNumber: 0, timestamp: "2026-07-15T01:02:03Z", ...overrides };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
