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
      response.end(JSON.stringify({schemaVersion: 1, source: "ynx-bridge-coordinator", asOf: "2026-07-22T00:00:00Z", coverage: "coordinator-state-plus-operator-reconciliation-references", liveBridge: false, externalSubmissionEnabled: false, routes: [{route: {provider: "local-test-provider", classification: "external-bridge-adapter", sourceChain: "ethereum-sepolia", destinationChain: "ynx_6423-1", sourceAsset: "sepolia-usdc", destinationAsset: "ynx-usdc", sourceAssetClass: "testnet-stablecoin", destinationAssetClass: "wrapped-test-asset", assetBoundary: "canonical-to-represented", maxAmount: "1000", maxOutstanding: "2000", externalSubmission: false}, coordinatorOutstanding: "0"}]}));
      return;
    }
    if (request.url === "/bridge/routes") {
      response.end(JSON.stringify({schemaVersion: 1, source: "ynx-bridge-route-registry", asOf: "2026-07-22T00:00:00Z", coverage: "configured-fail-closed-candidates-not-live-provider-quotes", routes: [{id: "route_test", provider: "local-test-provider", classification: "external-bridge-adapter", availability: "unavailable", failureStatus: "provider-or-contract-route-unavailable", providerHealth: "not-connected", source: {chain: "ethereum-sepolia", asset: "sepolia-usdc", assetClass: "testnet-stablecoin", symbol: null, decimals: null, contract: null, contractVerified: false, explorerUrl: null}, destination: {chain: "ynx_6423-1", asset: "ynx-usdc", assetClass: "wrapped-test-asset", symbol: null, decimals: null, contract: null, contractVerified: false, explorerUrl: null}, fees: {status: "unavailable-no-executable-route", currency: null, sourceGas: null, destinationGas: null, providerFee: null, ynxFee: null, hiddenSpread: false}, slippage: {status: "not-applicable-no-executable-route", maximumBps: null}, timing: {status: "unavailable-no-provider-route", estimatedMinSeconds: null, estimatedMaxSeconds: null}, finality: {sourceConfirmations: 12, destinationRule: null, proofVerification: "local-relayer-attestation-only-not-independent-chain-proof"}, refund: {available: false, mode: "evidence-recording-only-no-external-refund-execution", sla: null}, risk: ["provider support is not verified"], limits: {provider: "local-test-provider", classification: "external-bridge-adapter", sourceChain: "ethereum-sepolia", destinationChain: "ynx_6423-1", sourceAsset: "sepolia-usdc", destinationAsset: "ynx-usdc", sourceAssetClass: "testnet-stablecoin", destinationAssetClass: "wrapped-test-asset", assetBoundary: "canonical-to-represented", maxAmount: "1000", maxOutstanding: "2000", externalSubmission: false}, executable: false, externalSubmissionEnabled: false, userSigning: "canonical-wallet-required", credentialBoundary: "browser-and-consumers-have-no-bridge-or-provider-secret"}]}));
      return;
    }
    if (request.url === "/bridge/assets") {
      response.end(JSON.stringify({schemaVersion: 1, source: "ynx-bridge-asset-registry", asOf: "2026-07-22T00:00:00Z", coverage: "configured-token-allowlist-candidates-not-verified-contracts", assets: [{id: "asset_test", chain: "ethereum-sepolia", asset: "sepolia-usdc", assetClass: "testnet-stablecoin", canonicality: "canonical", symbol: null, decimals: null, contract: null, contractVerified: false, explorerUrl: null, allowlistedForCoordinatorIntent: true, availability: "unavailable", movementModes: ["lock-observation-only-not-executed"], supplyAuthority: "not-configured", reserveEvidence: "operator-reconciliation-reference-only-not-independent-proof", externalExecutionEnabled: false, routeIds: ["route_test"], risk: ["contract address and metadata are not configured"]}]}));
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
  const routes = await client.getRoutes();
	assert.equal(routes.routes[0].availability, "unavailable");
	assert.equal(routes.routes[0].fees.providerFee, null);
  const assets = await client.getAssets();
  assert.equal(assets.assets[0].assetClass, "testnet-stablecoin");
  assert.equal(assets.assets[0].contract, null);
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
	const overclaimingAsset = new YNXBridgeClient({baseURL, fetchImpl: async () => new Response(JSON.stringify({schemaVersion: 1, source: "ynx-bridge-asset-registry", asOf: "2026-07-22T00:00:00Z", coverage: "configured-token-allowlist-candidates-not-verified-contracts", assets: [{assetClass: "wrapped-test-asset", canonicality: "represented", symbol: "WYNXT", decimals: 18, contract: "0x0000000000000000000000000000000000000001", contractVerified: true, explorerUrl: null, allowlistedForCoordinatorIntent: true, availability: "available", supplyAuthority: "configured", externalExecutionEnabled: true, routeIds: ["route_test"], risk: []}]}), {status: 200, headers: {"content-type": "application/json"}})});
	await assert.rejects(overclaimingAsset.getAssets(), /overclaims asset availability/);
});
