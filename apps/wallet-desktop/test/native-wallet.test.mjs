import { FixtureIntentStore } from "./fixture-intent-store.mjs";
import { fixtureEVMCapabilities } from "./fixture-evm-capabilities.mjs";
import { fixtureKeyAuthorization } from "./fixture-key-authorization.mjs";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Wallet } from "ethers";
import { DesktopWalletVault } from "../src/desktop-wallet-vault.mjs";
import { CanonicalAccountNetwork, NativeWalletService } from "../src/native-wallet-service.mjs";
import { CanonicalJsonRpcProvider, CanonicalTransactionSender } from "../src/canonical-transaction-sender.mjs";

const secret = "1".padStart(64, "0");
const secondSecret = "2".padStart(64, "0");
const recipient = new Wallet(`0x${secondSecret}`).address;
const secureStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).reverse(), decryptString: bytes => Buffer.from(bytes).reverse().toString() };
async function vaultFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ynx-native-wallet-test-"));
  const filePath = path.join(directory, "vault.json");
  return { filePath, vault: new DesktopWalletVault({ authorization: fixtureKeyAuthorization, filePath, safeStorage: secureStorage, randomSecret: () => secret }) };
}
async function serviceFixture() {
  const { vault } = await vaultFixture(); await vault.createAccount();
  const state = { sends: 0, now: 100_000, wrongChain: false };
  const network = {
    async capabilities() { return fixtureEVMCapabilities; },
    async verifyChain() { if (state.wrongChain) throw new Error("wrong chain"); },
    async balance() { return "0xde0b6b3a7640000"; },
    async estimate() { return { gasLimit: "0x6270", gasPrice: "0x3b9aca00" }; }
  };
  const service = new NativeWalletService({ vault, network, clock: () => state.now, sender: {
    async prepare(account, transaction) { state.prepared = Object.freeze({ ...transaction, from: account, data: "0x", nonce: "0x0", type: 0, ...await service.network.estimate(transaction) }); return state.prepared; },
    async send(wallet, transaction) { assert.equal(transaction, state.prepared); state.sends++; state.sent = { account: wallet.address.toLowerCase(), transaction }; return `0x${"ab".repeat(32)}`; }
  } });
  return { vault, service, state };
}

test("imported account is encrypted, deduplicated and retained after restarting", async () => {
  const { vault, filePath } = await vaultFixture();
  const imported = await vault.importAccount({ kind: "private-key", value: `0x${secret}` });
  assert.equal(imported.account, new Wallet(`0x${secret}`).address.toLowerCase());
  assert.doesNotMatch(await readFile(filePath, "utf8"), new RegExp(secret));
  await assert.rejects(vault.importAccount({ kind: "private-key", value: secret }), error => error.data.code === "DUPLICATE_ACCOUNT");
  const restarted = new DesktopWalletVault({ authorization: fixtureKeyAuthorization, filePath, safeStorage: secureStorage });
  assert.equal((await restarted.status()).account, imported.account);
  assert.equal(await restarted.withSecret(value => value === secret), true);
});

test("encrypted portable backup restores the same account and rejects wrong password", async () => {
  const { vault } = await vaultFixture(); await vault.createAccount();
  await assert.rejects(vault.encryptedBackup("short"), error => error.data.code === "BACKUP_PASSWORD_REQUIRED");
  const encrypted = await vault.encryptedBackup("test-backup-password-only");
  assert.doesNotMatch(encrypted, new RegExp(secret));
  const restored = (await vaultFixture()).vault;
  await assert.rejects(restored.importAccount({ kind: "encrypted-json", value: encrypted, password: "incorrect" }), error => error.data.code === "INVALID_IMPORT");
  assert.equal((await restored.importAccount({ kind: "encrypted-json", value: encrypted, password: "test-backup-password-only" })).account, (await vault.status()).account);
});

test("concurrent imports preserve both accounts and cleartext key stores are rejected", async () => {
  const { vault } = await vaultFixture();
  await Promise.all([vault.importAccount({ kind: "private-key", value: secret }), vault.importAccount({ kind: "private-key", value: secondSecret })]);
  assert.equal((await vault.status()).accounts.length, 2);
  const { filePath } = await vaultFixture();
  const insecure = new DesktopWalletVault({ authorization: fixtureKeyAuthorization, filePath, safeStorage: { ...secureStorage, getSelectedStorageBackend: () => "basic_text" } });
  await assert.rejects(insecure.createAccount(), error => error.data.code === "SECURE_STORAGE_UNAVAILABLE");
});

test("tampered public vault identity cannot select a different key for signing", async () => {
  const { vault, filePath } = await vaultFixture(); await vault.createAccount();
  const record = JSON.parse(await readFile(filePath, "utf8"));
  record.accounts[0].account = recipient.toLowerCase(); record.activeAccount = recipient.toLowerCase();
  await writeFile(filePath, JSON.stringify(record));
  let used = false;
  await assert.rejects(vault.withSecret(() => { used = true; }), error => error.data.code === "WALLET_IDENTITY_MISMATCH");
  assert.equal(used, false);
});

test("transfer review never sends, cancellation consumes it, and confirmation is single-use", async () => {
  const { service, state } = await serviceFixture();
  const first = await service.prepareTransfer({ to: recipient, amount: "0.1" });
  assert.equal(state.sends, 0);
  assert.equal(first.total, "0.1000252");
  assert.equal(first.transaction, state.prepared);
  assert.equal(first.transaction.nonce, "0x0");
  assert.equal(first.transaction.type, 0);
  assert.equal(Object.isFrozen(first.transaction), true);
  assert.equal((await service.transferAction(first.id, "reject")).transactionCreated, false);
  await assert.rejects(service.transferAction(first.id, "approve"));
  const next = await service.prepareTransfer({ to: recipient, amount: "0.1" });
  const result = await service.transferAction(next.id, "approve");
  assert.equal(result.status, "submitted"); assert.equal(result.confirmed, false);
  assert.equal(state.sends, 1); assert.equal(state.sent.transaction.value, "0x16345785d8a0000");
  await assert.rejects(service.transferAction(next.id, "approve"));
  assert.equal(state.sends, 1);
});

test("invalid amounts, insufficient funds, expiry, account switch and chain change never submit", async () => {
  for (const amount of ["0", "-1", "1e-3", "0.0000000000000000001", "2"]) {
    const { service, state } = await serviceFixture();
    await assert.rejects(service.prepareTransfer({ to: recipient, amount })); assert.equal(state.sends, 0);
  }
  for (const mutation of [async ({ state }) => { state.now += 120_000; }, async ({ vault }) => { await vault.importAccount({ kind: "private-key", value: secondSecret }); }, async ({ state }) => { state.wrongChain = true; }]) {
    const fixture = await serviceFixture();
    const prepared = await fixture.service.prepareTransfer({ to: recipient, amount: "0.1" });
    await mutation(fixture);
    await assert.rejects(fixture.service.transferAction(prepared.id, "approve")); assert.equal(fixture.state.sends, 0);
  }
});

test("network rejects wrong-chain balances and transaction sender checks chain before signing", async () => {
  const observed = [];
  const network = new CanonicalAccountNetwork({ fetchImpl: async (_url, request) => { observed.push(JSON.parse(request.body).method); return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" })); } });
  await assert.rejects(network.balance(recipient), error => error.data.code === "RPC_CHAIN_MISMATCH");
  assert.deepEqual(observed, ["eth_chainId"]);
  let connected = false;
  const sender = new CanonicalTransactionSender({ intentStore: new FixtureIntentStore(), network });
  await assert.rejects(sender.send({ connect() { connected = true; } }, {}));
  assert.equal(connected, false); sender.provider.destroy();
});

test("balance requests validate checksum input and send the canonical lowercase RPC address", async () => {
  const requests = [];
  const network = new CanonicalAccountNetwork({ fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body); requests.push(request);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: request.method === "eth_chainId" ? "0x1917" : "0x0" }));
  } });
  network.capabilities = async () => fixtureEVMCapabilities;
  assert.equal(await network.balance(recipient), "0x0");
  assert.deepEqual(requests[1].params, [recipient.toLowerCase(), "latest"]);
});

test("parallel ethers reads remain individual requests through the selected host network", async () => {
  const requests = [];
  const provider = new CanonicalJsonRpcProvider(async (_url, options) => {
    const request = JSON.parse(options.body); requests.push(request);
    assert.equal(Array.isArray(request), false);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x0" }));
  });
  try { assert.deepEqual(await Promise.all([provider.getBalance(recipient), provider.getTransactionCount(recipient)]), [0n, 0]); }
  finally { provider.destroy(); }
  assert.equal(requests.length, 2);
});

test("timeout errors remain understandable without leaking platform error numbers", async () => {
  const network = new CanonicalAccountNetwork({ fetchImpl: async () => { throw new DOMException("driver message", "TimeoutError"); } });
  await assert.rejects(network.verifyChain(), error => error.data.code === "RPC_TIMEOUT" && error.message === "The network check timed out. Please try again.");
});

test("insufficient balance is reported before requesting a fee or opening a review", async () => {
  const { service, state } = await serviceFixture();
  service.network.balance = async () => "0x0";
  service.network.estimate = async () => { throw new Error("fee must not be requested"); };
  await assert.rejects(service.prepareTransfer({ to: recipient, amount: "0.1" }), error => error.data.code === "INSUFFICIENT_FUNDS");
  assert.equal(state.sends, 0); assert.equal(service.pending.size, 0);
});

test("an unimplemented fee method stops review without inventing a network fee", async () => {
  const { service, state } = await serviceFixture();
  service.network = new CanonicalAccountNetwork({ fetchImpl: async (_url, options) => {
    const { method } = JSON.parse(options.body);
    const payload = method === "eth_gasPrice" ? { error: { code: -32601, message: "method unavailable" } } : { result: method === "eth_chainId" ? "0x1917" : method === "eth_getBalance" ? "0xde0b6b3a7640000" : "0x5208" };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...payload }));
  } });
  service.network.capabilities = async () => fixtureEVMCapabilities;
  await assert.rejects(service.prepareTransfer({ to: recipient, amount: "0.1" }), error => error.data.code === "RPC_FEE_UNAVAILABLE");
  assert.equal(state.sends, 0); assert.equal(service.pending.size, 0);
});
