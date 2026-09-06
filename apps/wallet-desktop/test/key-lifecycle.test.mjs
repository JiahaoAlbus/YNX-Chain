import { FixtureIntentStore } from "./fixture-intent-store.mjs";
import { fixtureEVMCapabilities } from "./fixture-evm-capabilities.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import { DesktopKeyLifecycle, nativeDesktopAuthorizer } from "../src/key-lifecycle.mjs";
import { DesktopWalletVault } from "../src/desktop-wallet-vault.mjs";
import { DesktopWalletAuthority, MemoryPermissionStore } from "../src/desktop-wallet-authority.mjs";
import { CanonicalTransactionSender } from "../src/canonical-transaction-sender.mjs";
import { ApprovalReviewQueue } from "../src/approval-review-queue.mjs";

const SECRET = "1".padStart(64, "0"), ORIGIN = "https://desktop-lifecycle.invalid";
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function policy(authenticate = async () => {}) {
  const lifecycle = new DesktopKeyLifecycle({ authorizer: { available: () => true, authenticate, method: "explicit-test-fixture" } });
  lifecycle.setFocused(true);
  return lifecycle;
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "ynx-desktop-key-lifecycle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const life = policy(), calls = { decrypt: 0, fallback: 0 }, filePath = join(directory, "fixture-vault.json");
  const storage = { isEncryptionAvailable: () => true, encryptStringAsync: async text => Buffer.from(text).reverse(), decryptStringAsync: async bytes => { calls.decrypt++; return { result: Buffer.from(bytes).reverse().toString() }; }, decryptString: () => { calls.fallback++; return SECRET; } };
  const vault = new DesktopWalletVault({ filePath, safeStorage: storage, randomSecret: () => SECRET, authorization: life });
  await life.unlock(); const account = await life.run(() => vault.createAccount()); life.setAccount(account.account); await life.unlock();
  return { life, vault, storage, account, calls, filePath };
}
const cancelled = error => ["WALLET_OPERATION_CANCELLED", "WALLET_LOCKED"].includes(error?.data?.code);

test("public inventory stays readable while locked, while direct key/create access has no authorization fallback", async t => {
  const f = await fixture(t); f.life.lock();
  assert.equal((await f.vault.status()).account, f.account.account);
  assert.equal(f.calls.decrypt, 0);
  await assert.rejects(f.vault.withSecret(() => assert.fail("key reached caller")), cancelled);
  await assert.rejects(f.vault.createAccount(), cancelled);
  const withoutGate = new DesktopWalletVault({ filePath: f.filePath, safeStorage: f.storage });
  await assert.rejects(withoutGate.withSecret(() => {}), cancelled);
  assert.equal(f.calls.decrypt, 0);
});

test("Windows, Linux and macOS without actual Touch ID support never unlock through the button contract", async () => {
  let prompts = 0;
  for (const platform of ["win32", "linux", "darwin"]) {
    const authorizer = nativeDesktopAuthorizer({ platform, systemPreferences: { canPromptTouchID: () => platform !== "darwin", promptTouchID: async () => { prompts++; } } });
    const life = new DesktopKeyLifecycle({ authorizer }); life.setFocused(true);
    await assert.rejects(life.unlock(), error => error.data.code === "SECURE_UNLOCK_UNAVAILABLE");
    assert.equal(life.status().locked, true); assert.equal(life.status().hardwareBound, false);
  }
  assert.equal(prompts, 0);
});

test("native Touch ID is actually awaited; cancelled or stale confirmation cannot unlock", async () => {
  for (const event of ["screen-lock", "account-change", "leave-app", "user-cancel"]) {
    const prompt = deferred(), life = policy(() => prompt.promise);
    const unlocking = life.unlock(); assert.equal(life.status().locked, true);
    if (event === "screen-lock") life.lock();
    if (event === "account-change") life.setAccount("different-public-account");
    if (event === "leave-app") life.setFocused(false);
    if (event === "user-cancel") prompt.reject(new Error("cancelled")); else prompt.resolve();
    await assert.rejects(unlocking); assert.equal(life.status().locked, true);
  }
  const prompt = deferred(), life = policy(() => prompt.promise), pending = life.unlock();
  life.setFocused(false); life.setFocused(true); prompt.resolve(); await pending;
  assert.equal(life.status().locked, false);
});

for (const event of ["manual-lock", "blur", "account-change", "cancel"]) test(`${event} during native decrypt prevents use and outward signature`, async t => {
  const f = await fixture(t), entered = deferred(), decrypt = deferred(); let used = 0;
  f.storage.decryptStringAsync = async () => { entered.resolve(); return decrypt.promise; };
  const pending = f.life.run(() => f.vault.withSecret(() => { used++; return "signature"; }));
  await entered.promise;
  if (event === "blur") f.life.setFocused(false); else if (event === "account-change") f.life.setAccount("other"); else if (event === "cancel") f.life.cancelOperations(); else f.life.lock();
  decrypt.resolve({ result: SECRET }); await assert.rejects(pending, cancelled);
  assert.equal(used, 0); assert.equal(f.calls.fallback, 0);
  assert.equal((await f.vault.status()).account, f.account.account);
});

test("a late async signer result is discarded after lock and cannot be returned by a reused lease", async t => {
  const f = await fixture(t), entered = deferred(), signer = deferred(); let delivered = false;
  const pending = f.life.run(() => f.vault.withSecret(async () => { entered.resolve(); return signer.promise; })).then(() => { delivered = true; });
  await entered.promise; f.life.lock(); signer.resolve("fixture-signature");
  await assert.rejects(pending, cancelled); assert.equal(delivered, false);
  await f.life.unlock(); await assert.rejects(f.vault.withSecret(() => {}), cancelled);
});

test("native async decrypt failure never retries a potentially less restrictive sync decrypt", async t => {
  const f = await fixture(t), before = await readFile(f.filePath);
  f.storage.decryptStringAsync = async () => { throw new Error("OS decrypt denied"); };
  await assert.rejects(f.life.run(() => f.vault.withSecret(() => {})), /OS decrypt denied/);
  assert.equal(f.calls.fallback, 0); assert.deepEqual(await readFile(f.filePath), before);
});

test("cancellation during OS encryption preserves the existing vault and existing account", async t => {
  const f = await fixture(t), before = await readFile(f.filePath), entered = deferred(), encrypt = deferred();
  f.storage.encryptStringAsync = async () => { entered.resolve(); return encrypt.promise; };
  const pending = f.life.run(() => f.vault.importAccount({ kind: "private-key", value: "2".padStart(64, "0") }));
  await entered.promise; f.life.lock(); encrypt.resolve(Buffer.from("discarded-fixture-ciphertext"));
  await assert.rejects(pending, cancelled); assert.deepEqual(await readFile(f.filePath), before);
});

test("permission grant interrupted by lock is not kept as a newly approved origin", async t => {
  const f = await fixture(t), permissions = new MemoryPermissionStore(), entered = deferred(), grant = deferred();
  const original = permissions.grantAccount.bind(permissions);
  permissions.grantAccount = async (...args) => { await original(...args); entered.resolve(); await grant.promise; };
  const authority = new DesktopWalletAuthority({ vault: f.vault, permissions });
  const review = await f.life.run(() => authority.request({ origin: ORIGIN, method: "eth_requestAccounts" }));
  const pending = f.life.run(() => authority.approve(review.request.id));
  await entered.promise; f.life.lock(); grant.resolve();
  await assert.rejects(pending, cancelled); assert.equal(await permissions.hasAccount(ORIGIN, f.account.account), false);
});

for (const point of ["before-sign", "before-broadcast"]) test(`transaction ${point} cancellation uses the same key lease and sends nothing`, async () => {
  const life = policy(); await life.unlock();
  const wallet = new Wallet(`0x${SECRET}`), entered = deferred(), gate = deferred(), calls = [];
  const sender = new CanonicalTransactionSender({ intentStore: new FixtureIntentStore(), network: { verifyChain: async () => {}, capabilities: async () => fixtureEVMCapabilities } });
  sender.provider.send = async method => { calls.push(method); return { eth_getTransactionCount: "0x0", eth_gasPrice: "0x1", eth_estimateGas: "0x5208", eth_getBalance: "0xffffffffffffffff" }[method]; };
  const transaction = await sender.prepare(wallet.address.toLowerCase(), { from: wallet.address.toLowerCase(), to: `0x${"22".repeat(20)}`, value: "0x1" });
  let signs = 0;
  if (point === "before-sign") sender.network.verifyChain = async () => { entered.resolve(); await gate.promise; };
  const signer = { address: wallet.address, signTransaction: async fields => { signs++; const signature = await wallet.signTransaction(fields); entered.resolve(); if (point === "before-broadcast") await gate.promise; return signature; } };
  const pending = life.run(lease => sender.send(signer, transaction, lease));
  await entered.promise; life.lock(); gate.resolve(); await assert.rejects(pending, cancelled);
  assert.equal(signs, point === "before-sign" ? 0 : 1); assert.equal(calls.includes("eth_sendRawTransaction"), false);
});

test("clearing an in-flight visible approval queue prevents a late finish from reopening old review", () => {
  const queue = new ApprovalReviewQueue(); queue.enqueue("provider", { id: "old" });
  const old = queue.begin(queue.current.key); queue.clear(); queue.enqueue("provider", { id: "new" });
  assert.equal(queue.finish(old.key), false); assert.equal(queue.current.review.id, "new");
});

test("final delivery may complete after its own blur, but no further key step or reply may start", async () => {
  const life = policy(); await life.unlock(); let deliveries = 0;
  const result = await life.run(lease => lease.step(async () => {
    const receipt = await lease.deliver(async () => { deliveries++; life.setFocused(false); return "system-launch-confirmed"; });
    await assert.rejects(lease.step(async () => assert.fail("late key work")), cancelled);
    await assert.rejects(lease.deliver(async () => { deliveries++; }), cancelled);
    return receipt;
  }));
  assert.equal(result, "system-launch-confirmed"); assert.equal(deliveries, 1); assert.equal(life.status().locked, true);
});

test("a signer finishing after cancellation cannot initiate final delivery", async () => {
  const life = policy(); await life.unlock(); const signer = deferred(), entered = deferred(); let deliveries = 0;
  const pending = life.run(async lease => { entered.resolve(); const signature = await lease.step(() => signer.promise); return lease.deliver(() => { deliveries++; return signature; }); });
  await entered.promise; life.lock(); signer.resolve("late-fixture-signature");
  await assert.rejects(pending, cancelled); assert.equal(deliveries, 0);
});

test("broadcast ACK after lock retains the real hash and blocks any subsequent DApp delivery", async () => {
  const life = policy(); await life.unlock(); const wallet = new Wallet(`0x${SECRET}`), calls = [];
  const sender = new CanonicalTransactionSender({ intentStore: new FixtureIntentStore(), network: { verifyChain: async () => {}, capabilities: async () => fixtureEVMCapabilities } });
  sender.provider.send = async (method, params) => {
    calls.push(method);
    if (method === "eth_sendRawTransaction") { life.lock(); return (await import("ethers")).Transaction.from(params[0]).hash; }
    return { eth_getTransactionCount: "0x0", eth_gasPrice: "0x1", eth_estimateGas: "0x5208", eth_getBalance: "0xffffffffffffffff" }[method];
  };
  const transaction = await sender.prepare(wallet.address.toLowerCase(), { from: wallet.address.toLowerCase(), to: `0x${"22".repeat(20)}`, value: "0x1" });
  const result = await life.run(lease => lease.step(async () => {
    const hash = await sender.send(wallet, transaction, lease);
    await assert.rejects(lease.deliver(() => assert.fail("late DApp reply")), cancelled);
    await assert.rejects(lease.step(() => assert.fail("another key step")), cancelled);
    return { hash, responseDelivered: false };
  }));
  assert.match(result.hash, /^0x[0-9a-f]{64}$/); assert.equal(result.responseDelivered, false);
  assert.equal(calls.filter(method => method === "eth_sendRawTransaction").length, 1);
});

test("broadcast lost ACK is explicitly uncertain and retains the independently computable transaction hash", async () => {
  const life = policy(); await life.unlock(); const wallet = new Wallet(`0x${SECRET}`);
  const sender = new CanonicalTransactionSender({ intentStore: new FixtureIntentStore(), network: { verifyChain: async () => {}, capabilities: async () => fixtureEVMCapabilities } });
  sender.provider.send = async method => {
    if (method === "eth_sendRawTransaction") throw new Error("fixture lost ACK");
    return { eth_getTransactionCount: "0x0", eth_gasPrice: "0x1", eth_estimateGas: "0x5208", eth_getBalance: "0xffffffffffffffff" }[method];
  };
  const transaction = await sender.prepare(wallet.address.toLowerCase(), { from: wallet.address.toLowerCase(), to: `0x${"22".repeat(20)}`, value: "0x1" });
  await assert.rejects(life.run(lease => sender.send(wallet, transaction, lease)), error => error.data?.code === "EXTERNAL_OUTCOME_UNKNOWN" && error.data.outcomeUnknown === true && /^0x[0-9a-f]{64}$/.test(error.data.transactionHash));
});

test("pre-existing origin permission is preserved if a repeated grant is cancelled", async t => {
  const f = await fixture(t), permissions = new MemoryPermissionStore(), entered = deferred(), gate = deferred();
  await permissions.grantAccount(ORIGIN, f.account.account, new Date().toISOString());
  const grant = permissions.grantAccount.bind(permissions);
  permissions.grantAccount = async (...args) => { await grant(...args); entered.resolve(); await gate.promise; };
  const authority = new DesktopWalletAuthority({ vault: f.vault, permissions });
  const pending = f.life.run(() => authority.approveOrigin(ORIGIN, f.account.account));
  await entered.promise; f.life.lock(); gate.resolve(); await assert.rejects(pending, cancelled);
  assert.equal(await permissions.hasAccount(ORIGIN, f.account.account), true);
});

test("lease deadline rejects the exact expiry boundary before any outward effect", async () => {
  let now = 1000;
  const life = new DesktopKeyLifecycle({ now: () => now, ttlMs: 100, authorizer: { available: () => true, authenticate: async () => {}, method: "test-only" } });
  life.setFocused(true); await life.unlock();
  await assert.rejects(life.run(async lease => { now = 1100; return lease.deliver(() => assert.fail("expired delivery")); }), cancelled);
});

test("immediate public-account reply stays in the original generation even without secret decryption", async () => {
  const life = policy(); await life.unlock(); const accountRead = deferred(), started = deferred(); let delivered = 0;
  const pending = life.run(async lease => {
    started.resolve(); const response = await accountRead.promise;
    lease.assert(); return lease.deliver(() => { delivered++; return response; });
  });
  await started.promise; life.cancelOperations();
  accountRead.resolve({ status: "success", result: ["fixture-public-account"] });
  await assert.rejects(pending, cancelled); assert.equal(delivered, 0);
});
