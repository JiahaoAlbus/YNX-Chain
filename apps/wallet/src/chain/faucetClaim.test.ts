import assert from "node:assert/strict";
import test from "node:test";
import { ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import { FaucetClaimController, FAUCET_REQUEST_MODEL, type FaucetClaimRPC, type FaucetReadMethod } from "./faucetClaim";
import { FaucetAdmissionController, faucetAdmissionHash, type FaucetAdmissionTransport } from "./faucetAdmission";
import { NATIVE_DURABILITY_MODEL } from "./nativeDurability";

// Synthetic transport results, no real account, public request or node finality.
const address = "0x" + "26".repeat(20), recipient = ynxAddressFromEVM(address);
const scope = { authority: "https://faucet.candidate.example", chainId: "0x1917" as const, recipient };
const origin = "https://rpc.candidate.example", live = () => {}, copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const code = (value: string) => (error: any) => error?.code === value;
function storage() {
  const rows = new Map<string, string>();
  const hooks: { read?: (key: string) => void; write?: (key: string, value: string) => void; after?: (key: string) => void } = {};
  return { rows, hooks, async getItem(key: string) { hooks.read?.(key); return rows.get(key) ?? null; },
    async setItem(key: string, value: string) { hooks.write?.(key, value); rows.set(key, value); hooks.after?.(key); },
    async deleteItem(key: string) { rows.delete(key); } };
}
function durable(hash: string) { return { version: NATIVE_DURABILITY_MODEL.version, scope: "local-snapshot", status: "durable", transactionHash: hash,
  blockNumber: "0x1", blockHash: "0x" + "ab".repeat(32), checkpointBlockNumber: "0x1", checkpointBlockHash: "0x" + "ab".repeat(32), snapshotIntegrity: "0x" + "cd".repeat(32) }; }
function receipt(hash: string) { return { transactionHash: hash, from: "ynx_faucet", to: address, status: "0x1", contractAddress: null,
  transactionIndex: "0x0", blockNumber: "0x1", blockHash: "0x" + "ab".repeat(32), ynxDurability: durable(hash),
  ynxNativeTransaction: { type: "faucet", amountYNXT: "100", feeYNXT: "0", nonce: "0x0" } }; }
type Request = Parameters<FaucetAdmissionTransport>[0];
function accepted(r: Request, replayed = false) {
  const original = JSON.parse(r.body), hash = faucetAdmissionHash(r.requestId);
  return { url: r.url, redirected: false, status: replayed ? 200 : 201, contentType: "application/json", cacheControl: "no-store",
    body: JSON.stringify({ transaction: { hash, type: "faucet", from: "ynx_faucet", to: address, amount: original.amount, fee: 0, nonce: 0 },
      address, amount: original.amount, nativeSymbol: "YNXT", requestId: r.requestId, truthfulStatus: "rpc-backed-faucet", transactionHash: hash,
      status: "accepted", ...(replayed ? { replayed: true } : {}) }) };
}
function setup(s = storage()) {
  let sequence = 0;
  const calls: { method: FaucetReadMethod; params: readonly string[] }[] = [], posts: Request[] = [];
  const hooks: { rpc?: (method: FaucetReadMethod, params: readonly string[]) => unknown | Promise<unknown>; post?: FaucetAdmissionTransport } = {};
  const rpc: FaucetClaimRPC = { origin, async request(method, params) {
    calls.push({ method, params });
    if (hooks.rpc) return hooks.rpc(method, params);
    return result(method, params);
  } };
  function result(method: FaucetReadMethod, params: readonly string[]): unknown {
    if (method === "eth_chainId") return "0x1917";
    if (method === "ynx_getFaucetModel") return copy(FAUCET_REQUEST_MODEL);
    if (method === "ynx_getDurabilityModel") return copy(NATIVE_DURABILITY_MODEL);
    if (method === "ynx_getTransactionDurability") return durable(params[0]!);
    return receipt(params[0]!);
  }
  const options = { rpc, randomBytes: (n: number) => new Uint8Array(n).fill(++sequence), transport: async (r: Request) => {
    posts.push(r); return hooks.post ? hooks.post(r) : accepted(r);
  } };
  const c = new FaucetClaimController(s, scope, origin, options);
  return { s, c, calls, posts, hooks, options, result, async ack() {
    const initial = await c.prepare(100, live); await c.submit(initial.entry!.requestId, live); return initial.entry!;
  } };
}

test("unwired coordinator retains prepared intent and never enables a transport", async () => {
  const s = storage(), c = new FaucetClaimController(s, scope, origin, { randomBytes: n => new Uint8Array(n).fill(1) });
  const v = await c.prepare(100, live); await assert.rejects(c.submit(v.entry!.requestId, live), code("FAUCET_CLAIM_UNAVAILABLE"));
  assert.equal((await c.read()).entry?.phase, "prepared"); assert.equal(s.rows.size, 1);
});
test("admission ACK stays active until explicit fresh receipt completion", async () => {
  const t = setup(), entry = await t.ack();
  assert.equal((await t.c.prepare(100, live)).entry?.requestId, entry.requestId);
  await assert.rejects(t.c.prepare(101, live), code("FAUCET_CLAIM_PENDING"));
  await t.c.submit(entry.requestId, live); assert.equal(t.posts.length, 1);
  const verified = await t.c.check(entry.requestId, live);
  assert.equal(verified.verification, "fresh-read"); assert.equal(verified.observedStatus, "durable");
  assert.equal(verified.consensusFinality, false); assert.equal(verified.balanceVerified, false);
  assert.equal((await t.c.prepare(100, live)).entry?.requestId, entry.requestId);
  assert.equal((await new FaucetClaimController(t.s, scope, origin).read()).verification, "stored-snapshot");
  const reads = t.calls.length, completed = await t.c.complete(entry.requestId, live);
  assert.ok(t.calls.length > reads); assert.equal(completed.entry, null); assert.deepEqual(completed.completedRequestIds, [entry.requestId]);
  const next = await t.c.prepare(100, live); assert.notEqual(next.entry?.requestId, entry.requestId);
  assert.equal((await new FaucetAdmissionController(t.s, scope).read()).length, 2);
});
test("lost ACK, cold restart and explicit retry reuse the exact original request bytes", async () => {
  const t = setup(); t.hooks.post = async () => { throw Error("network response lost"); };
  const entry = (await t.c.prepare(100, live)).entry!;
  assert.equal((await t.c.submit(entry.requestId, live)).entry?.lastResult, "transport-unknown");
  t.hooks.post = async r => accepted(r, true);
  const restarted = new FaucetClaimController(t.s, scope, origin, t.options);
  assert.equal((await restarted.prepare(100, live)).entry?.requestId, entry.requestId);
  await restarted.submit(entry.requestId, live); await restarted.submit(entry.requestId, live);
  assert.deepEqual(t.posts.map(p => p.body), [entry.body, entry.body]);
});
for (const status of [429, 503]) test(`HTTP ${status} cannot release the retained claim`, async () => {
  const t = setup(); t.hooks.post = async r => ({ ...accepted(r), status, body: JSON.stringify({ error: "synthetic", requestId: r.requestId,
    transactionHash: faucetAdmissionHash(r.requestId), status: status === 429 ? "rate_limited" : "transaction_result_uncertain", retrySameRequest: true }) });
  const entry = (await t.c.prepare(100, live)).entry!;
  for (let i = 0; i < 2; i++) await t.c.submit(entry.requestId, live);
  assert.equal((await t.c.prepare(100, live)).entry?.requestId, entry.requestId);
  assert.deepEqual(t.posts.map(p => p.body), [entry.body, entry.body]);
  await assert.rejects(t.c.complete(entry.requestId, live), code("FAUCET_CLAIM_NOT_DURABLE"));
});
for (const change of ["chain", "faucet-missing", "faucet-hash", "faucet-finality", "faucet-durability", "model"]) test(`${change} preflight prevents any admission POST`, async () => {
  const t = setup(); t.hooks.rpc = (method, params) => {
    const v: any = t.result(method, params);
    if (method === "eth_chainId" && change === "chain") return "0x1";
    if (method === "ynx_getFaucetModel") {
      if (change === "faucet-missing") return null;
      if (change === "faucet-hash") v.transactionHashScheme = "legacy";
      if (change === "faucet-finality") v.consensusFinality = true;
      if (change === "faucet-durability") v.durability.scope = "consensus";
    }
    if (method === "ynx_getDurabilityModel" && change === "model") v.consensusFinality = true;
    return v;
  };
  const entry = (await t.c.prepare(100, live)).entry!;
  await assert.rejects(t.c.submit(entry.requestId, live)); assert.equal(t.posts.length, 0);
  assert.equal((await t.c.read()).entry?.phase, "prepared");
});
test("chain switch on trailing preflight and cancellation before POST stop dispatch", async () => {
  for (const mode of ["chain", "cancel"]) {
    const t = setup(); let chainReads = 0, active = true;
    t.hooks.rpc = (method, params) => {
      if (method === "eth_chainId" && ++chainReads === 2) { if (mode === "chain") return "0x1"; active = false; }
      return t.result(method, params);
    };
    const entry = (await t.c.prepare(100, live)).entry!;
    await assert.rejects(t.c.submit(entry.requestId, () => { if (!active) throw Error("locked"); }));
    assert.equal(t.posts.length, 0);
  }
});
test("late ACK is archived for the old scope but never delivered to a cancelled screen", async () => {
  const t = setup(); let active = true;
  t.hooks.post = async r => { active = false; return accepted(r); };
  const entry = (await t.c.prepare(100, live)).entry!;
  await assert.rejects(t.c.submit(entry.requestId, () => { if (!active) throw Error("locked"); }), /locked/);
  assert.equal((await t.c.read()).entry?.phase, "admission-acknowledged");
  assert.equal((await new FaucetClaimController(t.s, { ...scope, recipient: ynxAddressFromEVM("0x" + "27".repeat(20)) }, origin).read()).entry, null);
  assert.equal(t.posts.length, 1);
});
for (const status of ["pending_durable", "uncertain", "memory_only", "not_found"]) test(`${status} after a stored proof never reports current durability or completes`, async () => {
  const t = setup(), entry = await t.ack(); await t.c.check(entry.requestId, live);
  t.hooks.rpc = (method, params) => {
    if (method !== "ynx_getTransactionDurability") return t.result(method, params);
    return { version: NATIVE_DURABILITY_MODEL.version, scope: "local-snapshot", status, transactionHash: params[0],
      ...(status === "pending_durable" ? { checkpointBlockNumber: "0x1", checkpointBlockHash: "0x" + "ab".repeat(32), snapshotIntegrity: "0x" + "cd".repeat(32) } : {}) };
  };
  const v = await t.c.check(entry.requestId, live); assert.equal(v.verification, "unverified"); assert.equal(v.observedStatus, status);
  assert.ok(v.evidence); await assert.rejects(t.c.complete(entry.requestId, live), code("FAUCET_CLAIM_NOT_DURABLE"));
  assert.equal((await t.c.prepare(100, live)).entry?.requestId, entry.requestId);
});
for (const mutation of ["hash", "recipient", "amount", "fee", "nonce", "block", "checkpoint", "null"]) test(`receipt ${mutation} mismatch cannot store completion`, async () => {
  const t = setup(), entry = await t.ack(); t.hooks.rpc = (method, params) => {
    const v: any = t.result(method, params); if (method !== "eth_getTransactionReceipt") return v;
    if (mutation === "hash") v.transactionHash = "0x" + "ef".repeat(32);
    if (mutation === "recipient") v.to = "0x" + "28".repeat(20);
    if (mutation === "amount") v.ynxNativeTransaction.amountYNXT = "101";
    if (mutation === "fee") v.ynxNativeTransaction.feeYNXT = "1";
    if (mutation === "nonce") v.ynxNativeTransaction.nonce = "0x1";
    if (mutation === "block") { v.blockHash = v.ynxDurability.blockHash = v.ynxDurability.checkpointBlockHash = "0x" + "ef".repeat(32); }
    if (mutation === "checkpoint") v.ynxDurability.checkpointBlockNumber = "0x0";
    return mutation === "null" ? null : v;
  };
  await assert.rejects(t.c.complete(entry.requestId, live));
  assert.equal(t.s.rows.size, 1); assert.equal((await t.c.read()).entry?.requestId, entry.requestId);
});
test("an advancing valid checkpoint does not change the bound actual transaction block", async () => {
  const t = setup(), entry = await t.ack(); t.hooks.rpc = (method, params) => {
    const v: any = t.result(method, params);
    if (method === "eth_getTransactionReceipt") { v.ynxDurability.checkpointBlockNumber = "0x2"; v.ynxDurability.checkpointBlockHash = "0x" + "ef".repeat(32); }
    return v;
  };
  assert.equal((await t.c.check(entry.requestId, live)).verification, "fresh-read");
});
test("a trailing model change or lock after receipt prevents evidence persistence", async () => {
  for (const mode of ["model", "lock"]) {
    const t = setup(), entry = await t.ack(); let gotReceipt = false, active = true;
    t.hooks.rpc = (method, params) => {
      const v: any = t.result(method, params);
      if (gotReceipt && method === "ynx_getFaucetModel" && mode === "model") v.legacyRequestSafeRetry = true;
      if (method === "eth_getTransactionReceipt") { gotReceipt = true; if (mode === "lock") active = false; }
      return v;
    };
    await assert.rejects(t.c.complete(entry.requestId, () => { if (!active) throw Error("locked"); }));
    assert.equal(t.s.rows.size, 1);
  }
});
test("receipt storage failure never deletes admission marker or automatically repeats POST", async () => {
  for (const stage of ["write", "readback"]) {
    const t = setup(), entry = await t.ack(), admission = [...t.s.rows.values()][0];
    if (stage === "write") t.s.hooks.write = key => { if (key.includes("faucet-receipts")) throw Error("disk failed"); };
    else t.s.hooks.after = key => { if (key.includes("faucet-receipts")) throw Error("committed result uncertain"); };
    await assert.rejects(t.c.check(entry.requestId, live), code("FAUCET_CLAIM_STORAGE"));
    t.s.hooks.write = undefined; t.s.hooks.after = undefined;
    assert.equal([...t.s.rows.values()][0], admission); await t.c.submit(entry.requestId, live); assert.equal(t.posts.length, 1);
    assert.equal((await t.c.prepare(100, live)).entry?.requestId, entry.requestId);
  }
});
test("reloaded journal rejects changed scope, proof, duplicate record and forged completed marker", async () => {
  const t = setup(), entry = await t.ack(); await t.c.check(entry.requestId, live);
  const [key, original] = [...t.s.rows.entries()].find(([key]) => key.includes("faucet-receipts"))!;
  for (const mutate of [(v: any) => { v.scope.chainOrigin = "https://other.example"; }, (v: any) => { v.receipts[0].evidence.receipt.ynxNativeTransaction.feeYNXT = "1"; },
    (v: any) => { v.receipts.push(v.receipts[0]); }, (v: any) => { v.receipts[0].evidence = {}; v.receipts[0].completed = true; },
    (v: any) => { v.receipts[0].requestId = "wallet_" + "77".repeat(32); }]) {
    const v = JSON.parse(original); mutate(v); t.s.rows.set(key, JSON.stringify(v));
    await assert.rejects(new FaucetClaimController(t.s, scope, origin).read(), code("FAUCET_CLAIM_STORAGE"));
  }
  t.s.rows.set(key, original); assert.equal((await t.c.read()).verification, "stored-snapshot");
});
test("journal lost after multiple admissions blocks new requests instead of forgetting history", async () => {
  const t = setup(), entry = await t.ack(); await t.c.complete(entry.requestId, live); await t.c.prepare(100, live);
  for (const key of t.s.rows.keys()) if (key.includes("faucet-receipts")) t.s.rows.delete(key);
  await assert.rejects(t.c.prepare(100, live), code("FAUCET_CLAIM_STORAGE")); assert.equal(t.posts.length, 1);
});
test("parallel coordinators sharing one adapter reserve one claim and dispatch once", async () => {
  const t = setup(), second = new FaucetClaimController(t.s, scope, origin, t.options);
  const [a, b] = await Promise.all([t.c.prepare(100, live), second.prepare(100, live)]);
  assert.equal(a.entry?.requestId, b.entry?.requestId);
  await Promise.all([t.c.submit(a.entry!.requestId, live), second.submit(b.entry!.requestId, live)]); assert.equal(t.posts.length, 1);
});

test("chain/model drift while dispatch marker is stored prevents the actual POST", async () => {
  const t = setup(); let drifted = false;
  t.s.hooks.after = (key) => { if (key.includes("faucet-admission") && JSON.parse(t.s.rows.get(key)!).entries[0].phase === "unknown") drifted = true; };
  t.hooks.rpc = (method, params) => drifted && method === "eth_chainId" ? "0x1" : t.result(method, params);
  const entry = (await t.c.prepare(100, live)).entry!;
  const view = await t.c.submit(entry.requestId, live);
  assert.equal(t.posts.length, 0); assert.equal(view.entry?.phase, "unknown");
  assert.equal(view.entry?.requestId, entry.requestId); assert.equal(view.entry?.lastResult, "transport-unknown");
});
test("completion storage drift cannot return success or unlock another request after cold reload", async () => {
  const t = setup(), entry = await t.ack(); let drifted = false;
  t.s.hooks.after = key => { if (key.includes("faucet-receipts")) drifted = true; };
  t.hooks.rpc = (method, params) => drifted && method === "eth_chainId" ? "0x1" : t.result(method, params);
  await assert.rejects(t.c.complete(entry.requestId, live), code("FAUCET_CLAIM_INVALID"));
  const cold = new FaucetClaimController(t.s, scope, origin, t.options);
  assert.equal((await cold.read()).verification, "unverified");
  await assert.rejects(cold.prepare(100, live), code("FAUCET_CLAIM_INVALID"));
  assert.equal((await new FaucetAdmissionController(t.s, scope).read()).length, 1);
  // Once original node evidence is available, explicit completion retry can succeed.
  t.s.hooks.after = undefined; drifted = false;
  await cold.complete(entry.requestId, live); assert.notEqual((await cold.prepare(100, live)).entry?.requestId, entry.requestId);
});
test("even a successful historical completion is rechecked before preparing the next claim", async () => {
  const t = setup(), entry = await t.ack(); await t.c.complete(entry.requestId, live);
  t.hooks.rpc = (method, params) => method === "ynx_getTransactionDurability" ?
    { version: NATIVE_DURABILITY_MODEL.version, scope: "local-snapshot", status: "not_found", transactionHash: params[0] } : t.result(method, params);
  await assert.rejects(new FaucetClaimController(t.s, scope, origin, t.options).prepare(100, live), code("FAUCET_CLAIM_NOT_DURABLE"));
  assert.equal((await new FaucetAdmissionController(t.s, scope).read()).length, 1);
});
test("loss of durability during receipt persistence never produces fresh-read UI evidence", async () => {
  const t = setup(), entry = await t.ack(); let drifted = false;
  t.s.hooks.after = key => { if (key.includes("faucet-receipts")) drifted = true; };
  t.hooks.rpc = (method, params) => drifted && method === "ynx_getTransactionDurability" ?
    { version: NATIVE_DURABILITY_MODEL.version, scope: "local-snapshot", status: "memory_only", transactionHash: params[0] } : t.result(method, params);
  const view = await t.c.check(entry.requestId, live);
  assert.equal(view.verification, "unverified"); assert.equal(view.observedStatus, "memory_only");
  assert.equal(view.entry?.requestId, entry.requestId); assert.ok(view.evidence);
});
