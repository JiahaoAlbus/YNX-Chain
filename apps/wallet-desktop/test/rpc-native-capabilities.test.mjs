import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transaction, Wallet, toQuantity } from "ethers";
import { CanonicalTransactionSender } from "../src/canonical-transaction-sender.mjs";
import { CanonicalAccountNetwork, NativeWalletService } from "../src/native-wallet-service.mjs";
import { DesktopKeyLifecycle } from "../src/key-lifecycle.mjs";
import { parseFeeModel } from "../src/rpc-capabilities.mjs";
import { FileTransactionIntentStore } from "../src/transaction-intent-store.mjs";
import { DURABILITY_MODEL } from "../src/transaction-durability.mjs";
import { PrivateFilePolicy } from "../src/platform-private-file.mjs";

const W = 10n ** 18n, SECRET = "1".padStart(64, "0"), wallet = new Wallet(`0x${SECRET}`), account = wallet.address.toLowerCase(), recipient = `0x${"22".repeat(20)}`;
const MODEL = Object.freeze({ version: "ynx-ethereum-native-v1", enabled: true, chainId: "0x1917", transactionType: "0x0", feeYNXT: "1", feeWei: toQuantity(W), gas: "0x61a8", gasPrice: "0x246139ca8000", decimals: 18, amountQuantumWei: toQuantity(W), scope: "whole-YNXT plain native transfers", fullEVM: false, eip1559: false, durability: DURABILITY_MODEL });
const code = expected => error => error?.data?.code === expected;
const input = changes => ({ from: account, to: recipient, value: toQuantity(2n * W), ...changes });
const gate = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve: value => resolve(value) }; };
async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), "ynx-desktop-native-rpc-")); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "transaction-intents-v1.json"), state = { model: MODEL, balance: toQuantity(4n * W), nonce: "0x0", broadcast: "ack", receipt: null, requests: [], raw: [], signs: 0, ...overrides };
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body); state.requests.push(request); state.onRequest?.(request);
    let result = { eth_chainId: "0x1917", ynx_getFeeModel: state.model, ynx_getDurabilityModel: DURABILITY_MODEL, ynx_getTransactionDurability: { version: DURABILITY_MODEL.version, scope: DURABILITY_MODEL.scope, status: "not_found", transactionHash: request.params[0] }, eth_getBalance: state.balance, eth_getTransactionCount: state.nonce, eth_gasPrice: MODEL.gasPrice, eth_estimateGas: MODEL.gas, eth_getTransactionReceipt: state.receipt }[request.method];
    let error;
    if (request.method === "ynx_getFeeModel" && state.missingModel) error = { code: -32601, message: "unknown method" };
    if (request.method === "eth_estimateGas" && state.estimateError) error = state.estimateError;
    if (request.method === "eth_sendRawTransaction") {
      state.raw.push(request.params[0]); state.hash = Transaction.from(request.params[0]).hash;
      if (state.broadcast === "timeout") throw new Error("fixture lost ACK");
      if (state.broadcast === "uncertain") error = { code: -32002, message: "transaction durability needs confirmation", data: { status: "transaction_durability_uncertain", transactionHash: state.hash } };
      else if (state.broadcast === "reject") error = { code: -32003, message: "insufficient funds for value plus gas budget" };
      else result = state.hash;
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.method === "eth_sendRawTransaction" && state.wrongId ? request.id + 1 : request.id, ...(error ? { error } : { result }) }), { status: request.method === "eth_sendRawTransaction" ? state.httpStatus ?? 200 : 200 });
  };
  const store = new FileTransactionIntentStore({ filePath }), sender = new CanonicalTransactionSender({ fetchImpl, intentStore: store }); t.after(() => sender.provider.destroy());
  const life = new DesktopKeyLifecycle({ authorizer: { available: () => true, authenticate: async () => {}, method: "test-only" } }); life.setFocused(true); life.setAccount(account); await life.unlock();
  const signer = { address: wallet.address, signTransaction: async fields => { state.signs++; return wallet.signTransaction(fields); } };
  const receipt = () => ({ transactionHash: state.hash, from: account, to: recipient, blockHash: `0x${"bb".repeat(32)}`, blockNumber: "0x12", contractAddress: null, status: "0x1", type: "0x0", gasUsed: MODEL.gas, effectiveGasPrice: MODEL.gasPrice, ynxFeeWei: MODEL.feeWei, ynxNativeTransaction: { type: "transfer", amountYNXT: "2", feeYNXT: "1", nonce: "0x1" }, ynxDurability: { version: DURABILITY_MODEL.version, scope: DURABILITY_MODEL.scope, status: "durable", transactionHash: state.hash, blockNumber: "0x12", blockHash: `0x${"bb".repeat(32)}`, checkpointBlockNumber: "0x12", checkpointBlockHash: `0x${"bb".repeat(32)}`, snapshotIntegrity: `0x${"cc".repeat(32)}` } });
  const restart = () => { const next = new CanonicalTransactionSender({ fetchImpl, intentStore: new FileTransactionIntentStore({ filePath }) }); t.after(() => next.provider.destroy()); return next; };
  return { state, sender, signer, life, store, filePath, receipt, restart, fetchImpl };
}

test("nonzero legacy/wei balances use explicit fee-model units; missing or unknown models never guess", async t => {
  const f = await fixture(t); const service = new NativeWalletService({ vault: { status: async () => ({ initialized: true, account }) }, network: f.sender.network });
  f.state.model = { ...MODEL, enabled: false }; f.state.balance = "0x64";
  const legacy = await service.balance(); assert.equal(legacy.formatted, "100"); assert.equal(legacy.wei, null); assert.equal(legacy.transferEnabled, false);
  await assert.rejects(f.sender.prepare(account, input()), code("RPC_TRANSFERS_DISABLED"));
  f.state.model = MODEL; f.state.balance = toQuantity(100n * W);
  assert.equal((await service.balance()).formatted, "100.0");
  f.state.missingModel = true; f.state.requests.length = 0;
  await assert.rejects(service.balance(), code("RPC_CAPABILITIES_UNKNOWN")); assert.equal(f.state.requests.some(r => r.method === "eth_getBalance"), false);
  for (const change of [{ version: "future-unknown" }, { decimals: 8 }, { enabled: "true" }, { fullEVM: true }, { feeWei: "0x1" }, { chainId: "0x1" }]) assert.throws(() => parseFeeModel({ ...MODEL, ...change }), code("RPC_CAPABILITIES_UNKNOWN"));
});

test("core native quote separates actual 1 YNXT fee from 1.2 maximum budget and enforces the 3-send-2 boundary", async t => {
  const f = await fixture(t, { balance: toQuantity(3n * W) });
  await assert.rejects(f.sender.prepare(account, input()), code("INSUFFICIENT_FUNDS"));
  const exact = await f.sender.prepare(account, input({ gas: MODEL.gas }));
  assert.equal(f.sender.reviewDetails(exact).actualFee, "1.0"); assert.equal(f.sender.reviewDetails(exact).maximumFee, "1.0");
  f.state.balance = toQuantity(4n * W);
  const buffered = await f.sender.prepare(account, input());
  assert.equal(buffered.gasLimit, toQuantity(30000)); assert.equal(f.sender.reviewDetails(buffered).actualFee, "1.0"); assert.equal(f.sender.reviewDetails(buffered).maximumFee, "1.2");
  assert.equal(f.state.signs, 0); assert.equal(f.state.raw.length, 0);
});

test("native fractional/calldata/deployment/type1/type2/self transactions reject before a signable review", async t => {
  const f = await fixture(t);
  for (const changes of [{ value: "0x1" }, { value: "0x0" }, { data: "0x1234" }, { to: null, data: "0x1234" }, { type: "0x1", accessList: [] }, { type: "0x2" }, { to: account }, { gasPrice: "0x1" }]) await assert.rejects(f.sender.prepare(account, input(changes)));
  f.state.estimateError = { code: -32004, message: "transfers to contracts are unsupported by the native adapter" };
  await assert.rejects(f.sender.prepare(account, input()), error => error.data?.rpcCode === -32004 && error.data.code === "RPC_TRANSACTION_UNSUPPORTED" && /contracts/.test(error.message));
  assert.equal(f.state.signs, 0); assert.equal(f.state.raw.length, 0);
});

test("capability rollout after review invalidates the snapshot before secret signing", async t => {
  const f = await fixture(t), snapshot = await f.sender.prepare(account, input());
  f.state.model = { ...MODEL, enabled: false };
  await assert.rejects(f.life.run(lease => f.sender.send(f.signer, snapshot, lease)), code("RPC_CAPABILITIES_CHANGED"));
  assert.equal(f.state.signs, 0); assert.equal((await f.store.snapshot()).length, 0);
});

test("durability uncertainty survives restart and only a matching actual-fee receipt clears the account block", async t => {
  const f = await fixture(t, { broadcast: "uncertain" }), snapshot = await f.sender.prepare(account, input());
  await assert.rejects(f.life.run(lease => f.sender.send(f.signer, snapshot, lease)), error => error.data?.code === "TRANSACTION_DURABILITY_UNCERTAIN" && error.data.rpcCode === -32002 && error.data.transactionHash === f.state.hash);
  assert.equal((await new PrivateFilePolicy().assertPrivate(f.filePath)).private, true);
  const persisted = await fs.readFile(f.filePath, "utf8"); assert.equal(JSON.parse(persisted).records[0].raw, f.state.raw[0]); assert.equal(persisted.includes(SECRET), false);
  const resumed = f.restart(); await assert.rejects(resumed.prepare(account, input()), code("TRANSACTION_RESOLUTION_REQUIRED"));
  assert.equal((await resumed.submissions.check(f.state.hash, account)).confirmed, false);
  assert.equal((await resumed.submissions.list(account))[0].canRetryExact, true);
  f.state.receipt = { ...f.receipt(), ynxFeeWei: "0x1" };
  await assert.rejects(resumed.submissions.check(f.state.hash, account), code("RPC_RECEIPT_INVALID")); assert.equal((await f.store.snapshot()).length, 1);
  f.state.receipt = f.receipt(); const confirmed = await resumed.submissions.check(f.state.hash, account);
  assert.equal(confirmed.actualFee, "1.0"); assert.equal(confirmed.confirmed, true); assert.equal((await f.store.snapshot()).length, 0);
  f.state.nonce = "0x1"; assert.equal((await f.restart().prepare(account, input())).nonce, "0x1");
});

test("explicit retry reuses identical signed bytes; a later -32003 cannot erase the first unknown outcome", async t => {
  const f = await fixture(t, { broadcast: "timeout" }), snapshot = await f.sender.prepare(account, input());
  await assert.rejects(f.life.run(lease => f.sender.send(f.signer, snapshot, lease)), code("EXTERNAL_OUTCOME_UNKNOWN"));
  const firstRaw = f.state.raw[0]; f.state.broadcast = "reject";
  await assert.rejects(f.life.run(lease => f.sender.submissions.retry(f.state.hash, account, lease)), error => error.data?.outcomeUnknown === true && error.data.rpcCode === -32003);
  assert.equal(f.state.raw[1], firstRaw); assert.equal(f.state.signs, 1); assert.equal((await f.store.snapshot())[0].attempts, 2);
  await assert.rejects(f.restart().prepare(account, input()), code("TRANSACTION_RESOLUTION_REQUIRED"));
  f.state.broadcast = "ack"; const result = await f.life.run(lease => f.sender.submissions.retry(f.state.hash, account, lease));
  assert.equal(result.retriedExactBytes, true); assert.equal(f.state.raw[2], firstRaw); assert.equal(f.state.signs, 1);
  assert.equal((await f.store.snapshot()).length, 1); // ACK alone does not clear it.
});

test("first matching -32003 is durably audited as rejected; it does not poison the account forever", async t => {
  const f = await fixture(t, { broadcast: "reject" }), snapshot = await f.sender.prepare(account, input());
  await assert.rejects(f.life.run(lease => f.sender.send(f.signer, snapshot, lease)), code("RPC_TRANSACTION_REJECTED"));
  const journal = JSON.parse(await fs.readFile(f.filePath, "utf8")); assert.equal(journal.records.length, 0); assert.equal(journal.rejections.length, 1); assert.equal(journal.rejections[0].intent.attempts, 1);
  assert.equal(journal.rejections[0].proof.rpcMethod, "eth_sendRawTransaction"); await f.restart().prepare(account, input());
});

test("journal admission failure prevents every broadcast and preserves an existing unrelated intent", async t => {
  const f = await fixture(t);
  await fs.writeFile(f.filePath, JSON.stringify({ schemaVersion: 1, rejections: [], records: [{ account: `0x${"44".repeat(20)}`, chainId: "0x1917", nonce: "0x0", hash: `0x${"33".repeat(32)}`, to: recipient, value: toQuantity(W), capabilities: parseFeeModel(MODEL), attempts: 1 }] }), { mode: 0o600 });
  const before = await f.store.snapshot();
  const broken = new FileTransactionIntentStore({ filePath: f.filePath });
  broken.filePolicy.replace = async () => { throw new Error("fixture disk failure"); };
  const sender = new CanonicalTransactionSender({ fetchImpl: f.fetchImpl, intentStore: broken }); t.after(() => sender.provider.destroy());
  const snapshot = await sender.prepare(account, input());
  await assert.rejects(f.life.run(lease => sender.send(f.signer, snapshot, lease)), code("TRANSACTION_JOURNAL_WRITE_FAILED")); assert.equal(f.state.raw.length, 0);
  assert.deepEqual(await f.store.snapshot(), before);
});

test("lock after durable intent but before dispatch sends nothing and leaves a restart-safe blocker", async t => {
  const f = await fixture(t), add = f.store.add.bind(f.store);
  f.store.add = async (...args) => { await add(...args); f.life.lock(); };
  const snapshot = await f.sender.prepare(account, input());
  await assert.rejects(f.life.run(lease => f.sender.send(f.signer, snapshot, lease)), code("WALLET_OPERATION_CANCELLED"));
  assert.equal(f.state.raw.length, 0); assert.equal((await f.store.snapshot()).length, 1);
  await assert.rejects(f.restart().prepare(account, input()), code("TRANSACTION_RESOLUTION_REQUIRED"));
});

test("corrupt journal never becomes an empty wallet and cannot admit a new signature", async t => {
  const f = await fixture(t); await fs.writeFile(f.filePath, '{"schemaVersion":1,"records":', { mode: 0o600 });
  await assert.rejects(f.sender.prepare(account, input()), code("TRANSACTION_JOURNAL_INVALID")); assert.equal(f.state.signs, 0); assert.equal(f.state.raw.length, 0);
});

test("a receipt check cannot overlap an exact retry for the same account", async t => {
  const f = await fixture(t, { broadcast: "timeout" }), snapshot = await f.sender.prepare(account, input());
  await assert.rejects(f.life.run(lease => f.sender.send(f.signer, snapshot, lease)));
  const entered = gate(), pending = gate(), original = f.sender.provider.send.bind(f.sender.provider);
  f.sender.provider.send = async (method, params) => { if (method === "eth_getTransactionReceipt") { entered.resolve(); await pending.promise; } return original(method, params); };
  const checking = f.sender.submissions.check(f.state.hash, account); await entered.promise;
  await assert.rejects(f.life.run(lease => f.sender.submissions.retry(f.state.hash, account, lease)), code("TRANSACTION_CHECK_IN_PROGRESS"));
  pending.resolve(); await checking; assert.equal(f.state.raw.length, 1);
});

for (const response of [{ httpStatus: 503 }, { wrongId: true }]) test(`untrusted -32003 response (${Object.keys(response)[0]}) remains uncertain across restart`, async t => {
  const f = await fixture(t, { broadcast: "reject", ...response }), snapshot = await f.sender.prepare(account, input());
  await assert.rejects(f.life.run(lease => f.sender.send(f.signer, snapshot, lease)), error => error.data?.outcomeUnknown === true);
  assert.equal((await f.store.snapshot()).length, 1); await assert.rejects(f.restart().prepare(account, input()), code("TRANSACTION_RESOLUTION_REQUIRED"));
  assert.equal(JSON.parse(await fs.readFile(f.filePath, "utf8")).rejections.length, 0);
});

for (const stage of ["file-sync", "publication-barrier"]) test(`${stage} failure cannot start a broadcast`, async t => {
  const f = await fixture(t), base = fs.open;
  const io = { ...fs, open: async (...args) => {
    const handle = await base(...args), target = String(args[0]);
    const fail = stage === "file-sync" && target.endsWith(".tmp");
    return new Proxy(handle, { get(object, name) { if (name === "sync" && fail) return async () => { throw new Error("fixture sync failure"); }; const value = Reflect.get(object, name); return typeof value === "function" ? value.bind(object) : value; } });
  } };
  const store = new FileTransactionIntentStore({ filePath: f.filePath, io }), sender = new CanonicalTransactionSender({ fetchImpl: f.fetchImpl, intentStore: store }); t.after(() => sender.provider.destroy());
  if (stage === "publication-barrier") { const replace = store.filePolicy.replace.bind(store.filePolicy); store.filePolicy.replace = async (...args) => { await replace(...args); throw new Error("fixture native publication ACK failure"); }; }
  const snapshot = await sender.prepare(account, input());
  await assert.rejects(f.life.run(lease => sender.send(f.signer, snapshot, lease)), code("TRANSACTION_JOURNAL_WRITE_FAILED")); assert.equal(f.state.raw.length, 0);
  if (stage === "publication-barrier") await assert.rejects(f.restart().prepare(account, input()), code("TRANSACTION_RESOLUTION_REQUIRED"));
});

test("receipt cleanup write failure retains the exact unresolved account and permits a later read-only recovery", async t => {
  const f = await fixture(t, { broadcast: "uncertain" }), snapshot = await f.sender.prepare(account, input());
  await assert.rejects(f.life.run(lease => f.sender.send(f.signer, snapshot, lease)));
  f.state.receipt = f.receipt(); const before = await f.store.snapshot();
  const replace = f.store.filePolicy.replace.bind(f.store.filePolicy);
  f.store.filePolicy.replace = async () => { throw new Error("fixture cleanup failure"); };
  await assert.rejects(f.sender.submissions.check(f.state.hash, account), code("TRANSACTION_JOURNAL_WRITE_FAILED")); assert.deepEqual(await f.store.snapshot(), before);
  await assert.rejects(f.restart().prepare(account, input()), code("TRANSACTION_RESOLUTION_REQUIRED"));
  f.store.filePolicy.replace = replace; assert.equal((await f.sender.submissions.check(f.state.hash, account)).confirmed, true); assert.equal(f.state.raw.length, 1);
});

test("fee-model change around a balance response cannot produce a mixed-generation amount", async t => {
  const f = await fixture(t); f.state.onRequest = request => { if (request.method === "eth_getBalance") f.state.model = { ...MODEL, enabled: false }; };
  await assert.rejects(f.sender.network.balanceSnapshot(account), code("RPC_CAPABILITIES_CHANGED"));
});

test("a missing durable journal adapter is not an implicit in-memory signing fallback", async t => {
  const f = await fixture(t), sender = new CanonicalTransactionSender({ fetchImpl: f.fetchImpl }); t.after(() => sender.provider.destroy());
  await assert.rejects(sender.prepare(account, input()), code("TRANSACTION_JOURNAL_UNAVAILABLE")); assert.equal(f.state.raw.length, 0);
});

test("unavailable Windows native private storage stops preparation before signing or broadcasting", async t => {
  const f = await fixture(t);
  f.store.filePolicy = new PrivateFilePolicy({ platform: "win32", windows: async () => { throw new Error("fixture unavailable native barrier"); } });
  await assert.rejects(f.sender.prepare(account, input()));
  assert.equal(f.state.signs, 0); assert.equal(f.state.raw.length, 0);
});

test("native UI prepares a 3 YNXT balance sending 2 with the exact verified 1 YNXT fixed fee", async t => {
  const f = await fixture(t, { balance: toQuantity(3n * W) });
  const native = new NativeWalletService({ vault: { status: async () => ({ initialized: true, account }) }, network: f.sender.network, sender: f.sender });
  const review = await native.prepareTransfer({ to: recipient, amount: "2" });
  assert.equal(review.transaction.gasLimit, MODEL.gas); assert.equal(review.actualFee, "1.0"); assert.equal(review.maximumFee, "1.0"); assert.equal(review.total, "3.0");
  assert.equal(f.state.signs, 0); assert.equal(f.state.raw.length, 0);
  f.state.balance = toQuantity(4n * W);
  const explicit = await f.sender.prepare(account, input({ gas: toQuantity(30000) })); assert.equal(explicit.gasLimit, toQuantity(30000)); assert.equal(f.sender.reviewDetails(explicit).maximumFee, "1.2");
});

for (const contractAddress of [undefined, `0x${"55".repeat(20)}`]) test(`plain-transfer journal rejects ${contractAddress === undefined ? "missing" : "non-null"} contractAddress`, async t => {
  const f = await fixture(t, { broadcast: "uncertain" }), snapshot = await f.sender.prepare(account, input());
  await assert.rejects(f.life.run(lease => f.sender.send(f.signer, snapshot, lease)));
  f.state.receipt = { ...f.receipt(), contractAddress };
  await assert.rejects(f.sender.submissions.check(f.state.hash, account), code("RPC_RECEIPT_INVALID"));
  await assert.rejects(f.store.resolve(f.state.hash, account, f.state.receipt), code("TRANSACTION_JOURNAL_INVALID"));
  assert.equal((await f.store.snapshot()).length, 1);
  f.state.receipt = f.receipt(); assert.equal((await f.sender.submissions.check(f.state.hash, account)).confirmed, true);
});

test("native block projection error preserves all seven known public fields and excludes arbitrary data", async () => {
  const data = { status: "native_block_projection_unsupported", blockNumber: "0x12", blockHash: `0x${"bb".repeat(32)}`, feeEquivalentGas: "0x1c9c381", projectionGasLimit: "0x1c9c380", gasSemantics: "native fixed-fee accounting; no EVM block gas scheduling", nativeBlockPath: "/blocks/18" };
  const network = new CanonicalAccountNetwork({ fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, "error"); const request = JSON.parse(options.body);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32004, message: "native block exceeds projection", data: { ...data, raw: "untrusted-extra-field" } } }));
  } });
  await assert.rejects(network.request("eth_getBlockByNumber", ["0x12", false]), error => {
    for (const [key, value] of Object.entries(data)) assert.equal(error.data[key], value);
    assert.equal("raw" in error.data, false); return error.data.rpcCode === -32004;
  });
});
