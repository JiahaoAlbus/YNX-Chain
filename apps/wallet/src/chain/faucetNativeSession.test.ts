import assert from "node:assert/strict";
import test from "node:test";
import { ynxAddressFromEVM } from "@ynx-chain/wallet-auth";
import { FaucetNativeSession, createProductionFaucetSession, NATIVE_FAUCET_AUTHORITY, NATIVE_FAUCET_CHAIN_ORIGIN } from "./faucetNativeSession";
import { FaucetClaimController, FAUCET_REQUEST_MODEL } from "./faucetClaim";
import { faucetAdmissionHash } from "./faucetAdmission";
import { NATIVE_DURABILITY_MODEL } from "./nativeDurability";
import type { FaucetHttpRequest, FaucetHttpResponse, NativeFaucetTransport } from "../../modules/ynx-faucet-transport";

const code = (c: string) => (e: any) => e?.code === c;
const address = "0x" + "26".repeat(20), recipient = ynxAddressFromEVM(address);
const scope = { authority: NATIVE_FAUCET_AUTHORITY, chainId: "0x1917" as const, recipient };
function fixture() {
  const lifecycle = new AbortController(), sent: FaucetHttpRequest[] = [], cancelled: string[] = [];
  let sequence = 0;
  const hooks: { reserve?: () => void; request?: (r: FaucetHttpRequest) => Promise<FaucetHttpResponse> } = {};
  const host: NativeFaucetTransport = {
    reserveTask() { hooks.reserve?.(); return `task-${++sequence}`; },
    request(r) { sent.push(r); return hooks.request ? hooks.request(r) : Promise.resolve(response(r)); },
    cancel(id) { cancelled.push(id); },
  };
  function response(r: FaucetHttpRequest): FaucetHttpResponse {
    return { url: r.purpose === "admit" ? scope.authority + "/request" : NATIVE_FAUCET_CHAIN_ORIGIN + "/evm", redirected: false,
      status: 200, contentType: "application/json", cacheControl: "no-store", body: JSON.stringify({ jsonrpc: "2.0", id: r.taskId, result: "0x1917" }) };
  }
  return { lifecycle, sent, cancelled, hooks, host, response, get reservations() { return sequence; }, session: new FaucetNativeSession(host, lifecycle.signal) };
}
function admission() { const requestId = "wallet_" + "ab".repeat(32); return { url: scope.authority + "/request", method: "POST" as const,
  requestId, body: JSON.stringify({ requestId, address: recipient, amount: 100 }) }; }

test("production factory is unconditionally unavailable", () => { assert.equal(createProductionFaucetSession(new AbortController().signal), null); });
test("fixed-purpose RPC binds the response ID and retires its reservation", async () => {
  const t = fixture(); assert.equal(await t.session.rpc.request("eth_chainId", []), "0x1917");
  assert.deepEqual(t.sent, [{ purpose: "rpc", taskId: "task-1", rpcId: "task-1", method: "eth_chainId", params: [] }]);
  assert.deepEqual(t.cancelled, ["task-1"]);
});
test("admission preserves original canonical body and actual retryable HTTP status", async () => {
  const t = fixture(), original = admission(); t.hooks.request = async r => ({ ...t.response(r), status: 503, body: "{\"error\":\"uncertain\"}" });
  const out = await t.session.transport(original); assert.equal(out.status, 503);
  assert.equal(t.sent[0]!.purpose, "admit"); assert.equal((t.sent[0] as any).body, original.body); assert.equal(t.sent.length, 1);
});
test("abort before reservation or between reservation and request cannot dispatch", async () => {
  const before = fixture(); before.lifecycle.abort(); await assert.rejects(before.session.rpc.request("eth_chainId", []), code("FAUCET_HOST_CANCELLED"));
  assert.equal(before.reservations, 0); assert.equal(before.sent.length, 0);
  const between = fixture(); between.hooks.reserve = () => between.lifecycle.abort();
  await assert.rejects(between.session.rpc.request("eth_chainId", []), code("FAUCET_HOST_CANCELLED"));
  assert.equal(between.sent.length, 0); assert.deepEqual(between.cancelled, ["task-1"]);
});
test("abort settles a hanging native bridge promptly and ignores its later response", async () => {
  const t = fixture(); let deliver!: (r: FaucetHttpResponse) => void;
  t.hooks.request = () => new Promise(resolve => { deliver = resolve; });
  const pending = t.session.rpc.request("eth_chainId", []); t.lifecycle.abort();
  await assert.rejects(pending, code("FAUCET_HOST_CANCELLED")); deliver(t.response(t.sent[0]!)); await Promise.resolve();
  assert.deepEqual(t.cancelled, ["task-1"]); assert.equal(t.sent.length, 1);
});
test("JS watchdog retires a hung bridge without claiming server rollback", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const t = fixture(); t.hooks.request = () => new Promise(() => {});
  const pending = t.session.rpc.request("eth_chainId", []); context.mock.timers.tick(20000);
  await assert.rejects(pending, code("FAUCET_HOST_TIMEOUT")); assert.deepEqual(t.cancelled, ["task-1"]);
});
for (const change of ["id", "version", "batch", "both", "extra", "syntax", "HTTP", "error"]) test(`RPC ${change} cannot masquerade as a verified result`, async () => {
  const t = fixture(); t.hooks.request = async r => {
    const out = t.response(r), v: any = JSON.parse(out.body);
    if (change === "id") v.id = "old-task";
    if (change === "version") v.jsonrpc = "1.0";
    if (change === "both") v.error = { code: -1, message: "bad" };
    if (change === "extra") v.extra = true;
    if (change === "error") { delete v.result; v.error = { code: -32601, message: "private server detail" }; }
    return { ...out, status: change === "HTTP" ? 503 : 200, body: change === "syntax" ? "{" : JSON.stringify(change === "batch" ? [v] : v) };
  };
  await assert.rejects(t.session.rpc.request("eth_chainId", []), code(change === "HTTP" ? "FAUCET_HOST_UNAVAILABLE" : change === "error" ? "FAUCET_HOST_RPC_ERROR" : "FAUCET_HOST_INVALID"));
  assert.equal(t.cancelled.length, 1);
});
for (const change of ["URL", "redirect", "3xx", "MIME", "bytes", "headers", "shape"]) test(`native response ${change} is rejected before RPC interpretation`, async () => {
  const t = fixture(); t.hooks.request = async r => {
    const out: any = t.response(r);
    if (change === "URL") out.url += "/";
    if (change === "redirect") out.redirected = true;
    if (change === "3xx") out.status = 307;
    if (change === "MIME") out.contentType = "text/html";
    if (change === "bytes") out.body = "中".repeat(6000);
    if (change === "headers") out.contentType = "a".repeat(257);
    if (change === "shape") out.extra = true;
    return out;
  };
  await assert.rejects(t.session.rpc.request("eth_chainId", []), code("FAUCET_HOST_INVALID"));
});
test("arbitrary methods, bad tuples and changed admission bodies are rejected before reserve", async () => {
  const t = fixture();
  for (const [method, params] of [["eth_sendRawTransaction", ["0x01"]], ["eth_chainId", ["extra"]], ["eth_getTransactionReceipt", ["0xBAD"]]]) {
    await assert.rejects(t.session.rpc.request(method as any, params as string[]), code("FAUCET_HOST_INVALID"));
  }
  const original = admission();
  for (const input of [{ ...original, url: "https://other.example/request" }, { ...original, body: original.body + " " },
    { ...original, body: original.body.replace('"amount":100', '"amount":100,"amount":100') }, { ...original, requestId: "wallet_" + "cd".repeat(32) }]) {
    await assert.rejects(t.session.transport(input), code("FAUCET_HOST_INVALID"));
  }
  assert.equal(t.reservations, 0); assert.equal(t.sent.length, 0);
});
test("native exceptions are generic and are never exposed as server or secret text", async () => {
  for (const mode of ["sync", "async"]) {
    const t = fixture(); t.hooks.request = () => { if (mode === "sync") throw Error("private native detail"); return Promise.reject(Error("private native detail")); };
    await assert.rejects(t.session.rpc.request("eth_chainId", []), (e: any) => e.code === "FAUCET_HOST_UNAVAILABLE" && !e.message.includes("private"));
  }
});
test("actual coordinator + host session retain unknown after cancel and retry the same admission bytes", async () => {
  const rows = new Map<string, string>(), storage = { async getItem(k: string) { return rows.get(k) ?? null; }, async setItem(k: string, v: string) { rows.set(k, v); }, async deleteItem() { throw Error("forbidden"); } };
  const t = fixture();
  t.hooks.request = async r => {
    if (r.purpose === "rpc") return { ...t.response(r), body: JSON.stringify({ jsonrpc: "2.0", id: r.rpcId,
      result: r.method === "eth_chainId" ? "0x1917" : r.method === "ynx_getFaucetModel" ? FAUCET_REQUEST_MODEL : NATIVE_DURABILITY_MODEL }) };
    t.lifecycle.abort(); return t.response(r);
  };
  const c = new FaucetClaimController(storage, scope, NATIVE_FAUCET_CHAIN_ORIGIN, { rpc: t.session.rpc, transport: t.session.transport, randomBytes: n => new Uint8Array(n).fill(1) });
  const entry = (await c.prepare(100, () => {})).entry!, guard = () => { if (t.lifecycle.signal.aborted) throw Error("screen cancelled"); };
  await assert.rejects(c.submit(entry.requestId, guard), /screen cancelled/);
  assert.equal((await c.read()).entry?.phase, "unknown");
  const next = fixture(); next.hooks.request = async r => {
    if (r.purpose === "rpc") return { ...next.response(r), body: JSON.stringify({ jsonrpc: "2.0", id: r.rpcId,
      result: r.method === "eth_chainId" ? "0x1917" : r.method === "ynx_getFaucetModel" ? FAUCET_REQUEST_MODEL : NATIVE_DURABILITY_MODEL }) };
    const txHash = faucetAdmissionHash(r.requestId);
    return { ...next.response(r), body: JSON.stringify({ transaction: { hash: txHash, type: "faucet", from: "ynx_faucet", to: address, amount: 100, fee: 0, nonce: 0 },
      requestId: r.requestId, transactionHash: txHash, address, amount: 100, nativeSymbol: "YNXT", truthfulStatus: "rpc-backed-faucet", status: "accepted", replayed: true }) };
  };
  const cold = new FaucetClaimController(storage, scope, NATIVE_FAUCET_CHAIN_ORIGIN, { rpc: next.session.rpc, transport: next.session.transport });
  const acknowledged = await cold.submit(entry.requestId, () => {}); assert.equal(acknowledged.entry?.phase, "admission-acknowledged");
  const bodies = [...t.sent, ...next.sent].filter(r => r.purpose === "admit").map(r => (r as any).body);
  assert.deepEqual(bodies, [entry.body, entry.body]);
});

for (const mutation of ["duplicate", "escaped-duplicate", "nested-duplicate", "depth", "nodes", "infinity"]) test(`ambiguous or unbounded JSON ${mutation} is rejected`, async () => {
  const t = fixture(); t.hooks.request = async r => {
    let body = t.response(r).body;
    if (mutation === "duplicate") body = body.replace('"result":', '"id":"wrong","result":');
    if (mutation === "escaped-duplicate") body = body.replace('"result":', '"\\u0069d":"task-1","result":');
    if (mutation === "nested-duplicate") body = JSON.stringify({ jsonrpc: "2.0", id: r.taskId, result: null }).replace('null', '{"status":"wrong","status":"durable"}');
    if (mutation === "depth") body = JSON.stringify({ jsonrpc: "2.0", id: r.taskId, result: null }).replace('null', '['.repeat(34) + '0' + ']'.repeat(34));
    if (mutation === "nodes") body = JSON.stringify({ jsonrpc: "2.0", id: r.taskId, result: Array(2050).fill(0) });
    if (mutation === "infinity") body = JSON.stringify({ jsonrpc: "2.0", id: r.taskId, result: null }).replace('null', '1e999');
    return { ...t.response(r), body };
  };
  await assert.rejects(t.session.rpc.request("eth_chainId", []), code("FAUCET_HOST_INVALID"));
});
test("valid pretty JSON and harmless escaped text are accepted without rewriting admission bytes", async () => {
  const t = fixture(); t.hooks.request = async r => ({ ...t.response(r), body: JSON.stringify({ result: { list: [null, true, 1.5, "a\\b\"c", { "safe\nkey": "<text>" }] }, id: r.taskId, jsonrpc: "2.0" }, null, 2) + "\n" });
  assert.deepEqual(await t.session.rpc.request("eth_chainId", []), { list: [null, true, 1.5, "a\\b\"c", { "safe\nkey": "<text>" }] });
});
