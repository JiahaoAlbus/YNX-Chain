import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bindFaucetTransaction, createFaucetDurabilityEvidence, FaucetReceiptInvalid, parseFaucetDurableReceipt } from "./faucetReceipt";
import { NATIVE_DURABILITY_MODEL } from "./nativeDurability";

// Captured from actual Core0468 API/chain code under isolated Go fixtures.
// These are synthetic credits, not a public Faucet request or installed flow.
const fixture = JSON.parse(readFileSync(new URL("./testdata/faucet-durability-0468.json", import.meta.url), "utf8"));
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
for (const item of fixture.cases) {
  test(`Core0468 ${item.adapterEnabled ? "native" : "legacy"} adapter: admitted binding, mined and cold receipts agree`, () => {
    assert.equal(item.sourceCommit, "0468d65cde7306d46f424f83f4e4ffccff8568fc");
    assert.equal(item.publicBroadcast, false); assert.equal(item.isolatedSynthetic, true);
    const tx = bindFaucetTransaction(item.admittedTransaction, item.admittedTransaction.to, 100);
    assert.equal(tx.nonce, 0);
    assert.throws(() => parseFaucetDurableReceipt(item.pendingReceipt, tx), FaucetReceiptInvalid);
    for (const receipt of [item.minedReceipt, item.coldReceipt]) {
      const parsed = parseFaucetDurableReceipt(receipt, tx);
      assert.equal(parsed.from, "ynx_faucet"); assert.equal((parsed.ynxNativeTransaction as any).feeYNXT, "0");
      const evidence = createFaucetDurabilityEvidence("https://rpc.ynxweb4.com", NATIVE_DURABILITY_MODEL, receipt, tx);
      assert.equal(evidence.profile, "ynx-native-faucet-receipt-v1");
      assert.equal((evidence.capability as any).consensusFinality, false);
    }
  });
}

test("a matching hash cannot replace the original Faucet recipient, amount, fee, type or nonce", () => {
  const original = fixture.cases[0].admittedTransaction;
  for (const change of [{ to: "0x" + "ab".repeat(20) }, { amount: 101 }, { type: "transfer" }, { fee: 1 },
    { from: "0x" + "00".repeat(20) }, { nonce: -1 }, { nonce: Number.MAX_SAFE_INTEGER + 1 }, { hash: original.hash.toUpperCase() }]) {
    assert.throws(() => bindFaucetTransaction({ ...original, ...change }, original.to, 100), FaucetReceiptInvalid);
  }
  assert.throws(() => bindFaucetTransaction(original, original.to, 0), FaucetReceiptInvalid);
});

test("receipt success alone, copied transfer fields and malformed native quantities never establish Faucet durability", () => {
  const item = fixture.cases[0], tx = bindFaucetTransaction(item.admittedTransaction, item.admittedTransaction.to, 100);
  const mutate: Array<(value: any) => void> = [
    r => { delete r.ynxDurability; }, r => { r.ynxDurability = item.pendingDurability; },
    r => { r.status = "0x0"; }, r => { r.transactionHash = "0x" + "11".repeat(32); },
    r => { r.from = "0x" + "00".repeat(20); }, r => { r.to = "0x" + "12".repeat(20); },
    r => { r.blockHash = "0x" + "12".repeat(32); }, r => { r.contractAddress = r.to; },
    r => { r.ynxNativeTransaction.type = "transfer"; }, r => { r.ynxNativeTransaction.feeYNXT = "1"; },
    r => { r.ynxNativeTransaction.amountYNXT = "0100"; }, r => { r.ynxNativeTransaction.amountYNXT = 100; },
    r => { r.ynxNativeTransaction.nonce = "0x1"; }, r => { r.ynxNativeTransaction.nonce = "0x00"; },
    r => { r.ynxNativeTransaction.extra = true; }, r => { r.transactionIndex = "0x00"; },
    r => { r.ynxDurability.checkpointBlockNumber = "0x0"; },
    r => { r.ynxDurability.checkpointBlockHash = "0x" + "12".repeat(32); },
  ];
  for (const change of mutate) { const receipt = copy(item.minedReceipt); change(receipt); assert.throws(() => parseFaucetDurableReceipt(receipt, tx), FaucetReceiptInvalid); }
});

test("a later checkpoint may change while transaction, native amounts and block binding stay fixed", () => {
  const item = fixture.cases[0], tx = bindFaucetTransaction(item.admittedTransaction, item.admittedTransaction.to, 100);
  const later = copy(item.coldReceipt); later.ynxDurability.checkpointBlockNumber = "0x2"; later.ynxDurability.checkpointBlockHash = "0x" + "88".repeat(32);
  assert.equal(parseFaucetDurableReceipt(later, tx).transactionHash, tx.hash);
  later.ynxDurability.checkpointBlockHash = later.blockHash;
  assert.throws(() => parseFaucetDurableReceipt(later, tx), FaucetReceiptInvalid);
  const nonzero = { ...tx, nonce: 7 }, matching = copy(item.minedReceipt); matching.ynxNativeTransaction.nonce = "0x7";
  assert.equal((parseFaucetDurableReceipt(matching, nonzero).ynxNativeTransaction as any).nonce, "0x7");
});

test("capability or evidence origin mismatch cannot silently inherit a Faucet proof", () => {
  const item = fixture.cases[0], tx = bindFaucetTransaction(item.admittedTransaction, item.admittedTransaction.to, 100);
  for (const origin of ["http://rpc.ynxweb4.com", "https://rpc.ynxweb4.com/", "https://rpc.ynxweb4.com/other", "https://u:p@rpc.ynxweb4.com", "https://rpc.ynxweb4.com:444"]) {
    assert.throws(() => createFaucetDurabilityEvidence(origin, NATIVE_DURABILITY_MODEL, item.minedReceipt, tx), FaucetReceiptInvalid);
  }
  assert.throws(() => createFaucetDurabilityEvidence("https://rpc.ynxweb4.com", { ...NATIVE_DURABILITY_MODEL, consensusFinality: true }, item.minedReceipt, tx), FaucetReceiptInvalid);
});

test("inherited or accessor metadata cannot impersonate an acknowledged Faucet transaction", () => {
  const item = fixture.cases[0], original = item.admittedTransaction;
  assert.throws(() => bindFaucetTransaction(Object.create(original), original.to, 100), FaucetReceiptInvalid);
  const getter = { ...original }; let reads = 0;
  Object.defineProperty(getter, "hash", { enumerable: true, get() { reads++; return original.hash; } });
  assert.throws(() => bindFaucetTransaction(getter, original.to, 100), FaucetReceiptInvalid); assert.equal(reads, 0);
  const tx = bindFaucetTransaction(original, original.to, 100);
  assert.throws(() => parseFaucetDurableReceipt(Object.create(item.minedReceipt), tx), FaucetReceiptInvalid);
});
