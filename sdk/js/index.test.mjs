import assert from "node:assert/strict";
import {after, before, test} from "node:test";
import http from "node:http";
import {readFile} from "node:fs/promises";
import {YNXClient, YNXSDKError, assertYNXTestnetSnapshot, callYNXEVM, getYNXStatus, normalizeYNXAddress, proveYNXTestnetRPC, toEVMAddress, toYNXAddress, ynxErrorCodes, ynxPublicEndpoints} from "./index.js";

let baseUrl;
let server;

before(async () => {
  server = http.createServer(async (request, response) => {
    if (request.url === "/status") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({chainId: 6423, nativeCurrencySymbol: "YNXT", publicNetwork: true, height: 100}));
      return;
    }
    if (request.url === "/invalid") {
      response.end("not-json");
      return;
    }
    const body = await new Promise((resolve) => {
      let value = "";
      request.on("data", (chunk) => (value += chunk));
      request.on("end", () => resolve(JSON.parse(value)));
    });
    const results = {eth_chainId: "0x1917", eth_blockNumber: "0x64"};
    const payload = body.method === "eth_error"
      ? {jsonrpc: "2.0", id: body.id, error: {code: -32601, message: "unsupported"}}
      : {jsonrpc: "2.0", id: body.id, result: results[body.method]};
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test("reads status and a validated chain snapshot", async () => {
  assert.equal((await getYNXStatus(baseUrl)).height, 100);
  const client = new YNXClient({restUrl: baseUrl, evmUrl: baseUrl});
  const snapshot = assertYNXTestnetSnapshot(await client.getChainSnapshot());
  assert.equal(snapshot.evmBlockNumber, 100);
});

test("surfaces JSON-RPC errors and invalid quantities", async () => {
  await assert.rejects(callYNXEVM(baseUrl, "eth_error"), (error) => error instanceof YNXSDKError && error.code === -32601);
  assert.throws(
    () => assertYNXTestnetSnapshot({status: {chainId: 6423, nativeCurrencySymbol: "YNXT", publicNetwork: true, height: 100}, evmChainId: "0x1917", evmBlockNumber: 1}),
    /height difference/,
  );
});

test("rejects unsupported endpoint protocols", () => {
  assert.throws(() => new YNXClient({restUrl: "file:///tmp/status", evmUrl: baseUrl}), /unsupported endpoint protocol/);
});

test("proves YNX Testnet only over HTTPS and fails closed on the wrong chain", async () => {
  const successFetch = async () => new Response(JSON.stringify({jsonrpc: "2.0", id: 1, result: "0x1917"}), {status: 200});
  assert.deepEqual(await proveYNXTestnetRPC("https://rpc.example.invalid", {fetchImpl: successFetch}), {
    chainId: "0x1917", connected: true, network: "YNX Testnet", rpc: "https://rpc.example.invalid/",
  });
  await assert.rejects(proveYNXTestnetRPC("http://127.0.0.1:1"), (error) => error instanceof YNXSDKError && error.code === "RPC_HTTPS_REQUIRED");
  await assert.rejects(proveYNXTestnetRPC("https://user@example.invalid"), (error) => error instanceof YNXSDKError && error.code === "RPC_HTTPS_REQUIRED");
  const wrongChainFetch = async () => new Response(JSON.stringify({jsonrpc: "2.0", id: 1, result: "0x1"}), {status: 200});
  await assert.rejects(proveYNXTestnetRPC("https://rpc.example.invalid", {fetchImpl: wrongChainFetch}), (error) => error instanceof YNXSDKError && error.code === ynxErrorCodes.wrongChain);
  const unavailableFetch = async () => { throw new Error("unreachable"); };
  await assert.rejects(proveYNXTestnetRPC("https://rpc.example.invalid", {fetchImpl: unavailableFetch}), (error) => error instanceof YNXSDKError && error.code === ynxErrorCodes.rpcUnavailable);
});

test("keeps authoritative account absence distinct from transport and HTTP failures", async () => {
  const accountMissing = async () => new Response(JSON.stringify({code: "ACCOUNT_NOT_FOUND", message: "account not found"}), {status: 404});
  await assert.rejects(getYNXStatus("https://rest.example.invalid", {fetchImpl: accountMissing}), (error) => error instanceof YNXSDKError && error.status === 404 && error.code === ynxErrorCodes.accountNotFound);

  const unrelated404 = async () => new Response(JSON.stringify({error: "route not found"}), {status: 404});
  await assert.rejects(getYNXStatus("https://rest.example.invalid", {fetchImpl: unrelated404}), (error) => error instanceof YNXSDKError && error.status === 404 && error.code === ynxErrorCodes.httpError);

  const unavailable = async () => new Response(JSON.stringify({error: "temporarily unavailable"}), {status: 503});
  await assert.rejects(getYNXStatus("https://rest.example.invalid", {fetchImpl: unavailable}), (error) => error instanceof YNXSDKError && error.code === ynxErrorCodes.rpcUnavailable);
});

test("classifies timeout, TLS and malformed responses without inventing network state", async () => {
  const timeout = async () => { throw Object.assign(new Error("deadline"), {name: "AbortError"}); };
  await assert.rejects(getYNXStatus("https://rest.example.invalid", {fetchImpl: timeout}), (error) => error instanceof YNXSDKError && error.code === ynxErrorCodes.transportTimeout);

  const wrappedTimeout = async () => { throw new TypeError("fetch failed", {cause: Object.assign(new Error("Connect Timeout Error"), {code: "UND_ERR_CONNECT_TIMEOUT"})}); };
  await assert.rejects(getYNXStatus("https://rest.example.invalid", {fetchImpl: wrappedTimeout}), (error) => error instanceof YNXSDKError && error.code === ynxErrorCodes.transportTimeout);

  const tls = async () => { throw new TypeError("fetch failed", {cause: Object.assign(new Error("certificate verify failed"), {code: "CERT_HAS_EXPIRED"})}); };
  await assert.rejects(getYNXStatus("https://rest.example.invalid", {fetchImpl: tls}), (error) => error instanceof YNXSDKError && error.code === ynxErrorCodes.transportTLS);

  const malformed = async () => new Response("not-json", {status: 200});
  await assert.rejects(getYNXStatus("https://rest.example.invalid", {fetchImpl: malformed}), (error) => error instanceof YNXSDKError && error.code === ynxErrorCodes.malformedResponse);
});

test("consumes the immutable Central public endpoint matrix without promoting unavailable services", async () => {
  assert.equal(ynxPublicEndpoints.rpcUrl, "https://rpc.ynxweb4.com/evm");
  assert.equal(ynxPublicEndpoints.walletCallbackUrl, null);
  assert.equal(ynxPublicEndpoints.allRequiredServicesAvailable, false);
  assert.equal(ynxPublicEndpoints.allRequiredServicesCorsReady, false);
  assert.equal(ynxPublicEndpoints.integratedCentral, false);
  let requested;
  const fetchImpl = async (url) => {
    requested = String(url);
    return new Response(JSON.stringify({jsonrpc: "2.0", id: 1, result: "0x1917"}), {status: 200});
  };
  assert.equal((await proveYNXTestnetRPC(undefined, {fetchImpl})).chainId, "0x1917");
  assert.equal(requested, "https://rpc.ynxweb4.com/evm");
});

test("converts shared YNX address vectors", async () => {
  const vectors = JSON.parse(await readFile(new URL("../../testdata/address-vectors.json", import.meta.url), "utf8"));
  for (const vector of vectors) {
    assert.equal(toYNXAddress(vector.hex), vector.bech32);
    assert.equal(toEVMAddress(vector.bech32), vector.hex);
    assert.deepEqual(normalizeYNXAddress(vector.bech32), {evmAddress: vector.hex, ynxAddress: vector.bech32});
  }
});

test("rejects malformed YNX addresses", () => {
  const valid = toYNXAddress("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
  for (const value of ["0x1234", `Y${valid.slice(1)}`, `${valid.slice(0, -1)}q`, `eth${valid.slice(3)}`]) {
    assert.throws(() => toEVMAddress(value), YNXSDKError);
  }
});
