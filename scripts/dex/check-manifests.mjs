import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const address = /^0x[0-9a-fA-F]{40}$/;
const gitCommit = /^[0-9a-f]{40}$/;
const load = async (relativePath) =>
  JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));

const release = await load("../../product-release.json");
for (const key of [
  "productId",
  "name",
  "branch",
  "commit",
  "commitRole",
  "runtimeCommit",
  "evidenceCheckpointCommit",
  "version",
  "surfaces",
  "implementedLocal",
  "testedLocal",
  "installedLocal",
  "integratedCentral",
  "deployedStaging",
  "deployedPublic",
  "downloadHosted",
  "productionSigned",
  "storeReleased",
  "publicUrls",
  "healthUrls",
  "artifactUrls",
  "sha256",
  "bytes",
  "signingClass",
  "minOS",
  "installEvidence",
  "centralIntegration",
  "knownLimitations",
  "generatedAt",
]) {
  assert(Object.hasOwn(release, key), `missing release field ${key}`);
}
assert.equal(release.productId, "ynx-dex");
assert.equal(release.branch, "codex/final-dex");
assert.equal(release.commitRole, "consensus-v13-web-wallet-source-base");
assert(gitCommit.test(release.commit), "commit must be exact Git SHA");
assert(
  gitCommit.test(release.runtimeCommit),
  "runtimeCommit must be exact Git SHA",
);
assert(
  gitCommit.test(release.evidenceCheckpointCommit),
  "evidenceCheckpointCommit must be exact Git SHA",
);
assert.equal(
  release.commit,
  release.runtimeCommit,
  "packaged web and consensus v13 runtime use one source checkpoint",
);
assert.equal(release.implementedLocal, true);
assert.equal(release.testedLocal, true);
assert.equal(release.recoveredCandidate?.implementedLocal, true);
assert.equal(release.recoveredCandidate?.testedLocal, true);

const components = release.localComponents;
assert.equal(components.consensusDexV13.sourceCommit, release.commit);
assert.equal(components.consensusDexV13.implementedLocal, true);
assert.equal(components.consensusDexV13.testedLocal, true);
assert.equal(components.consensusDexV13.integratedCentral, false);
assert.equal(components.consensusDexV13.deployedPublic, false);
assert(gitCommit.test(components?.strategyVault?.sourceCommit));
assert.equal(components.strategyVault.implementedLocal, true);
assert.equal(components.strategyVault.testedLocal, true);
assert.equal(components.strategyVault.deployedPublic, false);
assert.equal(components.executionAdapter.sourceCommit, release.commit);
assert.equal(components.executionAdapter.implementedLocal, true);
assert.equal(components.executionAdapter.testedLocal, true);
assert.equal(components.executionAdapter.integratedCentral, false);
assert.equal(components.vaultIndexer.sourceCommit, release.runtimeCommit);
assert.equal(components.vaultIndexer.implementedLocal, true);
assert.equal(components.vaultIndexer.testedLocal, true);
assert.equal(components.vaultIndexer.deployedPublic, false);
assert.equal(components.indexerRecovery.sourceCommit, release.runtimeCommit);
assert.equal(components.indexerRecovery.implementedLocal, true);
assert.equal(components.indexerRecovery.testedLocal, true);
assert.equal(components.indexerRecovery.restoreVerified, true);
assert.equal(components.indexerRecovery.operationalRpoVerified, false);
assert.equal(components.indexerRecovery.deployedPublic, false);
for (const name of ["fairFlow", "lpProtection", "stableSwap"]) {
  assert.equal(components[name].sourceCommit, release.commit);
  assert.equal(components[name].implementedLocal, true);
  assert.equal(components[name].testedLocal, true);
  assert.equal(components[name].indexedLocal, true);
  assert.equal(components[name].integratedCentral, false);
  assert.equal(components[name].deployedPublic, false);
}
assert.equal(release.integratedCentral, false);
assert.equal(release.deployedPublic, false);
assert.equal(release.productionSigned, false);
assert.equal(release.storeReleased, false);

const wallet = await load("../../apps/dex/wallet-client.json");
assert.deepEqual(
  Object.keys(wallet).sort(),
  [
    "bundleId",
    "callbacks",
    "integrationStatus",
    "maxScopes",
    "productClientId",
    "productDeviceAlgorithms",
    "requestingProduct",
    "schemaVersion",
    "scopes",
  ].sort(),
);
assert.equal(wallet.schemaVersion, 2);
assert.equal(wallet.productClientId, "ynx-dex-web-v1");
assert.equal(wallet.bundleId, "com.ynxweb4.dex.web");
assert.deepEqual(wallet.scopes, [
  "account:read",
  "dex:positions:read",
  "dex:transaction:request",
]);
assert.equal(wallet.maxScopes, 3);
assert.equal(wallet.integrationStatus, "approved-client-contract; public-wallet-release-validation-required");

const sdk = await load("../../sdk/dex/package.json");
for (const field of [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]) {
  assert.equal(
    sdk[field],
    undefined,
    `SDK ${field} must remain absent or gain an independently audited lockfile policy`,
  );
}

const integration = await load("../../dex/ynx-testnet.integration.json");
assert.equal(integration.network.chainId, 6423);
assert.equal(integration.indexing.stateSchemaVersion, 5);
assert.equal(integration.indexing.cursorSchemaVersion, 6);
assert.match(
  integration.indexing.fairFlowIndexerStatus,
  /implemented and tested locally/,
);
assert.match(
  integration.indexing.lpProtectionIndexerStatus,
  /implemented and tested locally/,
);
assert.equal(
  integration.indexing.lpProtectionAddressEnv,
  "DEX_LP_PROTECTION_ADDRESS",
);
assert.equal(
  integration.indexing.stableFactoryAddressEnv,
  "DEX_STABLE_FACTORY_ADDRESS",
);
assert.match(
  integration.indexing.stableIndexerStatus,
  /implemented and tested locally/,
);
for (const field of [
  "wrappedYNXT",
  "factory",
  "router",
  "quoter",
  "stableFactory",
  "stableRouter",
  "stableQuoter",
  "strategyVault",
  "fairFlow",
  "lpProtection",
  "lpProtectionOracle",
  "multicall",
]) {
  assert(integration.deployments[field], `missing ${field}`);
}
for (const value of Object.values(integration.deployments)) {
  if (value.address) assert(address.test(value.address));
}

const integrationContract = await load(
  "../../release/integration/ynx-dex-contract.json",
);
assert.equal(integrationContract.productId, "ynx-dex");
assert.equal(integrationContract.sourceCommit, release.runtimeCommit);
assert.equal(integrationContract.network.chainId, 6423);
assert.equal(integrationContract.network.deploymentStatus, "not-deployed");
assert.equal(integrationContract.migration.stateSchemaVersion, 13);
assert.equal(integrationContract.migration.cursorSchemaVersion, 6);
assert.equal(integrationContract.releaseStatus.implementedLocal, true);
assert.equal(integrationContract.releaseStatus.testedLocal, true);
assert.equal(integrationContract.releaseStatus.integratedCentral, false);
assert.equal(integrationContract.releaseStatus.deployedPublic, false);
assert.equal(integrationContract.releaseStatus.productionSigned, false);

const publicMetadata = await load("../../public-product-metadata.json");
assert.equal(publicMetadata.productId, "ynx-dex");
assert.equal(publicMetadata.sourceCommit, release.runtimeCommit);
assert.equal(publicMetadata.artifactSourceCommit, release.commit);
assert.equal(
  publicMetadata.evidenceCheckpointCommit,
  release.evidenceCheckpointCommit,
);
for (const key of [
  "integratedCentral",
  "testnetVerified",
  "websitePublished",
  "deployedPublic",
  "downloadHosted",
  "productionSigned",
  "audited",
  "mainnet",
]) {
  assert.equal(
    publicMetadata.status[key],
    false,
    `public metadata ${key} must remain false without evidence`,
  );
}
assert.equal(publicMetadata.urls.product, null);
assert.equal(publicMetadata.urls.runtime, null);
assert.equal(publicMetadata.urls.download, null);

const operatorInputs = await load("../../release/operator-inputs.request.json");
assert.equal(operatorInputs.productId, "ynx-dex");
assert.equal(operatorInputs.runtimeSourceCommit, release.runtimeCommit);
assert.equal(operatorInputs.network.chainId, 6423);
assert.equal(operatorInputs.network.mainnet, false);
assert.equal(operatorInputs.secretHandling.acceptSecretsInChat, false);
assert.equal(
  operatorInputs.secretHandling.acceptPrivateKeysInRepository,
  false,
);
assert(
  operatorInputs.requests.length >= 5,
  "operator input request must retain all current owner gates",
);

console.log("YNX DEX manifests: PASS");
