import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {loadEndpointMigration, requestJSON, verifyLiveMigration} from "./testnet-endpoint-migration-check.mjs";

const config = loadEndpointMigration();
const txHash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const contractAddress = `0x${"c".repeat(40)}`;

test("complete read-only comparison never claims full public acceptance", async () => {
  const calls = [];
  const proof = await verifyLiveMigration(config, {fetchImpl: fixtureFetch(calls), contractAddress, explorer: true});
  assert.equal(proof.chainId, "0x1917");
  assert.equal(proof.networkId, "6423");
  assert.equal(proof.comparisonHeight, 100);
  assert.equal(proof.comparisonBlockHash, blockHash);
  assert.equal(proof.transactionProof, txHash);
  assert.equal(proof.faucetBuild, "a".repeat(40));
  assert.deepEqual(proof.contractProof, {address: contractAddress, code: "0x6000"});
  assert.equal(proof.readOnlyComparisonVerified, true);
  assert.equal(proof.explorerAliasReadVerified, true);
  assert.equal(proof.publicVerified, false);
  assert.ok(proof.remainingGates.includes("SHARED_FAUCET_STATE"));
  assert.equal(calls.filter(c => c.url.includes("explorer")).length, 2);
  assert.ok(calls.some(c => c.method === "eth_getCode" && c.params[1] === "0x64"));
  assert.ok(calls.every(c => c.method === undefined || c.method.startsWith("eth_get") || ["eth_chainId", "eth_blockNumber", "net_version"].includes(c.method)));
});

test("empty history and missing contract sample remain incomplete", async () => {
  const proof = await verifyLiveMigration(config, {fetchImpl: fixtureFetch([], (value, ctx) => {
    if (ctx.method === "eth_getBlockByNumber") value.transactions = [];
    return value;
  })});
  assert.equal(proof.transactionProof, null);
  assert.equal(proof.contractProof, null);
  assert.equal(proof.readOnlyComparisonVerified, false);
  assert.equal(proof.publicVerified, false);
  for (const gate of ["HISTORICAL_TRANSACTION_REQUIRED", "NONEMPTY_CONTRACT_CODE_REQUIRED", "EXPLORER_ALIAS_NOT_CHECKED"]) assert.ok(proof.remainingGates.includes(gate));
});

test("explicit historical transaction is verified against its containing block", async () => {
  const proof = await verifyLiveMigration(config, {contractAddress, transactionHash: txHash, fetchImpl: fixtureFetch([], (value, ctx) => {
    if (ctx.method === "eth_getTransactionByHash") value.blockNumber = "0x63";
    if (ctx.method === "eth_getBlockByNumber" && ctx.params[0] === "0x64") value.transactions = [];
    return value;
  })});
  assert.equal(proof.readOnlyComparisonVerified, true);
});

const invalidCases = [
  ["same-height fork", /same-height block hash differs/, (v, c) => { if (c.target && c.method === "eth_getBlockByNumber") v.hash = `0x${"d".repeat(64)}`; return v; }],
  ["matching missing block hashes", /invalid block hash/, (v, c) => { if (c.method === "eth_getBlockByNumber") delete v.hash; return v; }],
  ["wrong block number", /wrong comparison height/, (v, c) => { if (c.method === "eth_getBlockByNumber") v.number = "0x1"; return v; }],
  ["matching missing state", /invalid state quantity/, (v, c) => c.method === "eth_getBalance" ? null : v],
  ["matching malformed bytecode", /invalid EVM bytecode/, (v, c) => c.method === "eth_getCode" ? "0x1" : v],
  ["matching null transactions", /historical transaction is missing/, (v, c) => c.method === "eth_getTransactionByHash" ? null : v],
  ["wrong transaction hash", /transaction hash mismatch/, (v, c) => { if (c.method === "eth_getTransactionByHash") v.hash = blockHash; return v; }],
  ["wrong historical block", /historical block hash mismatch/, (v, c) => { if (c.method === "eth_getTransactionByHash") v.blockHash = txHash; return v; }],
  ["transaction absent from containing block", /does not contain transaction/, (v, c) => { if (c.method === "eth_getTransactionByHash") v.blockNumber = "0x63"; if (c.method === "eth_getBlockByNumber" && c.params[0] === "0x63") v.transactions = []; return v; }],
  ["empty contract bytecode", /nonempty code/, (v, c) => c.method === "eth_getCode" && c.params[0] === contractAddress ? "0x" : v],
  ["missing Faucet build on both aliases", /Faucet build identity missing/, (v, c) => { if (c.kind === "faucet") delete v.build; return v; }],
  ["different Faucet builds", /same build/, (v, c) => { if (c.target && c.kind === "faucet") v.build.commit = "b".repeat(40); return v; }],
  ["missing recovery paths", /recovery path missing/, (v, c) => { if (c.kind === "faucet") delete v.requestStatusPath; return v; }],
  ["missing quota metadata", /rateLimitMax missing or invalid/, (v, c) => { if (c.kind === "faucet") delete v.rateLimitMax; return v; }],
  ["different Faucet quotas", /ipRateLimitMax differs/, (v, c) => { if (c.kind === "faucet" && c.target) v.ipRateLimitMax = 99; return v; }],
  ["wrong Explorer chain", /Explorer chain identity differs/, (v, c) => { if (c.kind === "explorer") v.network.chainId = 1; return v; }],
];
for (const [name, error, mutate] of invalidCases) {
  test(`rejects ${name}`, async () => {
    await assert.rejects(verifyLiveMigration(config, {fetchImpl: fixtureFetch([], mutate), contractAddress, explorer: true}), error);
  });
}

test("request deadline includes a stalled body after successful headers", async () => {
  let cancelled = false;
  let signal;
  const fetchImpl = async (_, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode("{")); }, cancel() { cancelled = true; }}), {headers: {"content-type": "application/json"}});
  };
  await assert.rejects(requestJSON("https://fixture.invalid", {}, fetchImpl, {timeoutMs: 30}), /request\/body timed out/);
  assert.equal(cancelled, true);
  assert.equal(signal.aborted, true);
});

test("request deadline also bounds an uncooperative fetch without retries", async () => {
  let calls = 0;
  await assert.rejects(requestJSON("https://fixture.invalid", {}, () => { calls++; return new Promise(() => {}); }, {timeoutMs: 30}), /timed out/);
  assert.equal(calls, 1);
});

test("JSON reads enforce a streamed byte limit without content-length", async () => {
  await assert.rejects(requestJSON("https://fixture.invalid", {}, async () => jsonResponse({text: "你".repeat(30)}), {maxBytes: 64}), /size limit/);
});

test("JSON reads reject oversized declared length before reading", async () => {
  await assert.rejects(requestJSON("https://fixture.invalid", {}, async () => new Response("{}", {headers: {"content-type": "application/json", "content-length": "1000"}}), {maxBytes: 64}), /size limit/);
});

test("JSON reads reject wrong MIME, invalid JSON and redirects", async () => {
  await assert.rejects(requestJSON("https://fixture.invalid", {}, async () => new Response("{}")), /non-JSON content/);
  await assert.rejects(requestJSON("https://fixture.invalid", {}, async () => new Response("{", {headers: {"content-type": "application/json"}})), /invalid JSON/);
  await assert.rejects(requestJSON("https://fixture.invalid", {}, async (_, options) => {
    assert.equal(options.redirect, "error");
    return Response.redirect("https://fixture.invalid/other");
  }), /HTTP 302/);
});

test("JSON-RPC envelope rejects missing protocol or mismatched response IDs", async () => {
  for (const mutate of [v => { delete v.jsonrpc; }, v => { v.id = "wrong"; }, v => { v.error = null; }]) {
    await assert.rejects(verifyLiveMigration(config, {fetchImpl: async (url, options) => {
      const response = await fixtureFetch([])(url, options);
      const value = await response.json();
      mutate(value);
      return jsonResponse(value);
    }}), /invalid JSON-RPC response/);
  }
});

test("proof flags cannot accidentally trigger network work without --live", () => {
  for (const args of [["--explorer"], ["--contract", contractAddress], ["--transaction"], ["--unknown"], ["--live", "--contract"]]) {
    const result = spawnSync(process.execPath, ["scripts/verify/testnet-endpoint-migration-check.mjs", ...args], {encoding: "utf8", timeout: 2000});
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /proof options require --live|proof argument is missing|usage:/);
  }
});

test("invalid proof inputs and Mainnet activation fail before fetching", async () => {
  const fetchImpl = async () => { assert.fail("must not fetch invalid configuration"); };
  await assert.rejects(verifyLiveMigration(config, {fetchImpl, transactionHash: "0xabc"}), /invalid historical transaction/);
  await assert.rejects(verifyLiveMigration(config, {fetchImpl, contractAddress: "0xabc"}), /invalid contract proof/);
  const modified = structuredClone(config);
  modified.mainnet.enabled = true;
  await assert.rejects(verifyLiveMigration(modified, {fetchImpl}), /Expected values/);
});

test("transport proof requires native history, CORS, block growth and stable depth-two readback", async () => {
  const proof = await verifyLiveMigration(config, {fetchImpl: transportFixture(), transports: true, contractAddress, waitImpl: async ms => assert.equal(ms, 3000)});
  assert.equal(proof.confirmationDepth, 2);
  assert.equal(proof.comparisonHeight, 100);
  assert.equal(proof.transportProof.nativeRestVerified, true);
  assert.equal(proof.transportProof.httpCorsVerified, true);
  assert.equal(proof.transportProof.comparisonStableAcrossGrowth, true);
  assert.ok(!proof.remainingGates.includes("BLOCK_GROWTH_AND_NATIVE_REST"));
  assert.ok(proof.remainingGates.includes("UNCHANGED_GRPC_AND_REQUIRED_WEBSOCKET"));
  assert.equal(proof.publicVerified, false);
});

for (const [name, mutate, error] of [
  ["native chain", (v,c) => { if(c.kind === "status") v.chainId = 1; return v; }, /native REST chain/],
  ["native historical hash", (v,c) => { if(c.kind === "nativeBlock") v.hash = "d".repeat(64); return v; }, /native REST block hash/],
  ["CORS origin", (v,c) => { if(c.kind === "cors") v["access-control-allow-origin"] = "https://untrusted.invalid"; return v; }, /CORS origin/],
  ["CORS method", (v,c) => { if(c.kind === "cors") v["access-control-allow-methods"] = "GET"; return v; }, /CORS POST/],
  ["no block growth", (v,c) => c.method === "eth_blockNumber" ? "0x66" : v, /did not grow/],
  ["comparison reorg", (v,c) => { if(c.method === "eth_getBlockByNumber" && c.grown) v.hash = `0x${"d".repeat(64)}`; return v; }, /comparison block changed/],
]) test(`transport rejects ${name}`, async () => {
  await assert.rejects(verifyLiveMigration(config, {fetchImpl: transportFixture(mutate), transports: true, contractAddress, waitImpl: async () => {}}), error);
});

function transportFixture(mutate = value => value) {
  const tips = new Map();
  const rpc = fixtureFetch([], (value, context) => {
    if (context.method === "eth_blockNumber") {
      const count = (tips.get(context.url) ?? 0) + 1; tips.set(context.url, count);
      value = `0x${((context.target ? 103 : 102) + count - 1).toString(16)}`;
    }
    return mutate(value, {...context, grown: (tips.get(context.url) ?? 0) > 1});
  });
  return async (url, options = {}) => {
    if (options.method === "OPTIONS") return new Response(null, {status: 204, headers: mutate({"access-control-allow-origin": options.headers.origin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Content-Type"}, {kind: "cors"})});
    if (String(url).endsWith("/status")) return jsonResponse(mutate({chainId: 6423, nativeCurrencySymbol: "YNXT", height: 103}, {kind: "status"}));
    if (String(url).includes("/blocks/")) return jsonResponse(mutate({height: 100, hash: blockHash.slice(2), transactions: []}, {kind: "nativeBlock"}));
    return rpc(url, options);
  };
}

function fixtureFetch(calls, mutate = value => value) {
  return async (url, options = {}) => {
    url = String(url);
    const target = url.includes("-testnet");
    if (url.endsWith("/health")) {
      const kind = url.includes("explorer") ? "explorer" : "faucet";
      const context = {kind, target, url};
      calls.push(context);
      const value = kind === "explorer" ? {
        ok: true, indexerOk: true, network: {chainId: 6423}, nativeSymbol: "YNXT",
        indexedHeight: 100, rpcHeight: 101, build: {commit: "a".repeat(40)},
      } : {
        build: {commit: "a".repeat(40)}, chainId: 6423, nativeSymbol: "YNXT", ok: true,
        requestPath: "/request", requestStatusPath: "/request-status", upstreamOk: true,
        fundingReady: true, idempotentRequests: true, defaultAmount: 100, maxAmount: 100,
        rateLimitMax: 1, rateLimitWindowSeconds: 3600, ipRateLimitMax: 100, ipRateLimitWindowSeconds: 60,
      };
      return jsonResponse(mutate(value, context));
    }
    const request = JSON.parse(options.body);
    const context = {method: request.method, params: request.params, url, target};
    calls.push(context);
    const results = {
      eth_blockNumber: target ? "0x67" : "0x66", eth_chainId: "0x1917", net_version: "6423",
      eth_getBalance: "0x123", eth_getCode: "0x6000", eth_getTransactionCount: "0x2",
      eth_getTransactionByHash: {blockHash, hash: txHash, blockNumber: "0x64"},
      eth_getBlockByNumber: {hash: blockHash, number: request.params[0], transactions: [txHash]},
    };
    return jsonResponse({id: request.id, jsonrpc: "2.0", result: mutate(results[request.method], context)});
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {headers: {"content-type": "application/json"}, status: 200});
}
