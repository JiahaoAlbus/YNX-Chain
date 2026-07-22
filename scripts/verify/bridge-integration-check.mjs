import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = read("docs/bridge/consumer-integration-manifest.json");
const vectors = read("docs/bridge/consumer-lifecycle-vectors.json");
const provider = read("docs/bridge/provider-status.json");
const metadata = read("docs/bridge/public-product-metadata.json");
const release = read("docs/bridge/product-release.json");
const sdk = read("sdk/bridge/package.json");
const fail = (message) => { throw new Error(message); };

if (manifest.schemaVersion !== 1 || manifest.currentIntegrationState !== "handoff_only_not_integrated") fail("manifest integration state is invalid");
if (manifest.publicRead.path !== "/bridge/transparency" || manifest.publicRead.deployedPublic !== false) fail("public read boundary is invalid");
if (manifest.routeCatalog.path !== "/bridge/routes" || manifest.routeCatalog.source !== "ynx-bridge-route-registry" || manifest.routeCatalog.quotesExecutable !== false || manifest.routeCatalog.deployedPublic !== false) fail("route catalog boundary is invalid");
if (manifest.assetCatalog.path !== "/bridge/assets" || manifest.assetCatalog.source !== "ynx-bridge-asset-registry" || manifest.assetCatalog.contractMetadataVerified !== false || manifest.assetCatalog.externalExecutionEnabled !== false || manifest.assetCatalog.deployedPublic !== false) fail("asset catalog boundary is invalid");
if (manifest.statusSurface.path !== "/bridge/status" || manifest.statusSurface.source !== "ynx-bridge-status" || manifest.statusSurface.externalBridgeAvailable !== false || manifest.statusSurface.providerConnected !== false || manifest.statusSurface.supportConfigured !== false || manifest.statusSurface.deployedPublic !== false) fail("status surface boundary is invalid");
if (manifest.sdk.path !== "sdk/bridge" || manifest.sdk.package !== "@ynx-chain/bridge-sdk" || manifest.sdk.access !== "public-read-only" || manifest.sdk.acceptsCredentials !== false || manifest.sdk.registryPublished !== false || manifest.sdk.assetAvailableOnlyAt !== "destination_confirmed") fail("Bridge SDK handoff boundary is invalid");
if (sdk.name !== manifest.sdk.package || sdk.version !== manifest.sdk.version || sdk.private !== true) fail("Bridge SDK package state is invalid");
if (manifest.protectedCoordinatorBoundary.consumerCredentialAccess !== false || manifest.protectedCoordinatorBoundary.browserCredentialAccess !== false || manifest.protectedCoordinatorBoundary.walletSecretAccess !== false || manifest.protectedCoordinatorBoundary.centralGatewayIntegrated !== false) fail("protected boundary is invalid");
const expectedConsumers = ["wallet","pay","exchange","dex","finance","explorer","monitor","trust"];
if (manifest.consumers.map(({id}) => id).join(",") !== expectedConsumers.join(",")) fail("consumer set or order is invalid");
const phases = new Set(manifest.lifecycle);
for (const vector of vectors.vectors) {
  if (!phases.has(vector.phase)) fail(`unknown vector phase ${vector.phase}`);
  const confirmed = vector.phase === "destination_confirmed";
  if (vector.assetAvailable !== confirmed || vector.mayPay !== confirmed || vector.mayCreditExchange !== confirmed) fail(`availability overclaim in ${vector.id}`);
}
if (provider.provider !== "Circle" || provider.product !== "CCTP" || provider.ynxListedOnInspectedReference !== false || provider.ynxRouteStatus !== "unavailable" || provider.credentialsPresent !== false || provider.contractsConfigured !== false || provider.testedRemote !== false || provider.deployedPublic !== false) fail("provider status overclaims availability");
if (metadata.canonicalRoute !== "/bridge" || metadata.status !== "local-engineering-candidate" || metadata.downloads.length !== 0 || metadata.supportUrl !== null || metadata.privacyUrl !== null || metadata.securityUrl !== null || metadata.statusUrl !== null) fail("public metadata overclaims release support");
for (const key of ["installedLocal","integratedCentral","deployedStaging","deployedPublic","downloadHosted","productionSigned","storeReleased","externalSubmissionEnabled","officialStablecoinRouteAvailable"]) if (release[key] !== false) fail(`release state ${key} must remain false`);
if (release.sourceCommit !== null || release.sourceCommitRequiredBeforeRelease !== true || release.artifacts.length !== 0 || release.publicUrls.length !== 0 || release.transactionEvidence.length !== 0) fail("release record contains unsupported evidence");
const serialized = JSON.stringify({manifest,vectors,provider,metadata,release});
for (const forbidden of ["Codex", "Worktree", "/Users/", "localhost", "127.0.0.1"]) if (serialized.includes(forbidden)) fail(`public handoff contains forbidden internal value ${forbidden}`);
console.log("bridge integration check passed: eight consumer contracts, read-only unpublished SDK, destination-confirmed availability gate, protected credential boundary, and unavailable CCTP status");
