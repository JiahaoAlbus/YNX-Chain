import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = read("docs/bridge/consumer-integration-manifest.json");
const vectors = read("docs/bridge/consumer-lifecycle-vectors.json");
const crossProduct = read("docs/integration/CROSS_PRODUCT_TEST_VECTORS.json");
const integration = read("release/integration/ynx-bridge-contract.json");
const provider = read("docs/bridge/provider-status.json");
const metadata = read("docs/bridge/public-product-metadata.json");
const release = read("docs/bridge/product-release.json");
const sdk = read("sdk/bridge/package.json");
const fail = (message) => { throw new Error(message); };
const commitPattern = /^[0-9a-f]{40}$/;
const expectedStateMachine = "ynx.bridge.lifecycle.v1";
const expectedPhases = [
  "quote", "user_review", "source_submitted", "source_accepted", "source_finalized",
  "proof_attestation_available", "proof_verified", "destination_mint_release_submitted",
  "destination_mint_release_confirmed", "destination_available", "failed", "retryable",
  "refund_pending", "refunded", "recovery_required", "disputed", "corrected", "expired", "paused",
];

if (manifest.schemaVersion !== 2 || manifest.runtimeSchemaVersion !== 7 || manifest.stateMachineVersion !== expectedStateMachine || manifest.currentIntegrationState !== "handoff_only_not_integrated" || !commitPattern.test(manifest.sourceCommit)) fail("manifest integration state is invalid");
if (manifest.runtimeTruth.liveBridge !== false || manifest.runtimeTruth.externalSubmissionEnabled !== false || manifest.runtimeTruth.deployedPublic !== false || !manifest.runtimeTruth.providerStatus.startsWith("unavailable") || !manifest.runtimeTruth.contractStatus.startsWith("unavailable")) fail("runtime truth overclaims Bridge availability");
const publicRead = manifest.publicRead;
for (const [name, path, source] of [
  ["health", "/health", "ynx-bridge-runtime"],
  ["version", "/version", "ynx-bridge-runtime"],
  ["stateMachine", "/bridge/state-machine", "ynx-bridge-runtime"],
  ["transparency", "/bridge/transparency", "ynx-bridge-coordinator"],
  ["routes", "/bridge/routes", "ynx-bridge-route-registry"],
  ["providers", "/bridge/providers", "ynx-bridge-provider-registry"],
  ["assets", "/bridge/assets", "ynx-bridge-asset-registry"],
  ["status", "/bridge/status", "ynx-bridge-status"],
]) {
  if (publicRead[name]?.path !== path || publicRead[name]?.source !== source || publicRead[name]?.deployedPublic !== false) fail(`public ${name} boundary is invalid`);
}
if (publicRead.routes.quotesExecutable !== false || publicRead.providers.credentialsConfigured !== false || publicRead.providers.agreementApproved !== false || publicRead.providers.contractsConfigured !== false || publicRead.providers.routeAvailable !== false || publicRead.assets.contractMetadataVerified !== false || publicRead.assets.externalExecutionEnabled !== false || publicRead.status.externalBridgeAvailable !== false || publicRead.status.providerConnected !== false) fail("public registry/status boundary overclaims execution");
if (manifest.sdk.path !== "sdk/bridge" || manifest.sdk.package !== "@ynx-chain/bridge-sdk" || manifest.sdk.version !== "0.3.0" || manifest.sdk.access !== "public-read-only" || manifest.sdk.acceptsCredentials !== false || manifest.sdk.registryPublished !== false || manifest.sdk.assetAvailableOnlyAt !== "destination_available" || manifest.sdk.availabilityRequiresExplicitFlag !== true) fail("Bridge SDK handoff boundary is invalid");
if (sdk.name !== manifest.sdk.package || sdk.version !== manifest.sdk.version || sdk.private !== true || sdk.types !== "./index.d.ts" || !sdk.files.includes("index.d.ts") || sdk.exports?.["."]?.types !== "./index.d.ts") fail("Bridge SDK package state is invalid");
if (manifest.protectedRuntime.consumerCredentialAccess !== false || manifest.protectedRuntime.browserCredentialAccess !== false || manifest.protectedRuntime.walletSecretAccess !== false || manifest.protectedRuntime.centralGatewayIntegrated !== false || manifest.protectedRuntime.proofVerification.path !== "/bridge/transfers/{id}/proof-verification" || manifest.protectedRuntime.proofVerification.browserAccessible !== false) fail("protected runtime boundary is invalid");
const expectedConsumers = ["wallet","pay","exchange","dex","finance","explorer","monitor","trust"];
if (manifest.consumers.map(({id}) => id).join(",") !== expectedConsumers.join(",")) fail("consumer set or order is invalid");
if (manifest.lifecycle.join(",") !== expectedPhases.join(",")) fail("manifest lifecycle is not the frozen v1 state machine");

if (vectors.schemaVersion !== 2 || vectors.stateMachineVersion !== expectedStateMachine || vectors.sourceCommit !== manifest.sourceCommit || vectors.vectors.length !== expectedPhases.length) fail("consumer lifecycle vector envelope is invalid");
const phases = new Set(manifest.lifecycle);
for (const vector of vectors.vectors) {
  if (!phases.has(vector.phase)) fail(`unknown vector phase ${vector.phase}`);
  const available = vector.phase === "destination_available" && vector.destinationAssetAvailable === true;
  if (vector.assetAvailable !== available || vector.mayPay !== available || vector.mayCreditExchange !== available) fail(`availability overclaim in ${vector.id}`);
}
const confirmedVector = vectors.vectors.find(({phase}) => phase === "destination_mint_release_confirmed");
const availableVector = vectors.vectors.find(({phase}) => phase === "destination_available");
if (!confirmedVector || confirmedVector.assetAvailable !== false || !availableVector || availableVector.assetAvailable !== true) fail("destination confirmation/availability boundary is missing");

if (integration.contractId !== "ynx.bridge.integration.v1" || integration.owner !== "21-bridge" || integration.sourceCommit !== manifest.sourceCommit || integration.runtimeSchemaVersion !== 7 || integration.stateMachineVersion !== expectedStateMachine || integration.states.join(",") !== expectedPhases.join(",")) fail("frozen Integration Contract is invalid");
const integrationProviderEndpoint = integration.publicReadEndpoints.find(({path}) => path === "/bridge/providers");
if (integrationProviderEndpoint?.method !== "GET" || integrationProviderEndpoint?.source !== "ynx-bridge-provider-registry") fail("frozen Integration Contract is missing the Provider Registry endpoint");
const integrationQuoteEndpoint = integration.protectedEndpoints.find(({path}) => path === "/bridge/quotes");
if (integrationQuoteEndpoint?.method !== "POST" || integrationQuoteEndpoint?.scope !== "bridge:quote:read" || integrationQuoteEndpoint?.idempotencyRequired !== false) fail("frozen Integration Contract is missing the protected Quote Runtime endpoint");
const integrationReviewEndpoint = integration.protectedEndpoints.find(({path}) => path === "/bridge/wallet-reviews");
if (integrationReviewEndpoint?.method !== "POST" || integrationReviewEndpoint?.scope !== "bridge:review:create" || integrationReviewEndpoint?.idempotencyRequired !== false) fail("frozen Integration Contract is missing the Wallet Review Runtime endpoint");
if (integration.availabilityInvariant.assetAvailableOnlyAt !== "destination_available" || integration.availabilityInvariant.explicitFlagRequired !== true || integration.availabilityInvariant.destinationConfirmationIsAvailability !== false || integration.availabilityInvariant.providerWebhookIsFinality !== false) fail("Integration availability invariant is invalid");
if (integration.proofContract.implementedType !== "threshold-relayer-attestation" || integration.proofContract.lightClientProof !== "unsupported" || integration.proofContract.canonicalBridgeClaim !== false) fail("proof positioning overclaims canonical verification");
if (integration.dependencies.some(({accepted}) => accepted !== false)) fail("a dependency is marked accepted without evidence");
for (const key of ["installedLocal","integratedCentral","deployedStaging","deployedPublic","downloadHosted","productionSigned","storeReleased"]) if (integration.releaseState[key] !== false) fail(`Integration release state ${key} must remain false`);

if (crossProduct.contractId !== integration.contractId || crossProduct.sourceCommit !== integration.sourceCommit || crossProduct.stateMachineVersion !== expectedStateMachine || crossProduct.vectors.length < 10) fail("cross-product vector envelope is invalid");
const byId = new Map(crossProduct.vectors.map((vector) => [vector.id, vector]));
if (byId.get("bridge-destination-confirmed-not-available")?.expected?.assetAvailable !== false || byId.get("bridge-destination-available-explicit")?.expected?.assetAvailable !== true || byId.get("bridge-destination-available-without-flag-fails-closed")?.expected?.assetAvailable !== false || byId.get("bridge-proof-digest-tamper")?.expected?.verification !== "rejected") fail("cross-product fail-closed vectors are incomplete");

if (provider.provider !== "Circle" || provider.product !== "CCTP" || provider.ynxListedOnInspectedReference !== false || provider.ynxRouteStatus !== "unavailable" || provider.credentialsPresent !== false || provider.contractsConfigured !== false || provider.testedRemote !== false || provider.deployedPublic !== false) fail("provider status overclaims availability");
if (metadata.canonicalRoute !== "/bridge" || metadata.status !== "local-engineering-candidate" || metadata.downloads.length !== 0 || metadata.supportUrl !== null || metadata.privacyUrl !== null || metadata.securityUrl !== null || metadata.statusUrl !== null) fail("public metadata overclaims release support");
for (const key of ["installedLocal","integratedCentral","deployedStaging","deployedPublic","downloadHosted","productionSigned","storeReleased","externalSubmissionEnabled","officialStablecoinRouteAvailable","providerConnected","contractsVerified","publicTestnetDepositVerified","publicTestnetWithdrawalVerified"]) if (release[key] !== false) fail(`release state ${key} must remain false`);
if (release.schemaVersion !== 2 || release.sourceCommit !== manifest.sourceCommit || release.runtimeSchemaVersion !== 7 || release.stateMachineVersion !== expectedStateMachine || release.sdkVersion !== sdk.version || release.sourceCommitRequiredBeforeRelease !== true || release.artifacts.length !== 0 || release.publicUrls.length !== 0 || release.transactionEvidence.length !== 0 || release.proofVerification.lightClientProofVerified !== false || release.proofVerification.canonicalBridgeClaim !== false) fail("release record contains unsupported evidence");

const serialized = JSON.stringify({manifest,vectors,crossProduct,integration,provider,metadata,release});
for (const forbidden of ["Codex", "Worktree", "/Users/", "localhost", "127.0.0.1"]) if (serialized.includes(forbidden)) fail(`public handoff contains forbidden internal value ${forbidden}`);
console.log("bridge integration check passed: frozen lifecycle v1, explicit destination availability, proof-verification gate, fail-closed Provider Registry, typed read-only SDK, unavailable provider/contracts, and unaccepted central dependencies");
