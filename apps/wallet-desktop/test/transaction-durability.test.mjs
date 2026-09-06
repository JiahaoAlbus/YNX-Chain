import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet, Transaction, toQuantity } from "ethers";
import { parseDurabilityModel, parseDurabilityProof, parseNativeTransaction, validateDurableReceipt, uint64 } from "../src/transaction-durability.mjs";
import { parseFeeModel } from "../src/rpc-capabilities.mjs";
import { FileTransactionIntentStore } from "../src/transaction-intent-store.mjs";
import { CanonicalTransactionSender } from "../src/canonical-transaction-sender.mjs";
import { CanonicalAccountNetwork } from "../src/native-wallet-service.mjs";
import { DesktopKeyLifecycle } from "../src/key-lifecycle.mjs";
import { rpcResponseError } from "../src/rpc-errors.mjs";
import { CANONICAL_RPC_URL } from "../src/rpc.mjs";

// Literal Core 0468d65cde7306d46f424f83f4e4ffccff8568fc fixtures, never a live RPC.
const load = name => fs.readFile(new URL(`./fixtures/transaction-durability/${name}.json`, import.meta.url), "utf8").then(JSON.parse);
const nativeFixture = await load("native-json-contract-fixture"), ethereum = await load("ethereum-block-marker");
const model = Object.freeze({ version: "ynx-ethereum-native-v1", enabled: true, chainId: "0x1917", transactionType: "0x0", feeYNXT: "1", feeWei: "0xde0b6b3a7640000", gas: "0x61a8", gasPrice: "0x246139ca8000", decimals: 18, amountQuantumWei: "0xde0b6b3a7640000", scope: "whole-YNXT plain native transfers", fullEVM: false, eip1559: false, durability: nativeFixture.capability });
const SECRET = "1".padStart(64, "0"), wallet = new Wallet(`0x${SECRET}`), account = wallet.address.toLowerCase(), to = `0x${"22".repeat(20)}`, W = 10n ** 18n;
const code = expected => error => error?.data?.code === expected;
function coreIntent(receipt) { return { account: receipt.from, to: receipt.to, nonce: "0x0", value: toQuantity(2n * W), hash: receipt.transactionHash, capabilities: parseFeeModel(model) }; }
function receiptFor(hash) { const receipt = structuredClone(ethereum.recoveredReceipt); Object.assign(receipt, { transactionHash: hash, from: account, to }); receipt.ynxDurability.transactionHash = hash; return receipt; }
async function fixture(t, changes = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), "ynx-desktop-durability-fixture-")); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "transaction-intents-v1.json"), state = { model, durabilityModel: nativeFixture.capability, receipt: null, nonce: "0x0", mode: "timeout", raw: [], signs: 0, requests: [], ...changes };
  const fetchImpl = async (url, options) => {
    assert.equal(url, CANONICAL_RPC_URL); const request = JSON.parse(options.body); state.requests.push(request.method);
    let result = { eth_chainId: state.chainId ?? "0x1917", ynx_getFeeModel: state.model, ynx_getDurabilityModel: state.durabilityModel, eth_getTransactionCount: state.nonce, eth_getBalance: toQuantity(10n * W), eth_gasPrice: model.gasPrice, eth_estimateGas: model.gas, eth_getTransactionReceipt: state.receipt, ynx_getTransactionDurability: state.proof ?? { version: nativeFixture.capability.version, scope: "local-snapshot", status: "not_found", transactionHash: request.params[0] } }[request.method], error;
    if (request.method === "ynx_getDurabilityModel" && state.missingDurability) error = { code: -32601, message: "fixture unknown method" };
    if (request.method === "eth_getTransactionReceipt" && state.receiptError) error = state.receiptError;
    if (request.method === "eth_sendRawTransaction") {
      state.raw.push(request.params[0]); state.hash = Transaction.from(request.params[0]).hash;
      const journal = JSON.parse(await fs.readFile(filePath, "utf8"));
      assert.equal(journal.schemaVersion, 2); assert.equal(journal.records[0].raw, request.params[0]); assert.equal(journal.records[0].hash, state.hash); // Actual on-disk marker before every POST.
      await state.onBroadcast?.(request);
      if (state.mode === "timeout") throw new Error("fixture lost ACK");
      if (state.mode === "reject") error = { code: -32003, message: "fixture definite rejection" }; else result = state.hash;
    }
    await state.onResponse?.(request);
    const envelope = { jsonrpc: "2.0", id: request.id, ...(error ? { error } : { result }) };
    return new Response(JSON.stringify(state.envelope ? state.envelope(envelope, request) : envelope));
  };
  const store = new FileTransactionIntentStore({ filePath }), sender = new CanonicalTransactionSender({ fetchImpl, intentStore: store }); t.after(() => sender.provider.destroy());
  const life = new DesktopKeyLifecycle({ authorizer: { available: () => true, authenticate: async () => {}, method: "fixture" } }); life.setFocused(true); life.setAccount(account); await life.unlock(); t.after(() => life.lock());
  const signer = { address: wallet.address, signTransaction: async fields => { state.signs++; return wallet.signTransaction(fields); } };
  const prepare = () => sender.prepare(account, { from: account, to, value: toQuantity(2n * W), gas: model.gas });
  const send = async () => { const transaction = await prepare(); return life.run(guard => sender.send(signer, transaction, guard)); };
  const restart = () => { const store = new FileTransactionIntentStore({ filePath }), sender = new CanonicalTransactionSender({ fetchImpl, intentStore: store }); t.after(() => sender.provider.destroy()); return { store, sender }; };
  return { state, filePath, store, sender, signer, life, send, prepare, restart };
}

for (const name of ["ethereum-admission-marker", "ethereum-block-before-rename", "ethereum-block-marker"]) test(`literal Core ${name}: only recovered checkpoint-bound receipt is accepted`, async () => {
  const fixture = await load(name), receipt = fixture.recoveredReceipt;
  assert.equal(validateDurableReceipt(coreIntent(receipt), receipt, parseFeeModel(model)).ynxDurability.status, "durable");
  for (const key of ["uncertainReceipt", "uncertainReplay"]) {
    const error = rpcResponseError(fixture[key].error);
    assert.equal(error.data.ynxDurability.status, "uncertain");
    assert.equal(parseDurabilityProof(error.data.ynxDurability, receipt.transactionHash).transactionHash, receipt.transactionHash);
    assert.throws(() => validateDurableReceipt(coreIntent(receipt), { ...receipt, ynxDurability: error.data.ynxDurability }, parseFeeModel(model)));
  }
});

test("literal native JSON proof is parsed, but disabled-adapter 21000-gas receipt is not an Ethereum intent fee proof", () => {
  assert.deepEqual(parseDurabilityModel(nativeFixture.capability), nativeFixture.capability);
  const original = nativeFixture.durableReceipt.ynxDurability, cold = nativeFixture.coldProof;
  assert.equal(parseDurabilityProof(original, nativeFixture.nativeJSONTransactionHash).status, "durable");
  assert.equal(parseDurabilityProof(cold, nativeFixture.nativeJSONTransactionHash).status, "durable");
  assert.notEqual(original.snapshotIntegrity, cold.snapshotIntegrity); // Cold re-save legitimately changes the digest.
  assert.throws(() => validateDurableReceipt(coreIntent(nativeFixture.durableReceipt), nativeFixture.durableReceipt, parseFeeModel(model)));
});

test("capability object requires every exact inner field and boolean type", () => {
  for (const key of Object.keys(nativeFixture.capability)) { const missing = { ...nativeFixture.capability }; delete missing[key]; assert.throws(() => parseDurabilityModel(missing), code("RPC_DURABILITY_UNSUPPORTED")); }
  for (const changes of [{ extra: true }, { consensusFinality: "false" }, { version: "future" }, { scope: "BFT-finality" }, { pendingStatus: "durable" }, { nativeTransactionField: null }]) assert.throws(() => parseDurabilityModel({ ...nativeFixture.capability, ...changes }));
});

test("proof parser rejects noncanonical/wrong-type/overflow heights, missing fields and conflicting checkpoint identities", () => {
  const proof = ethereum.recoveredReceipt.ynxDurability;
  assert.equal(uint64("0xffffffffffffffff"), (1n << 64n) - 1n);
  for (const bad of [0, 2, "2", "0x02", "0xA", "0X2", "0x10000000000000000", null, false, []]) assert.throws(() => parseDurabilityProof({ ...proof, blockNumber: bad }, proof.transactionHash));
  for (const key of Object.keys(proof)) { const missing = { ...proof }; delete missing[key]; assert.throws(() => parseDurabilityProof(missing, proof.transactionHash)); }
  for (const changes of [{ extra: 1 }, { checkpointBlockNumber: "0x1" }, { checkpointBlockHash: `0x${"11".repeat(32)}` }, { checkpointBlockNumber: "0x3" }, { transactionHash: `0x${"11".repeat(32)}` }, { snapshotIntegrity: proof.snapshotIntegrity.toUpperCase() }]) assert.throws(() => parseDurabilityProof({ ...proof, ...changes }, proof.transactionHash));
  const advanced = { ...proof, checkpointBlockNumber: "0x3", checkpointBlockHash: `0x${"44".repeat(32)}` };
  assert.equal(parseDurabilityProof(advanced, proof.transactionHash).checkpointBlockNumber, "0x3");
});

test("pending, memory-only, uncertain and not-found have exact distinct nonterminal shapes", () => {
  const durable = ethereum.recoveredReceipt.ynxDurability, base = { version: durable.version, scope: durable.scope, transactionHash: durable.transactionHash };
  for (const status of ["not_found", "uncertain", "memory_only"]) {
    const value = { ...base, status }; assert.equal(parseDurabilityProof(value, base.transactionHash).status, status);
    assert.throws(() => parseDurabilityProof({ ...value, checkpointBlockNumber: "0x2" }, base.transactionHash));
    assert.throws(() => parseDurabilityProof({ ...value, blockNumber: "0x2" }, base.transactionHash));
  }
  const pending = { ...base, status: "pending_durable", checkpointBlockNumber: durable.checkpointBlockNumber, checkpointBlockHash: durable.checkpointBlockHash, snapshotIntegrity: durable.snapshotIntegrity };
  assert.equal(parseDurabilityProof(pending, base.transactionHash).status, "pending_durable");
  assert.throws(() => parseDurabilityProof({ ...pending, blockNumber: durable.blockNumber, blockHash: durable.blockHash }, base.transactionHash));
});

test("native transfer binding compares exact signed amount, fee and wire nonce plus one", () => {
  const receipt = ethereum.recoveredReceipt, intent = coreIntent(receipt);
  for (const changes of [{ amountYNXT: "3" }, { amountYNXT: 2 }, { amountYNXT: "02" }, { amountYNXT: "-0" }, { amountYNXT: "9223372036854775808" }, { feeYNXT: "2" }, { nonce: "0x0" }, { nonce: "0x01" }, { type: "sponsor" }, { extra: "untrusted" }]) assert.throws(() => validateDurableReceipt(intent, { ...receipt, ynxNativeTransaction: { ...receipt.ynxNativeTransaction, ...changes } }, parseFeeModel(model)));
  for (const key of Object.keys(receipt.ynxNativeTransaction)) { const value = { ...receipt.ynxNativeTransaction }; delete value[key]; assert.throws(() => parseNativeTransaction(value)); }
  for (const changes of [{ from: to }, { to: account }, { transactionHash: `0x${"aa".repeat(32)}` }, { blockNumber: "0x3" }, { blockHash: `0x${"bb".repeat(32)}` }, { ynxFeeWei: "0x1" }, { gasUsed: "0x5208" }, { effectiveGasPrice: "0x1" }, { status: 1 }, { type: 0 }]) assert.throws(() => validateDurableReceipt(intent, { ...receipt, ...changes }, parseFeeModel(model)));
  assert.equal(validateDurableReceipt(intent, { ...receipt, futureOuterReceiptField: "ignored" }, parseFeeModel(model)).transactionHash, intent.hash);
});

for (const change of ["old-fee-model", "missing-method", "malformed-method", "malformed-nested"]) test(`${change} cannot reach signing even when old fee units are known`, async t => {
  const f = await fixture(t);
  if (change === "old-fee-model") { f.state.model = { ...model }; delete f.state.model.durability; }
  if (change === "missing-method") f.state.missingDurability = true;
  if (change === "malformed-method") f.state.durabilityModel = { ...nativeFixture.capability, extra: true };
  if (change === "malformed-nested") f.state.model = { ...model, durability: { ...nativeFixture.capability, consensusFinality: true } };
  await assert.rejects(f.send(), code("RPC_DURABILITY_UNSUPPORTED")); assert.equal(f.state.signs, 0); assert.equal(f.state.raw.length, 0);
});

test("restart resumes exact persisted raw without a key or new nonce; later rejection cannot erase an unknown attempt", async t => {
  const f = await fixture(t); await assert.rejects(f.send()); const original = f.state.raw[0], resumed = f.restart();
  assert.equal((await fs.stat(f.filePath)).mode & 0o777, 0o600); assert.equal((await resumed.sender.submissions.list(account))[0].canRetryExact, true);
  f.state.nonce = "0xff"; f.state.mode = "reject";
  await assert.rejects(f.life.run(guard => resumed.sender.submissions.retry(f.state.hash, account, guard)), error => error.data.outcomeUnknown === true && error.data.rpcCode === -32003);
  assert.equal(f.state.raw[1], original); assert.equal(f.state.signs, 1); assert.equal((await resumed.store.snapshot())[0].attempts, 2);
  f.state.mode = "ack"; await f.life.run(guard => resumed.sender.submissions.retry(f.state.hash, account, guard));
  assert.equal(f.state.raw[2], original); assert.equal((await resumed.store.snapshot()).length, 1);
  const publicRow = (await resumed.sender.submissions.list(account))[0]; assert.equal("raw" in publicRow, false);
});

test("old complete receipt and pending durable proof never clear an unresolved record, while exact durable mined evidence is retained", async t => {
  const f = await fixture(t); await assert.rejects(f.send()); const before = await f.store.snapshot(), receipt = receiptFor(f.state.hash);
  const old = { ...receipt }; delete old.ynxDurability; delete old.ynxNativeTransaction; f.state.receipt = old;
  await assert.rejects(f.restart().sender.submissions.check(f.state.hash, account), code("RPC_RECEIPT_INVALID")); assert.deepEqual(await f.store.snapshot(), before);
  const proof = { ...receipt.ynxDurability, status: "pending_durable" }; delete proof.blockNumber; delete proof.blockHash;
  f.state.receipt = null; f.state.proof = proof;
  const pending = await f.restart().sender.submissions.check(f.state.hash, account); assert.equal(pending.confirmed, false); assert.equal(pending.status, "pending_durable"); assert.equal((await f.store.snapshot()).length, 1);
  f.state.receipt = receipt; const done = await f.restart().sender.submissions.check(f.state.hash, account);
  assert.equal(done.confirmed, true); assert.equal(done.confirmationScope, "local-snapshot"); assert.equal(done.consensusFinality, false);
  const saved = JSON.parse(await fs.readFile(f.filePath, "utf8")); assert.equal(saved.records.length, 0); assert.equal(saved.resolutions[0].receipt.ynxDurability.transactionHash, f.state.hash); assert.equal(saved.resolutions[0].intent.raw, f.state.raw[0]);
  assert.equal((await f.restart().store.snapshot()).length, 0);
});

test("schema1 pending entries migrate conservatively without inventing raw bytes, then resolve only with the new proof", async t => {
  const f = await fixture(t); await assert.rejects(f.send()); const original = (await f.store.snapshot())[0], { raw, origin, ...legacy } = original;
  const oldModel = { ...model }; delete oldModel.durability; legacy.capabilities = parseFeeModel(oldModel);
  await fs.writeFile(f.filePath, JSON.stringify({ schemaVersion: 1, records: [legacy], rejections: [] }), { mode: 0o600 });
  const resumed = f.restart(); assert.equal((await resumed.sender.submissions.list(account))[0].canRetryExact, false);
  await assert.rejects(f.life.run(guard => resumed.sender.submissions.retry(f.state.hash, account, guard)), code("EXACT_RETRY_UNAVAILABLE"));
  await assert.rejects(resumed.sender.prepare(account, { from: account, to, value: toQuantity(2n * W), gas: model.gas }), code("TRANSACTION_RESOLUTION_REQUIRED"));
  assert.equal(f.state.signs, 1); f.state.receipt = receiptFor(f.state.hash);
  assert.equal((await resumed.sender.submissions.check(f.state.hash, account)).confirmed, true);
  const saved = JSON.parse(await fs.readFile(f.filePath, "utf8")); assert.equal(saved.schemaVersion, 2); assert.equal(saved.resolutions[0].intent.raw, null); assert.equal(saved.resolutions[0].receipt.ynxDurability.status, "durable");
});

test("every reload verifies historical receipt and signed intent again; malformed or mismatched resolved evidence blocks new signatures", async t => {
  const f = await fixture(t); await assert.rejects(f.send()); f.state.receipt = receiptFor(f.state.hash); await f.sender.submissions.check(f.state.hash, account);
  const valid = JSON.parse(await fs.readFile(f.filePath, "utf8"));
  const mutations = [
    entry => { delete entry.receipt.ynxDurability; }, entry => { entry.receipt.ynxDurability.extra = true; }, entry => { entry.receipt.ynxDurability.status = "pending_durable"; },
    entry => { entry.receipt.ynxDurability.blockNumber = 2; }, entry => { entry.receipt.ynxDurability.checkpointBlockNumber = "0x1"; },
    entry => { entry.receipt.ynxNativeTransaction.amountYNXT = "3"; }, entry => { entry.receipt.ynxNativeTransaction.nonce = "0x2"; },
    entry => { entry.intent.value = toQuantity(3n * W); }, entry => { entry.intent.origin = "https://unrelated.invalid/evm"; },
    entry => { entry.intent.raw = entry.intent.raw.slice(0, -2) + (entry.intent.raw.endsWith('00') ? '01' : '00'); },
    entry => { entry.capabilities.durability.consensusFinality = true; }, entry => { delete entry.capabilities.durability; },
  ];
  for (const mutate of mutations) {
    const tampered = structuredClone(valid); mutate(tampered.resolutions[0]); await fs.writeFile(f.filePath, JSON.stringify(tampered), { mode: 0o600 });
    const resumed = f.restart(); await assert.rejects(resumed.store.snapshot(), code("TRANSACTION_JOURNAL_INVALID"));
    await assert.rejects(resumed.sender.prepare(account, { from: account, to, value: toQuantity(2n * W), gas: model.gas }), code("TRANSACTION_JOURNAL_INVALID"));
  }
  assert.equal(f.state.signs, 1); assert.equal(f.state.raw.length, 1);
  await fs.writeFile(f.filePath, JSON.stringify(valid), { mode: 0o600 }); assert.equal((await f.restart().store.snapshot()).length, 0);
});

test("altered pending raw, origin, nonce or unknown V1 terminal fields never become a restart retry", async t => {
  const f = await fixture(t); await assert.rejects(f.send()); const valid = JSON.parse(await fs.readFile(f.filePath, "utf8"));
  for (const mutate of [r => { r.nonce = "0x1"; }, r => { r.origin = "https://wrong.invalid"; }, r => { r.raw = `${r.raw.slice(0, -2)}00`; }, r => { r.hash = `0x${"ff".repeat(32)}`; }, r => { r.capabilities.durability.extra = "bad"; }]) {
    const data = structuredClone(valid); mutate(data.records[0]); await fs.writeFile(f.filePath, JSON.stringify(data), { mode: 0o600 });
    await assert.rejects(f.restart().sender.submissions.list(account), code("TRANSACTION_JOURNAL_INVALID"));
  }
  const { raw, origin, ...legacy } = valid.records[0];
  await fs.writeFile(f.filePath, JSON.stringify({ schemaVersion: 1, records: [], rejections: [], resolved: [{ intent: legacy, receipt: receiptFor(f.state.hash) }] }), { mode: 0o600 });
  await assert.rejects(f.restart().store.snapshot(), code("TRANSACTION_JOURNAL_INVALID")); assert.equal(f.state.raw.length, 1);
});

for (const status of ["uncertain", "memory_only"]) test(`structured ${status} receipt errors remain visible and cannot clear an unknown transaction`, async t => {
  const f = await fixture(t); await assert.rejects(f.send());
  const proof = { version: nativeFixture.capability.version, scope: "local-snapshot", transactionHash: f.state.hash, status, blockNumber: "0x2", blockHash: ethereum.recoveredReceipt.blockHash };
  f.state.receiptError = { code: status === "uncertain" ? -32002 : -32004, message: "fixture unconfirmed checkpoint", data: { status: status === "uncertain" ? "transaction_durability_uncertain" : "transaction_durability_unavailable", transactionHash: f.state.hash, durabilityVersion: nativeFixture.capability.version, ynxDurability: proof, raw: "must not be copied into the public error" } };
  const parsed = rpcResponseError(f.state.receiptError); assert.equal("raw" in parsed.data, false);
  const result = await f.restart().sender.submissions.check(f.state.hash, account); assert.equal(result.confirmed, false); assert.equal(result.durabilityStatus, status); assert.equal((await f.store.snapshot()).length, 1);
  f.state.receiptError.data.ynxDurability.extra = true;
  await assert.rejects(f.sender.submissions.check(f.state.hash, account)); assert.equal((await f.store.snapshot()).length, 1);
});

test("a proof for another transaction or a capability downgrade cannot release the recorded signed bytes", async t => {
  const f = await fixture(t); await assert.rejects(f.send()); const before = await f.store.snapshot();
  f.state.receipt = receiptFor(f.state.hash); f.state.receipt.ynxDurability.transactionHash = `0x${"99".repeat(32)}`;
  await assert.rejects(f.sender.submissions.check(f.state.hash, account), code("RPC_RECEIPT_INVALID"));
  f.state.receipt = receiptFor(f.state.hash); f.state.model = { ...model }; delete f.state.model.durability;
  await assert.rejects(f.sender.submissions.check(f.state.hash, account), code("RPC_DURABILITY_UNSUPPORTED"));
  assert.deepEqual(await f.store.snapshot(), before);
});

test("signed-byte retry is account-bound and lock after dispatch preserves its real acknowledgement", async t => {
  const f = await fixture(t); await assert.rejects(f.send()); const resumed = f.restart();
  f.life.setAccount(to); await f.life.unlock();
  await assert.rejects(f.life.run(guard => resumed.sender.submissions.retry(f.state.hash, account, guard)), code("ACCOUNT_CHANGED")); assert.equal(f.state.raw.length, 1);
  f.life.setAccount(account); await f.life.unlock(); f.state.mode = "ack"; f.state.onBroadcast = () => f.life.lock();
  const result = await f.life.run(guard => resumed.sender.submissions.retry(f.state.hash, account, guard));
  assert.equal(result.hash, f.state.hash); assert.equal(result.confirmed, false); assert.equal(f.life.status().locked, true); assert.equal((await f.store.snapshot()).length, 1); assert.equal(f.state.signs, 1);
});

test("proof nonce and heights use uint64 arithmetic without float conversion", () => {
  const receipt = structuredClone(ethereum.recoveredReceipt), intent = coreIntent(receipt);
  intent.nonce = "0xfffffffffffffffe"; receipt.ynxNativeTransaction.nonce = "0xffffffffffffffff";
  receipt.blockNumber = "0xfffffffffffffffe"; receipt.ynxDurability.blockNumber = receipt.blockNumber;
  receipt.ynxDurability.checkpointBlockNumber = "0xffffffffffffffff"; receipt.ynxDurability.checkpointBlockHash = `0x${"22".repeat(32)}`;
  assert.equal(validateDurableReceipt(intent, receipt, parseFeeModel(model)).ynxNativeTransaction.nonce, "0xffffffffffffffff");
  intent.nonce = "0xffffffffffffffff"; assert.throws(() => validateDurableReceipt(intent, receipt, parseFeeModel(model)));
});

test("unsupported native failed receipt cannot resolve pending or historical original bytes", async t => {
  const f = await fixture(t); await assert.rejects(f.send()); f.state.receipt = { ...receiptFor(f.state.hash), status: "0x0" };
  const before = await fs.readFile(f.filePath, "utf8");
  await assert.rejects(f.sender.submissions.check(f.state.hash, account), code("RPC_RECEIPT_INVALID"));
  assert.equal(await fs.readFile(f.filePath, "utf8"), before); await assert.rejects(f.prepare(), code("TRANSACTION_RESOLUTION_REQUIRED"));
  f.state.receipt.status = "0x1"; await f.sender.submissions.check(f.state.hash, account);
  const stored = JSON.parse(await fs.readFile(f.filePath, "utf8")); stored.resolutions[0].receipt.status = "0x0";
  await fs.writeFile(f.filePath, JSON.stringify(stored)); await assert.rejects(f.restart().store.snapshot());
});

test("actual chain drift during a receipt or its final model read cannot clear the original", async t => {
  for (const trigger of ["eth_getTransactionReceipt", "ynx_getDurabilityModel"]) {
    const f = await fixture(t); await assert.rejects(f.send()); f.state.receipt = receiptFor(f.state.hash);
    let received = false;
    f.state.onResponse = request => { if (request.method === "eth_getTransactionReceipt") received = true; if (received && request.method === trigger) f.state.chainId = "0x1"; };
    const before = await fs.readFile(f.filePath, "utf8"); await assert.rejects(f.sender.submissions.check(f.state.hash, account), code("RPC_CHAIN_MISMATCH"));
    assert.equal(await fs.readFile(f.filePath, "utf8"), before); assert.equal(f.state.signs, 1); assert.equal(f.state.raw.length, 1);
  }
});

test("actual chain drift while preparing or reading the signing nonce stops before new signing", async t => {
  for (const phase of ["prepare", "sign"]) {
    const f = await fixture(t); const tx = phase === "sign" ? await f.prepare() : null;
    f.state.onResponse = request => { if (request.method === "eth_getTransactionCount") f.state.chainId = "0x1"; };
    await assert.rejects(phase === "prepare" ? f.prepare() : f.life.run(guard => f.sender.send(f.signer, tx, guard)), code("RPC_CHAIN_MISMATCH"));
    assert.equal(f.state.signs, 0); assert.equal(f.state.raw.length, 0);
  }
});

test("chain drift after original journal publication prevents POST and keeps original bytes", async t => {
  const f = await fixture(t), add = f.store.add.bind(f.store);
  f.store.add = async (...args) => { await add(...args); f.state.chainId = "0x1"; };
  await assert.rejects(f.send(), code("RPC_CHAIN_MISMATCH"));
  assert.equal(f.state.signs, 1); assert.equal(f.state.raw.length, 0); assert.equal((await f.restart().store.snapshot())[0].raw.startsWith("0x"), true);
});

test("ambiguous capability or receipt envelopes cannot release an uncertain transaction", async t => {
  for (const method of ["eth_chainId", "ynx_getFeeModel", "ynx_getDurabilityModel", "eth_getTransactionReceipt"]) {
    const f = await fixture(t); await assert.rejects(f.send()); f.state.receipt = receiptFor(f.state.hash);
    f.state.envelope = (value, request) => request.method === method ? { ...value, error: null } : value;
    const before = await fs.readFile(f.filePath, "utf8"); await assert.rejects(f.sender.submissions.check(f.state.hash, account));
    assert.equal(await fs.readFile(f.filePath, "utf8"), before);
  }
});

test("both HTTP clients reject redirected origins and malformed error envelopes", async t => {
  for (const mode of ["redirect", "origin", "null-error", "invalid-code", "invalid-message"]) {
    const fetchImpl = async (_url, options) => {
      const request = JSON.parse(options.body);
      const error = mode === "null-error" ? null : { code: mode === "invalid-code" ? "-32601" : -32601, message: mode === "invalid-message" ? null : "fixture" };
      const response = new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...(mode === "redirect" || mode === "origin" ? { result: "0x1917" } : { error }) }));
      if (mode === "redirect") Object.defineProperty(response, "redirected", { value: true });
      if (mode === "origin") Object.defineProperty(response, "url", { value: "https://other.example/evm" });
      return response;
    };
    await assert.rejects(new CanonicalAccountNetwork({ fetchImpl }).verifyChain(), code("RPC_INVALID_RESPONSE"));
    const sender = new CanonicalTransactionSender({ fetchImpl }); t.after(() => sender.provider.destroy());
    await assert.rejects(sender.provider.send("eth_chainId", []));
  }
});
