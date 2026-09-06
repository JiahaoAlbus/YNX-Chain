import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../proposals/p0-wallet-connectivity/wallet-protocol/", import.meta.url);
const required = [
  "wallet-transport-contract.json", "eip1193-provider-contract.json", "eip6963-discovery-contract.json", "walletconnect-contract.json",
  "product-session-contract.json", "device-proof-contract.json", "callback-contract.json", "faucet-deeplink-contract.json", "error-contract.json", "client-retirement-contract.json",
];
const vectors = JSON.parse(readFileSync(new URL("CROSS_PLATFORM_CONNECTION_VECTORS.json", root), "utf8"));
const retirementHandoff = JSON.parse(readFileSync(new URL("client-retirement-implementation-handoff.json", root), "utf8"));

test("P0 Wallet protocol candidate contracts remain owner-local, complete and unaccepted", () => {
  assert.deepEqual(required.filter((file) => !readdirSync(root).includes(file)), []);
  for (const file of required) {
    const proposal = JSON.parse(readFileSync(new URL(file, root), "utf8"));
    assert.equal(proposal.status, "CANDIDATE");
    assert.equal(proposal.owner, "wallet-protocol");
    assert.match(proposal.contractVersion, /^\d+\.\d+\.\d+$/);
    assert.equal(proposal.activation, "prohibited until Integration ACCEPTED");
  }
  assert.equal(vectors.status, "CANDIDATE");
  assert.equal(vectors.assertions.standardConnectionGatewayIndependent, true);
  assert.equal(vectors.assertions.productSessionFailurePreservesStandardConnection, true);
  assert.equal(vectors.assertions.noLocalProductSession, true);
});

test("P0 enhanced error contract gives each published error a complete non-offline classification", () => {
  const contract = JSON.parse(readFileSync(new URL("error-contract.json", root), "utf8"));
  assert.equal(contract.errors.length, 26);
  for (const item of contract.errors) {
    assert.deepEqual(Object.keys(item).sort(), [...contract.schema.required].sort());
    assert.equal(typeof item.code, "string"); assert.equal(Number.isInteger(item.httpStatus), true);
    assert.equal(typeof item.retryable, "boolean"); assert.match(item.safeMessage, /\S/);
    assert.notEqual(item.diagnosticClass, "offline");
  }
});

test("client retirement implementation handoff preserves activation and public truth boundaries", () => {
  assert.equal(retirementHandoff.featureSourceCommit, "aff86fc5fb536039ea1eca0e76330bc87d626b44");
  assert.equal(retirementHandoff.supersedesFeatureSourceCommit, "c614501353d7631a6e20da7431ac858c2e5a8868");
  assert.equal(retirementHandoff.status, "IDENTITY_SPLIT_CAPABILITY_CONSUMED_OWNER_RECORDS_REQUIRED");
  assert.equal(retirementHandoff.activation, "prohibited until Integration ACCEPTED");
  assert.equal(retirementHandoff.retiredResponse.httpStatus, 410);
  assert.deepEqual(retirementHandoff.retiredResponse.requiredFields, ["clientId", "replacementURL", "minimumClientVersion", "correlationId"]);
  assert.equal(retirementHandoff.truth.deployedPublic, false);
  assert.equal(retirementHandoff.truth.integratedCentral, false);
  assert.equal(retirementHandoff.truth.currentPublicRuntimeContainsThisFeature, false);
  assert.equal(retirementHandoff.truth.remoteUninstallClaim, false);
  assert.equal(retirementHandoff.integrationAcceptanceRequired.some((item) => item.includes("shares the exact")), true);
  assert.equal(retirementHandoff.centralConsumption.commit, "7329521f7936171ee45bd6f9d89f46ea96b9642e");
  assert.equal(retirementHandoff.centralConsumption.blobReadback, "6/6");
  assert.equal(retirementHandoff.centralConsumption.exactSourceTests.passed, 130);
  assert.equal(retirementHandoff.centralConsumption.executionLeaseIssued, false);
  assert.equal(retirementHandoff.identitySplitCandidate.registryVersion, 3);
  assert.equal(retirementHandoff.identitySplitCandidate.authorizationOrSessionSchemaChanged, false);
  assert.equal(retirementHandoff.tests.passed, 131);
  assert.equal(retirementHandoff.identitySplitCentralConsumption.commit, "0c668adc257046924d4d631e03eb151986910462");
  assert.equal(retirementHandoff.identitySplitCentralConsumption.blobReadback, "7/7");
  assert.equal(retirementHandoff.identitySplitCentralConsumption.executionLeaseIssued, false);
});
