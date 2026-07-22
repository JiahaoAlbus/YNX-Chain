import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import http from "node:http";
import {after, before, test} from "node:test";
import {YNXBridgeClient, YNXBridgeSDKError, bridgeTransferAvailability} from "./index.js";

let baseURL;
let server;
let lastHeaders;

before(async () => {
  server = http.createServer((request, response) => {
    lastHeaders = request.headers;
    response.setHeader("content-type", "application/json");
    response.setHeader("X-Request-ID", "breq_sdk_test_001");
    if (request.url === "/health") {
      response.end(JSON.stringify({ok: true, service: "ynx-bridged", liveBridge: false, externalSubmissionEnabled: false, truthfulStatus: "local-coordinator-only-no-external-submission"}));
      return;
    }
    if (request.url === "/bridge/transparency") {
      response.end(JSON.stringify({schemaVersion: 1, source: "ynx-bridge-coordinator", asOf: "2026-07-22T00:00:00Z", coverage: "coordinator-state-plus-operator-reconciliation-references", liveBridge: false, externalSubmissionEnabled: false, routes: [{route: {provider: "local-test-provider", sourceChain: "ethereum-sepolia", destinationChain: "ynx_6423-1", sourceAsset: "sepolia-usdc", destinationAsset: "ynx-usdc", assetBoundary: "canonical-to-represented", maxAmount: "1000", maxOutstanding: "2000", externalSubmission: false}, coordinatorOutstanding: "0"}]}));
      return;
    }
    if (request.url === "/invalid-live") {
      response.end(JSON.stringify({ok: true, service: "ynx-bridged", liveBridge: true, externalSubmissionEnabled: false}));
      return;
    }
    response.statusCode = 503;
    response.setHeader("X-Error-ID", "berr_sdk_test_001");
    response.end(JSON.stringify({error: "Bridge unavailable"}));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test("reads truthful public Bridge health and transparency without credentials", async () => {
  const client = new YNXBridgeClient({baseURL});
  assert.equal((await client.getHealth()).liveBridge, false);
  const transparency = await client.getTransparency();
  assert.equal(transparency.routes[0].coordinatorOutstanding, "0");
  assert.equal(lastHeaders.authorization, undefined);
  assert.equal(lastHeaders["x-ynx-bridge-key"], undefined);
});

test("matches every shared consumer lifecycle availability vector", async () => {
  const updatedAt = "2026-07-22T00:00:00Z";
  const vectors = JSON.parse(await readFile(new URL("../../docs/bridge/consumer-lifecycle-vectors.json", import.meta.url), "utf8"));
  for (const vector of vectors.vectors) {
    const availability = bridgeTransferAvailability({phase: vector.phase, updatedAt});
    assert.equal(availability.assetAvailable, vector.assetAvailable, vector.id);
    assert.equal(availability.mayPay, vector.mayPay, vector.id);
    assert.equal(availability.mayCreditExchange, vector.mayCreditExchange, vector.id);
    assert.equal(availability.showRecovery, vector.showRecovery, vector.id);
  }
  const confirmed = bridgeTransferAvailability({phase: "destination_confirmed", updatedAt});
  assert.equal(confirmed.assetAvailable, true);
  assert.equal(confirmed.mayPay, true);
  assert.equal(confirmed.coverage, "coordinator-recorded-phase-not-independent-chain-proof");
});

test("fails closed on malformed contracts, insecure origins, and bounded errors", async () => {
  assert.throws(() => new YNXBridgeClient({baseURL: "http://bridge.invalid"}), YNXBridgeSDKError);
  assert.throws(() => bridgeTransferAvailability({phase: "provider_webhook", updatedAt: "2026-07-22T00:00:00Z"}), YNXBridgeSDKError);
  const client = new YNXBridgeClient({baseURL, fetchImpl: async () => new Response(JSON.stringify({ok: true, service: "ynx-bridged", liveBridge: true, externalSubmissionEnabled: false}), {status: 200, headers: {"content-type": "application/json"}})});
  await assert.rejects(client.getHealth(), /claims live status without external submission/);
  const failing = new YNXBridgeClient({baseURL, fetchImpl: async () => new Response(JSON.stringify({error: "Bridge unavailable"}), {status: 503, headers: {"X-Request-ID": "breq_1", "X-Error-ID": "berr_1"}})});
  await assert.rejects(failing.getHealth(), (error) => error.status === 503 && error.requestId === "breq_1" && error.errorId === "berr_1");
});
