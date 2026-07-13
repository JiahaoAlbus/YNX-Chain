import assert from "node:assert/strict";
import {after, before, test} from "node:test";
import http from "node:http";
import {YNXClient, YNXSDKError, assertYNXTestnetSnapshot, callYNXEVM, getYNXStatus} from "./index.js";

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
