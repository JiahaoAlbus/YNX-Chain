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
      response.end(JSON.stringify({ok: true, degraded: true, service: "ynx-bridged", schemaVersion: 7, stateMachineVersion: "ynx.bridge.lifecycle.v1", startedAt: "2026-07-25T00:00:00Z", providerStatus: "unavailable-no-verified-provider-connection", providerCount: 1, availableProviderCount: 0, contractStatus: "unavailable-no-verified-contract-deployment", reconciliationStatus: "not-run", liveBridge: false, externalSubmissionEnabled: false, truthfulStatus: "degraded-local-coordinator-only-no-provider-or-contract"}));
      return;
    }
    if (request.url === "/version") {
      response.end(JSON.stringify({service: "ynx-bridged", source: "ynx-bridge-runtime", schemaVersion: 7, stateMachineVersion: "ynx.bridge.lifecycle.v1", startedAt: "2026-07-25T00:00:00Z", asOf: "2026-07-25T00:01:00Z", degraded: true, paused: false, providerStatus: "unavailable-no-verified-provider-connection", providerCount: 1, availableProviderCount: 0, contractStatus: "unavailable-no-verified-contract-deployment", reconciliationStatus: "not-run", lastSuccessfulTransfer: null, lastReconciliation: null, liveBridge: false, externalSubmissionEnabled: false, build: {commit: "test", release: "test", buildTime: "2026-07-25T00:00:00Z"}}));
      return;
    }
    if (request.url === "/bridge/state-machine") {
      const phases = ["quote", "user_review", "source_submitted", "source_accepted", "source_finalized", "proof_attestation_available", "proof_verified", "destination_mint_release_submitted", "destination_mint_release_confirmed", "destination_available", "failed", "retryable", "refund_pending", "refunded", "recovery_required", "disputed", "corrected", "expired", "paused"];
      response.end(JSON.stringify({version: "ynx.bridge.lifecycle.v1", source: "ynx-bridge-runtime", asOf: "2026-07-25T00:01:00Z", states: phases.map((id) => ({id, terminal: ["destination_available", "refunded", "corrected", "expired"].includes(id), destinationAssetAvailable: id === "destination_available", description: `State ${id}`})), transitions: [{from: "destination_mint_release_confirmed", to: "destination_available", condition: "explicit availability observation"}], legacyAliases: {destination_confirmed: "destination_mint_release_confirmed"}}));
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
    if (request.url === "/bridge/providers") {
      response.end(JSON.stringify({schemaVersion: 1, source: "ynx-bridge-provider-registry", asOf: "2026-07-22T00:00:00Z", coverage: "configured-provider-identities-and-routes-only-no-live-provider-session-commercial-rights-or-independent-incident-history", providers: [{id: "provider_route_test", provider: "local-test-provider", product: "not-configured", classification: "external-bridge-adapter", routeId: "route_test", sourceChain: "ethereum-sepolia", destinationChain: "ynx_6423-1", supportedAssets: ["ethereum-sepolia:sepolia-usdc", "ynx_6423-1:ynx-usdc"], sourceContract: null, destinationContract: null, apiVersion: "not-configured", sdkVersion: "not-configured", authentication: "not-applicable-route-unavailable", rateLimit: "unknown-route-unavailable", fees: {status: "unavailable-no-executable-route", currency: null, sourceGas: null, destinationGas: null, providerFee: null, ynxFee: null, hiddenSpread: false}, slippage: {status: "not-applicable-no-executable-route", maximumBps: null}, estimatedTime: {status: "unavailable-no-provider-route", estimatedMinSeconds: null, estimatedMaxSeconds: null}, finality: {sourceConfirmations: 12, destinationRule: null, proofVerification: "local-relayer-attestation-only-not-independent-chain-proof"}, refundPolicy: {available: false, mode: "evidence-recording-only-no-external-refund-execution", sla: null}, recoveryProcess: "record-failure-preserve-evidence-and-require-approved-operator-recovery", limits: {provider: "local-test-provider", classification: "external-bridge-adapter", sourceChain: "ethereum-sepolia", destinationChain: "ynx_6423-1", sourceAsset: "sepolia-usdc", destinationAsset: "ynx-usdc", sourceAssetClass: "testnet-stablecoin", destinationAssetClass: "wrapped-test-asset", assetBoundary: "canonical-to-represented", maxAmount: "1000", maxOutstanding: "2000", externalSubmission: false}, jurisdiction: "not-approved", license: "not-approved", terms: "not-approved", dataRetention: "not-reviewed", dataRights: "not-reviewed", custodyModel: "not-established", securityModel: "configured-local-relayer-threshold-not-provider-security-review", auditStatus: "not-reviewed", incidentHistory: [], incidentHistoryComplete: false, health: "not-connected", lastSuccess: null, lastFailure: null, fallback: "none", decommissionPlan: "disable-route-preserve-transfer-and-audit-evidence-and-publish-unavailable-status", testnetStatus: "unavailable", productionStatus: "unavailable", credentialsConfigured: false, agreementApproved: false, contractsConfigured: false, routeAvailable: false, executable: false, failureStatus: "provider-support-contracts-credentials-agreement-and-funding-unavailable"}]}));
      return;
    }
    if (request.url === "/bridge/assets") {
      response.end(JSON.stringify({schemaVersion: 1, source: "ynx-bridge-asset-registry", asOf: "2026-07-22T00:00:00Z", coverage: "configured-token-allowlist-candidates-not-verified-contracts", assets: [{id: "asset_test", chain: "ethereum-sepolia", asset: "sepolia-usdc", assetClass: "testnet-stablecoin", canonicality: "canonical", symbol: null, decimals: null, contract: null, contractVerified: false, explorerUrl: null, allowlistedForCoordinatorIntent: true, availability: "unavailable", movementModes: ["lock-observation-only-not-executed"], supplyAuthority: "not-configured", reserveEvidence: "operator-reconciliation-reference-only-not-independent-proof", externalExecutionEnabled: false, routeIds: ["route_test"], risk: ["contract address and metadata are not configured"]}]}));
      return;
    }
    if (request.url === "/bridge/status") {
      response.end(JSON.stringify({schemaVersion: 1, source: "ynx-bridge-status", asOf: "2026-07-23T00:00:00Z", coverage: "local-coordinator-and-configured-candidates-not-public-provider-health", coordinatorState: "available-local-coordinator", externalBridgeState: "unavailable", failureStatus: "no-verified-provider-contract-or-public-deployment", paused: false, routeCount: 1, providerCount: 1, availableProviderCount: 0, assetCount: 2, transferCount: 0, openExposureTransferCount: 0, providerConnection: "not-connected", externalSubmissionEnabled: false, userAssetMovementEnabled: false, officialStablecoinRouteAvailable: false, deployedPublic: false, reconciliation: {state: "no-operator-observation", recordCount: 0, latestRecordedAt: null, independentVerification: false, coverage: "operator-submitted-references-not-independent-chain-proof"}, capabilities: {readOnlyEvidence: true, quoteExecution: false, sourceSubmission: false, destinationMintRelease: false, refundExecution: false, disputeRecording: true, emergencyExitExecution: false}, support: {configured: false, supportUrl: null, privacyUrl: null, securityUrl: null, publicStatusUrl: null}, build: {commit: "test", release: "test", buildTime: "2026-07-23T00:00:00Z"}}));
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

test("reads truthful public Bridge health, version, state machine, and transparency without credentials", async () => {
  const client = new YNXBridgeClient({baseURL});
  assert.equal((await client.getHealth()).liveBridge, false);
  assert.equal((await client.getVersion()).degraded, true);
  const stateMachine = await client.getStateMachine();
  assert.equal(stateMachine.states.find((state) => state.id === "destination_mint_release_confirmed").destinationAssetAvailable, false);
  assert.equal(stateMachine.states.find((state) => state.id === "destination_available").destinationAssetAvailable, true);
  const transparency = await client.getTransparency();
  assert.equal(transparency.routes[0].coordinatorOutstanding, "0");
  const routes = await client.getRoutes();
	assert.equal(routes.routes[0].availability, "unavailable");
	assert.equal(routes.routes[0].fees.providerFee, null);
  const providers = await client.getProviders();
  assert.equal(providers.providers[0].routeId, routes.routes[0].id);
  assert.equal(providers.providers[0].health, "not-connected");
  assert.equal(providers.providers[0].incidentHistoryComplete, false);
  assert.equal(providers.providers[0].executable, false);
  const assets = await client.getAssets();
	assert.equal(assets.assets[0].assetClass, "testnet-stablecoin");
	assert.equal(assets.assets[0].contract, null);
  const status = await client.getStatus();
  assert.equal(status.externalBridgeState, "unavailable");
  assert.equal(status.capabilities.refundExecution, false);
  assert.equal(lastHeaders.authorization, undefined);
  assert.equal(lastHeaders["x-ynx-bridge-key"], undefined);
});

test("matches every shared consumer lifecycle availability vector", async () => {
  const updatedAt = "2026-07-22T00:00:00Z";
  const vectors = JSON.parse(await readFile(new URL("../../docs/bridge/consumer-lifecycle-vectors.json", import.meta.url), "utf8"));
  for (const vector of vectors.vectors) {
    const availability = bridgeTransferAvailability({phase: vector.phase, updatedAt, destinationAssetAvailable: vector.destinationAssetAvailable});
    assert.equal(availability.assetAvailable, vector.assetAvailable, vector.id);
    assert.equal(availability.mayPay, vector.mayPay, vector.id);
    assert.equal(availability.mayCreditExchange, vector.mayCreditExchange, vector.id);
    assert.equal(availability.showRecovery, vector.showRecovery, vector.id);
  }
  const confirmed = bridgeTransferAvailability({phase: "destination_mint_release_confirmed", updatedAt, destinationAssetAvailable: false});
  assert.equal(confirmed.assetAvailable, false);
  assert.equal(confirmed.mayPay, false);
  const available = bridgeTransferAvailability({phase: "destination_available", updatedAt, destinationAssetAvailable: true});
  assert.equal(available.assetAvailable, true);
  assert.equal(available.mayPay, true);
  assert.equal(available.coverage, "coordinator-recorded-phase-and-explicit-availability-not-independent-chain-proof");
});

test("fails closed on malformed contracts, insecure origins, and bounded errors", async () => {
  assert.throws(() => new YNXBridgeClient({baseURL: "http://bridge.invalid"}), YNXBridgeSDKError);
  assert.throws(() => bridgeTransferAvailability({phase: "provider_webhook", updatedAt: "2026-07-22T00:00:00Z"}), YNXBridgeSDKError);
  const client = new YNXBridgeClient({baseURL, fetchImpl: async () => new Response(JSON.stringify({ok: true, degraded: false, service: "ynx-bridged", schemaVersion: 7, stateMachineVersion: "ynx.bridge.lifecycle.v1", startedAt: "2026-07-25T00:00:00Z", providerStatus: "connected", providerCount: 1, availableProviderCount: 0, contractStatus: "verified", reconciliationStatus: "current", liveBridge: true, externalSubmissionEnabled: false}), {status: 200, headers: {"content-type": "application/json"}})});
  await assert.rejects(client.getHealth(), /claims live status without external submission/);
	const failing = new YNXBridgeClient({baseURL, fetchImpl: async () => new Response(JSON.stringify({error: "Bridge unavailable"}), {status: 503, headers: {"X-Request-ID": "breq_1", "X-Error-ID": "berr_1"}})});
	await assert.rejects(failing.getHealth(), (error) => error.status === 503 && error.requestId === "breq_1" && error.errorId === "berr_1");
	const overclaimingAsset = new YNXBridgeClient({baseURL, fetchImpl: async () => new Response(JSON.stringify({schemaVersion: 1, source: "ynx-bridge-asset-registry", asOf: "2026-07-22T00:00:00Z", coverage: "configured-token-allowlist-candidates-not-verified-contracts", assets: [{assetClass: "wrapped-test-asset", canonicality: "represented", symbol: "WYNXT", decimals: 18, contract: "0x0000000000000000000000000000000000000001", contractVerified: true, explorerUrl: null, allowlistedForCoordinatorIntent: true, availability: "available", supplyAuthority: "configured", externalExecutionEnabled: true, routeIds: ["route_test"], risk: []}]}), {status: 200, headers: {"content-type": "application/json"}})});
	await assert.rejects(overclaimingAsset.getAssets(), /overclaims asset availability/);
	const overclaimingProvider = new YNXBridgeClient({baseURL, fetchImpl: async () => new Response(JSON.stringify({schemaVersion: 1, source: "ynx-bridge-provider-registry", asOf: "2026-07-22T00:00:00Z", coverage: "configured-provider-identities-and-routes-only-no-live-provider-session-commercial-rights-or-independent-incident-history", providers: [{id: "provider_route_test", provider: "provider", product: "product", classification: "external-bridge-adapter", routeId: "route_test", sourceChain: "chain-a", destinationChain: "chain-b", supportedAssets: ["chain-a:asset-a", "chain-b:asset-b"], sourceContract: "0x1", destinationContract: "0x2", apiVersion: "v1", sdkVersion: "v1", authentication: "api-key", rateLimit: "100", fees: {status: "available", hiddenSpread: false}, slippage: {status: "available"}, estimatedTime: {status: "available"}, finality: {sourceConfirmations: 1, proofVerification: "provider-webhook"}, refundPolicy: {available: true}, recoveryProcess: "provider", limits: {provider: "provider", classification: "external-bridge-adapter", sourceChain: "chain-a", destinationChain: "chain-b", sourceAsset: "asset-a", destinationAsset: "asset-b", sourceAssetClass: "testnet-stablecoin", destinationAssetClass: "wrapped-test-asset", assetBoundary: "canonical-to-represented", maxAmount: "1", maxOutstanding: "1", externalSubmission: true}, jurisdiction: "approved", license: "approved", terms: "approved", dataRetention: "approved", dataRights: "approved", custodyModel: "custodial", securityModel: "provider", auditStatus: "approved", incidentHistory: [], incidentHistoryComplete: true, health: "healthy", lastSuccess: "2026-07-22T00:00:00Z", lastFailure: null, fallback: "provider-b", decommissionPlan: "none", testnetStatus: "available", productionStatus: "available", credentialsConfigured: true, agreementApproved: true, contractsConfigured: true, routeAvailable: true, executable: true, failureStatus: "none"}]}), {status: 200, headers: {"content-type": "application/json"}})});
	await assert.rejects(overclaimingProvider.getProviders(), /overclaims provider readiness/);
	const overclaimingStatus = new YNXBridgeClient({baseURL, fetchImpl: async () => new Response(JSON.stringify({schemaVersion: 1, source: "ynx-bridge-status", asOf: "2026-07-23T00:00:00Z", coverage: "local-coordinator-and-configured-candidates-not-public-provider-health", coordinatorState: "available-local-coordinator", externalBridgeState: "available", paused: false, providerConnection: "connected", externalSubmissionEnabled: true, userAssetMovementEnabled: true, officialStablecoinRouteAvailable: true, deployedPublic: true, reconciliation: {independentVerification: true}, capabilities: {readOnlyEvidence: true, quoteExecution: true, sourceSubmission: true, destinationMintRelease: true, refundExecution: true, disputeRecording: true, emergencyExitExecution: true}, support: {configured: true, supportUrl: "https://invalid.test", privacyUrl: null, securityUrl: null, publicStatusUrl: "https://invalid.test"}}), {status: 200, headers: {"content-type": "application/json"}})});
	await assert.rejects(overclaimingStatus.getStatus(), /overclaims readiness/);
});
