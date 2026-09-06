import assert from "node:assert/strict";
import test from "node:test";
import { Transaction, Wallet, toQuantity } from "ethers";
import { CanonicalTransactionSender } from "../src/canonical-transaction-sender.mjs";
import { NativeWalletService } from "../src/native-wallet-service.mjs";

// Public scalar-one fixture. All RPC calls are simulated; no network or real funds.
const wallet = new Wallet(`0x${"1".padStart(64, "0")}`);
const account = wallet.address.toLowerCase();
const recipient = `0x${"22".repeat(20)}`;
const input = () => ({ from: account, to: recipient, value: "0x1", data: "0x1234" });
function fixture(t, overrides = {}) {
  const state = { chain: "0x1917", nonce: "0x0", balance: toQuantity(10n ** 18n), gasPrice: "0x3b9aca00", estimate: "0x5208", calls: [], signs: 0, broadcasts: 0, ...overrides };
  const sender = new CanonicalTransactionSender({ fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body); state.calls.push(request);
    const results = { eth_chainId: state.chain, eth_getTransactionCount: state.nonce, eth_getBalance: state.balance, eth_gasPrice: state.gasPrice, eth_estimateGas: state.estimate, eth_getBlockByNumber: { baseFeePerGas: "0x3b9aca00" }, eth_maxPriorityFeePerGas: "0x5f5e100" };
    if (request.method === "eth_sendRawTransaction") { state.broadcasts++; state.signed = Transaction.from(request.params[0]); results.eth_sendRawTransaction = state.signed.hash; }
    const payload = request.method === state.unavailable ? { error: { code: -32601, message: "method unavailable" } } : { result: results[request.method] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...payload }));
  } });
  const signer = { address: wallet.address, async signTransaction(fields) { state.signs++; return wallet.signTransaction(fields); }, connect() { throw new Error("must never connect and populate after review"); }, sendTransaction() { throw new Error("must never populate after review"); } };
  t.after(() => sender.provider.destroy());
  return { sender, signer, state };
}

test("real signing broadcasts only the complete immutable transaction approved before signing", async t => {
  const { sender, signer, state } = fixture(t);
  const transaction = input();
  const snapshot = await sender.prepare(account, transaction);
  assert.deepEqual(snapshot, { ...transaction, chainId: "0x1917", type: 0, nonce: "0x0", gasPrice: "0x3b9aca00", gasLimit: "0x6270" });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(state.signs, 0); assert.equal(state.broadcasts, 0);
  transaction.to = account; transaction.data = "0xdeadbeef";
  assert.throws(() => { snapshot.gasPrice = "0x1"; }, TypeError);
  const reviewedUnsigned = Transaction.from({ ...snapshot, from: undefined, nonce: 0 }).unsignedSerialized;
  state.calls.length = 0;
  const hash = await sender.send(signer, snapshot);
  assert.equal(hash, state.signed.hash);
  assert.equal(state.signed.unsignedSerialized, reviewedUnsigned);
  assert.equal(state.signed.from.toLowerCase(), account);
  assert.deepEqual(state.calls.map(call => call.method), ["eth_chainId", "eth_getTransactionCount", "eth_sendRawTransaction"]);
  assert.equal(state.signs, 1);
  await assert.rejects(sender.send(signer, snapshot), error => error.data.code === "UNREVIEWED_TRANSACTION");
  assert.equal(state.signs, 1);
});

test("JSON-RPC gas is mapped to gasLimit and EIP-1559 access lists are copied and frozen", async t => {
  const { sender, signer, state } = fixture(t);
  const accessList = [{ address: recipient, storageKeys: [`0x${"00".repeat(32)}`] }];
  const snapshot = await sender.prepare(account, { ...input(), type: "0x2", gas: "0x7000", accessList });
  assert.equal(snapshot.gasLimit, "0x7000"); assert.equal("gas" in snapshot, false);
  assert.equal(snapshot.maxPriorityFeePerGas, "0x5f5e100");
  assert.equal(snapshot.maxFeePerGas, toQuantity(2_100_000_000n));
  assert.equal("gasPrice" in snapshot, false);
  assert.equal(Object.isFrozen(snapshot.accessList[0].storageKeys), true);
  accessList[0].storageKeys[0] = `0x${"ff".repeat(32)}`;
  assert.equal(snapshot.accessList[0].storageKeys[0], `0x${"00".repeat(32)}`);
  await sender.send(signer, snapshot);
  assert.equal(state.signed.type, 2); assert.equal(state.signed.gasLimit, 0x7000n);
  assert.equal(state.signed.maxFeePerGas, 2_100_000_000n);
  assert.equal(state.signed.data, "0x1234");
});

test("missing RPC fields, fee errors and insufficient balance cannot create a signable snapshot", async t => {
  for (const overrides of [{ unavailable: "eth_gasPrice" }, { unavailable: "eth_estimateGas" }, { unavailable: "eth_getTransactionCount" }, { gasPrice: "0x0" }, { gasPrice: null }, { nonce: "0x00" }, { balance: "0x1" }, { estimate: "0x1" }, { chain: "0x1" }]) {
    const { sender, signer, state } = fixture(t, overrides);
    await assert.rejects(sender.prepare(account, input()), error => !["eth_gasPrice", "eth_estimateGas"].includes(overrides.unavailable) || error.data.code === "RPC_FEE_UNAVAILABLE");
    await assert.rejects(sender.send(signer, input()), error => error.data.code === "UNREVIEWED_TRANSACTION");
    assert.equal(state.signs, 0); assert.equal(state.broadcasts, 0);
  }
});

test("a changed nonce or chain after review requires a new review before any signature", async t => {
  for (const [field, changed, code] of [["nonce", "0x1", "TRANSACTION_NONCE_CHANGED"], ["chain", "0x1", "RPC_CHAIN_MISMATCH"]]) {
    const { sender, signer, state } = fixture(t);
    const snapshot = await sender.prepare(account, input());
    state[field] = changed;
    await assert.rejects(sender.send(signer, snapshot), error => error.data.code === code);
    assert.equal(state.signs, 0); assert.equal(state.broadcasts, 0);
    state[field] = field === "nonce" ? "0x0" : "0x1917";
    await assert.rejects(sender.send(signer, snapshot), error => error.data.code === "UNREVIEWED_TRANSACTION");
  }
});

test("inconsistent, unsupported or user-injected incomplete transactions fail before signing", async t => {
  const { sender, signer, state } = fixture(t);
  for (const changes of [{ gas: "0x5208", gasLimit: "0x6270" }, { gas: "0x5000" }, { gasPrice: "0x1", maxFeePerGas: "0x2" }, { type: 0, maxPriorityFeePerGas: "0x1" }, { type: 0, accessList: [] }, { type: 3 }, { type: null }, { nonce: "0x1" }, { chainId: "0x1" }, { data: "0x1" }, { value: "0x01" }, { authorizationList: [] }]) await assert.rejects(sender.prepare(account, { ...input(), ...changes }));
  const snapshot = await sender.prepare(account, input());
  await assert.rejects(sender.send(signer, { ...snapshot }), error => error.data.code === "UNREVIEWED_TRANSACTION");
  assert.equal(state.signs, 0); assert.equal(state.broadcasts, 0);
});

test("a signer returning different transaction bytes is rejected before broadcasting", async t => {
  const { sender, state } = fixture(t);
  const snapshot = await sender.prepare(account, input());
  await assert.rejects(sender.send({ address: wallet.address, signTransaction: fields => wallet.signTransaction({ ...fields, data: "0xdeadbeef" }) }, snapshot), error => error.data.code === "TRANSACTION_SNAPSHOT_MISMATCH");
  assert.equal(state.broadcasts, 0);
});

test("native transfer uses the same RPC-prepared snapshot through real signing", async t => {
  const { sender, state } = fixture(t, { estimate: toQuantity(25_000), gasPrice: toQuantity(40_000_000_000_000n), balance: toQuantity(2n * 10n ** 18n) });
  let keyReads = 0;
  const vault = { async status() { return { initialized: true, account }; }, async withSecret(action) { keyReads++; return action("1".padStart(64, "0"), { account }); } };
  const native = new NativeWalletService({ vault, network: sender.network, sender });
  const review = await native.prepareTransfer({ to: recipient, amount: "0.1" });
  assert.equal(review.maximumFee, "1.2"); assert.equal(review.total, "1.3");
  assert.equal(review.transaction.gasLimit, toQuantity(30_000));
  assert.equal(review.transaction.nonce, "0x0");
  assert.equal(keyReads, 0); assert.equal(state.broadcasts, 0);
  const expected = Transaction.from({ ...review.transaction, from: undefined, nonce: 0 }).unsignedSerialized;
  await native.transferAction(review.id, "approve");
  assert.equal(keyReads, 1); assert.equal(state.broadcasts, 1);
  assert.equal(state.signed.unsignedSerialized, expected);
});
