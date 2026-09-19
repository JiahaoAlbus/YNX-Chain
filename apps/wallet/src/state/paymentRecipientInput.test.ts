import assert from "node:assert/strict";
import test from "node:test";
import { ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import { createPaymentURI, PaymentRequestError } from "../chain/paymentRequest";
import { WalletOperationCancelled, WalletOperationLifecycle } from "../security/operationLifecycle";
import { PaymentRecipientInput } from "./paymentRecipientInput";

const owner = ynxAddressFromEVM("0x1111111111111111111111111111111111111111");
const recipient = ynxAddressFromEVM("0x2222222222222222222222222222222222222222");
const replacement = ynxAddressFromEVM("0x3333333333333333333333333333333333333333");
function deferred() { let resolve!: (value: string) => void; let reject!: (error: Error) => void; const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  let now = 0;
  const operations = new WalletOperationLifecycle(() => now);
  operations.setAccount(owner);
  const unlock = operations.scope().begin({ account: owner, requireUnlocked: false }); operations.unlock(unlock); unlock.finish();
  return { operations, input: new PaymentRecipientInput(operations), expire: () => { now = 120_000; } };
}

test("clipboard is read only by an explicit attempt and can return only receiving data", async () => {
  const { input } = fixture(); let reads = 0;
  const attempt = input.begin(owner); assert.equal(reads, 0);
  const parsed = await attempt.read(async () => { reads++; return createPaymentURI(recipient); });
  attempt.assert(); assert.deepEqual(Object.keys(parsed).sort(), ["asset", "chainId", "kind", "recipient"]); assert.equal(parsed.recipient, recipient); assert.equal(reads, 1);
  await assert.rejects(() => attempt.read(async () => { reads++; return replacement; }), WalletOperationCancelled); assert.equal(reads, 1);
  attempt.finish(); assert.equal(attempt.isCurrent(), false);
});

for (const boundary of ["lock", "background", "account-switch", "expiry", "edit", "close", "review"] as const) test(`${boundary} during clipboard read prevents a late recipient result`, async () => {
  const f = fixture(), gate = deferred(), attempt = f.input.begin(owner), pending = attempt.read(() => gate.promise);
  if (boundary === "lock") f.operations.lock();
  else if (boundary === "background") f.operations.setAppState("background");
  else if (boundary === "account-switch") f.operations.setAccount(replacement);
  else if (boundary === "expiry") f.expire();
  else f.input.cancel();
  gate.resolve(createPaymentURI(recipient));
  await assert.rejects(pending, WalletOperationCancelled); assert.equal(attempt.isCurrent(), false); attempt.finish();
});

for (const result of ["success", "failure"] as const) test(`old clipboard ${result} and finally cannot own a reopened draft`, async () => {
  const f = fixture(), oldGate = deferred(), old = f.input.begin(owner), oldResult = old.read(() => oldGate.promise);
  // A second explicit paste replaces the first attempt, even before React effects.
  const current = f.input.begin(owner), newGate = deferred(), currentResult = current.read(() => newGate.promise);
  if (result === "success") oldGate.resolve(createPaymentURI(recipient)); else oldGate.reject(new Error("Synthetic clipboard failure"));
  await assert.rejects(oldResult); assert.equal(old.isCurrent(), false); assert.equal(old.ownsScope(), false); old.finish();
  assert.equal(current.ownsScope(), true); newGate.resolve(replacement); assert.equal((await currentResult).recipient, replacement); current.assert(); current.finish();
});

test("invalid receiving input and clipboard refusal allow another explicit paste", async () => {
  const f = fixture(), first = f.input.begin(owner);
  await assert.rejects(() => first.read(async () => createPaymentURI(recipient) + "&amount=9"), PaymentRequestError);
  assert.equal(first.isCurrent(), true); first.finish();
  const refused = f.input.begin(owner); await assert.rejects(() => refused.read(async () => { throw new Error("Synthetic permission refusal"); }), /permission refusal/); refused.finish();
  const fresh = f.input.begin(owner); assert.equal((await fresh.read(async () => recipient)).recipient, recipient); fresh.finish();
});

test("draft cancellation never cancels a separate transaction lease", async () => {
  const f = fixture(), transaction = f.operations.scope().begin({ account: owner });
  const attempt = f.input.begin(owner); await attempt.read(async () => recipient); f.input.cancel();
  assert.equal(attempt.isCurrent(), false); transaction.assert(); transaction.finish();
});

test("locked or wrong-account attempts cannot request the clipboard", () => {
  const f = fixture(); assert.throws(() => f.input.begin(replacement), WalletOperationCancelled);
  f.operations.lock(); assert.throws(() => f.input.begin(owner), WalletOperationCancelled);
});
