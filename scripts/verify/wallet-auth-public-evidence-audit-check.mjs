#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const audit = JSON.parse(readFileSync("release/integration/wallet-auth-public-evidence-audit.json", "utf8"));
const metadata = JSON.parse(readFileSync("release/integration/wallet-auth-public-download-metadata.json", "utf8"));
const record = JSON.parse(readFileSync("release/integration/wallet-auth-release-record.json", "utf8"));
const endpoints = JSON.parse(readFileSync("release/integration/wallet-auth-public-endpoint-service-discovery-matrix.json", "utf8"));
const androidLauncher = JSON.parse(readFileSync("release/integration/wallet-auth-android-launcher-contract.json", "utf8"));
const matrixBytes = readFileSync(record.evidenceMatrix.path);
const matrixSha256 = createHash("sha256").update(matrixBytes).digest("hex");
const endpointBytes = readFileSync(record.validation.publicEndpointServiceDiscoveryMatrix.path);
const endpointSha256 = createHash("sha256").update(endpointBytes).digest("hex");
const androidLauncherBytes = readFileSync(record.validation.androidLauncherContract.path);
const androidLauncherSha256 = createHash("sha256").update(androidLauncherBytes).digest("hex");
const failures = [];
const fail = (message) => failures.push(message);
const sha256 = (value) => /^[0-9a-f]{64}$/.test(value ?? "");

if (audit.schemaVersion !== 1) fail("audit schemaVersion must be 1");
if (endpointSha256 !== record.validation.publicEndpointServiceDiscoveryMatrix.sha256 || endpointSha256 !== audit.endpointServiceDiscoveryMatrix?.sha256) fail("endpoint discovery matrix digest mismatch");
if (androidLauncherSha256 !== record.validation.androidLauncherContract.sha256 || androidLauncherSha256 !== audit.androidLauncherContract?.sha256) fail("Android launcher contract digest mismatch");
if (endpoints.schemaVersion !== 1 || endpoints.network?.chainIdDecimal !== 6423 || endpoints.network?.chainIdHex !== "0x1917") fail("endpoint discovery matrix identity mismatch");
if (endpoints.canonical?.rpcUrl !== "https://rpc.ynxweb4.com/evm" || endpoints.canonical?.restUrl !== "https://rest.ynxweb4.com") fail("canonical public RPC/REST endpoints drifted");
if (endpoints.discoveryContract?.modes?.length !== 3 || endpoints.discoveryContract?.unavailableBehavior?.failClosed !== true) fail("mobile discovery contract must have three fail-closed modes");
if (endpoints.discoveryContract?.modes?.find(({id}) => id === "ynx-wallet-canonical-authorization")?.returnRequiresInjectedProvider !== false) fail("YNX Wallet mobile return cannot require injected EIP-1193");
for (const endpoint of endpoints.endpoints ?? []) {
  if (typeof endpoint.availability !== "boolean" || typeof endpoint.cors !== "boolean" || typeof endpoint.mobileReachable !== "boolean" || endpoint.failClosedWhenUnavailable !== true) fail(`${endpoint.id} endpoint truth is incomplete`);
}
for (const id of ["wallet-approval-deep-link", "wallet-callback", "explorer"]) {
  const endpoint = endpoints.endpoints?.find((item) => item.id === id);
  if (!endpoint || endpoint.availability !== false || endpoint.mobileReachable !== false) fail(`${id} must remain unavailable without direct public mobile evidence`);
}
const faucet = endpoints.endpoints?.find((item) => item.id === "faucet");
if (!faucet || faucet.availability !== true || faucet.cors !== true || faucet.mobileReachable !== false || faucet.productionHostSniVerified !== true || faucet.clientTlsVerified !== false || faucet.successfulFundingTransactionObserved !== false) fail("faucet production-host/mobile truth boundary drifted");
for (const id of ["chain-rpc-canonical", "chain-rpc-legacy-evm-host"]) {
  const endpoint = endpoints.endpoints?.find((item) => item.id === id);
  if (!endpoint || endpoint.cors !== false || endpoint.mobileReachable !== false) fail(`${id} browser CORS/mobile boundary was promoted`);
}
const legacyEvmHost = endpoints.endpoints?.find((item) => item.id === "chain-rpc-legacy-evm-host");
if (legacyEvmHost?.candidateCommit !== "c2a34c926dcba0867d91d36fd629953f6c81bd2f" || legacyEvmHost?.candidateValidated !== false || legacyEvmHost?.backupCreated !== false || legacyEvmHost?.caddyReloaded !== false || legacyEvmHost?.deployed !== false) fail("EVM CORS candidate/deployment boundary drifted");
const productSessionV2 = endpoints.endpoints?.find((item) => item.id === "product-session-v2");
if (!productSessionV2 || productSessionV2.cors !== true || productSessionV2.optionsVerified !== true || productSessionV2.registeredOriginOnly !== true || productSessionV2.mobileReachable !== false || productSessionV2.wildcardOriginAllowed !== false || productSessionV2.credentialsAllowed !== false) fail("Product Session v2 CORS/mobile boundary drifted");
if (endpoints.aggregate?.allRequiredServicesAvailable !== false || endpoints.aggregate?.allRequiredServicesCorsReady !== false || endpoints.aggregate?.mobileWalletDiscoveryVerified !== false || endpoints.aggregate?.deployedPublic !== false || endpoints.aggregate?.integratedCentral !== false) fail("endpoint/mobile aggregate must remain false");
if (androidLauncher.schemaVersion !== 1 || androidLauncher.authority?.walletPackage !== "com.ynxweb4.wallet" || androidLauncher.authority?.scheme !== "ynxwallet" || androidLauncher.authority?.host !== "authorize" || androidLauncher.authority?.path !== "" || androidLauncher.authority?.uriTemplate !== "ynxwallet://authorize?request=<base64url-canonical-authorization-request>") fail("Android launcher authority drifted");
if (androidLauncher.callerMigrationGate?.verifier !== "scripts/verify/wallet-auth-android-launcher-callers-check.mjs" || androidLauncher.callerMigrationGate?.allReleaseCallersCanonical !== false || androidLauncher.callerMigrationGate?.gatePassed !== false || androidLauncher.callerMigrationGate?.productSpecificCallbackRewriteAllowed !== false) fail("Android caller migration boundary drifted");
if (androidLauncher.sharedCallerRequirements?.callerMayConcatenateUri !== false || androidLauncher.sharedCallerRequirements?.resolveActivityBeforeLaunch !== true || androidLauncher.sharedCallerRequirements?.queryIntentActivitiesBeforeLaunch !== true || androidLauncher.sharedCallerRequirements?.rawActivityNotFoundExposedToUser !== false) fail("Android shared launcher safety contract is incomplete");
for (const field of ["resolveActivityVerified", "queryIntentActivitiesVerified", "approveVerified", "rejectVerified", "callbackVerified", "productSessionVerified", "secondLaunchVerified", "accepted"]) {
  if (androidLauncher.crossProductAcceptance?.[field] !== false) fail(`androidLauncher.crossProductAcceptance.${field} cannot promote without direct Pixel 9 evidence`);
}
for (const field of ["implementedShared", "deviceValidated", "integratedCentral", "deployedPublic", "productionSigned", "storeReleased"]) {
  if (androidLauncher.releaseTruth?.[field] !== false) fail(`androidLauncher.releaseTruth.${field} must remain false`);
}
if (audit.matrixSha256 !== matrixSha256 || record.evidenceMatrix.sha256 !== matrixSha256) fail("audit/record matrix digest mismatch");
if (audit.publicTestnet?.rpc?.observedResult !== "0x1917" || audit.publicTestnet?.rpc?.verified !== true) fail("public RPC chain identity is not directly verified");
if (!sha256(audit.publicTestnet?.rpc?.responseSha256)) fail("public RPC response digest is missing");
if (audit.publicTestnet?.gatewayHealth?.httpStatus !== 200 || audit.publicTestnet?.gatewayHealth?.remoteDeployed !== true) fail("public Gateway health is not directly verified");
if (!sha256(audit.publicTestnet?.gatewayHealth?.responseSha256)) fail("Gateway health response digest is missing");
if (audit.publicTestnet?.latestFrozenSourceDeployed !== false || audit.publicTestnet?.latestLocalRoutesPublicVerified !== false) fail("latest local Core slices cannot be promoted to public");
if (audit.faucetPublicRecovery?.evidenceCommit !== "41df12552ef5a1cab029223f3bc16af320e9973c" || audit.faucetPublicRecovery?.productionHostPublicSniHealthy !== true || audit.faucetPublicRecovery?.officialWebsiteCorsObserved !== true || audit.faucetPublicRecovery?.mobileOrWorkstationTlsVerified !== false || audit.faucetPublicRecovery?.successfulFundingTransactionObserved !== false || audit.faucetPublicRecovery?.aggregateDeployedPublic !== false) fail("faucet public recovery boundary mismatch");
if (audit.productSessionV2Cors?.evidenceCommit !== "7c39f78cb8fa398f526c6cd16df45a3f9dd579b6" || audit.productSessionV2Cors?.optionsVerified !== true || audit.productSessionV2Cors?.registeredOriginActualResponseVerified !== true || audit.productSessionV2Cors?.unregisteredSuffixRejected !== true || audit.productSessionV2Cors?.zeroMutation !== true || audit.productSessionV2Cors?.mobileWalletFlowVerified !== false || audit.productSessionV2Cors?.integratedCentral !== false || audit.productSessionV2Cors?.aggregateDeployedPublic !== false) fail("Product Session v2 public CORS boundary mismatch");
if (audit.evmCorsDeploymentAttempt?.commit !== "c2a34c926dcba0867d91d36fd629953f6c81bd2f" || audit.evmCorsDeploymentAttempt?.evidenceBlob !== "35d280a689f47b58812b7b4ba346913f7a06e20f" || audit.evmCorsDeploymentAttempt?.lastApprovedOriginOptionsStatus !== 405 || audit.evmCorsDeploymentAttempt?.lastApprovedOriginAllowOrigin !== null || audit.evmCorsDeploymentAttempt?.lastHostileOriginOptionsStatus !== 405 || audit.evmCorsDeploymentAttempt?.lastHostileOriginAllowOrigin !== null) fail("EVM CORS direct failure evidence mismatch");
for (const field of ["candidateValidated", "backupCreated", "caddyReloaded", "deployed", "mobileReachable", "aggregateDeployedPublic"]) {
  if (audit.evmCorsDeploymentAttempt?.[field] !== false) fail(`evmCorsDeploymentAttempt.${field} must remain false`);
}
if (audit.webMobileDiscoveryBoundary?.commit !== "020f513e5d5d12920f75201f637bdd854ccc91aa" || audit.webMobileDiscoveryBoundary?.handoffBlob !== "8c5d918b303a88996a98512e7a8e566ebade98ad") fail("Web mobile discovery source identity mismatch");
if (audit.webMobileDiscoveryBoundary?.modes?.join(",") !== "injected-provider,ynx-wallet-canonical-authorization,metamask-mobile-dapp-link" || audit.webMobileDiscoveryBoundary?.injectedProviderRequired !== true || audit.webMobileDiscoveryBoundary?.ynxCanonicalCallback !== null || audit.webMobileDiscoveryBoundary?.ynxRegistryBindingEnabled !== false || audit.webMobileDiscoveryBoundary?.returnToExternalChromeIsProviderSuccess !== false) fail("Web mobile discovery contract drifted");
for (const [id, bytes, digest] of [["pwa", 274329, "a5e8d413e037ed1e345a4af7c42fc31bc413d6514afb0c8a0a0b82b6047fe209"], ["chromeEdge", 189922, "354c1d7834c4be1ec19af4f19bb69ad8f097ce7ebb713e8b639e382815495266"], ["firefox", 189959, "4d71e5de63ed24f35b52b847743f9c60bc3dc22e3c49e3461761ee5180466cea"]]) {
  const artifact = audit.webMobileDiscoveryBoundary?.artifacts?.[id];
  if (artifact?.bytes !== bytes || artifact?.sha256 !== digest) fail(`Web mobile discovery ${id} artifact identity mismatch`);
}
for (const field of ["latestSourceArtifactsHosted", "latestSourceDeployedPublic", "mobileVisibleContractProvedPublic", "accountVerified", "signVerified", "transactionVerified", "testnetVerified"]) {
  if (audit.webMobileDiscoveryBoundary?.[field] !== false) fail(`webMobileDiscoveryBoundary.${field} must remain false`);
}
if (audit.officialWebsite?.routePublic !== true || audit.officialWebsite?.effectiveStatus !== 200) fail("official Wallet website route is not public");
if (!sha256(audit.officialWebsite?.pageSha256)) fail("official website response digest is missing");
if (!Array.isArray(audit.officialWebsite?.directArtifactLinks) || audit.officialWebsite.directArtifactLinks.length !== 4) fail("official website exact artifact links are missing");
if (audit.officialWebsite?.currentDownloadsPublished !== true) fail("official macOS arm64 CLI download must remain published");
if (audit.githubReleases?.currentCandidateExactArtifactsHosted !== false) fail("historical prereleases cannot host the current candidate set");
if (audit.signingAudit?.candidateCount !== metadata.candidates.length) fail("signing audit candidate count differs from public metadata");
const hostedIds = new Set(["macos-cli-arm64-0.1.0", "web-pwa-0.1.0", "browser-extension-0.1.0", "firefox-extension-0.1.0"]);
for (const candidate of metadata.candidates) {
  const hosted = hostedIds.has(candidate.id);
  if (candidate.downloadHosted !== hosted || candidate.websitePublishable !== hosted) fail(`${candidate.id} hosted boundary mismatch`);
  if (candidate.productionSigned !== false || candidate.storeReleased !== false) fail(`${candidate.id} production boundary mismatch`);
}
if (audit.officialMacosArm64CliDownload?.downloadHosted !== true || audit.officialMacosArm64CliDownload?.deployedPublic !== true) fail("official macOS arm64 CLI evidence is missing");
if (audit.officialMacosArm64CliDownload?.rollbackVerified !== false || audit.officialMacosArm64CliDownload?.productionSigned !== false) fail("rollback/signing boundary was promoted");
if (!/^[0-9a-f]{40}$/.test(audit.computerControl?.exactEvidenceCommit ?? "") || !audit.computerControl?.exactEvidencePath) fail("ComputerControl direct evidence commit/path is missing");
if (audit.computerControl?.popupControlSucceeded !== true || audit.computerControl?.popupVisible !== true) fail("ComputerControl popup evidence was not preserved");
if (audit.computerControl?.testnetRpcObserved !== true || audit.computerControl?.testnetChainId !== "0x1917") fail("ComputerControl popup RPC boundary is not exact");
for (const field of ["installedLocal", "addChainObserved", "switchChainObserved", "reconnectObserved", "signObserved", "transactionObserved"]) {
  if (audit.computerControl?.[field] !== false) fail(`computerControl.${field} must remain false without exact evidence`);
}
if (audit.releaseDecision?.downloadHosted !== true || audit.releaseDecision?.deployedPublic !== true) fail("official hosted release decision is missing");
for (const field of ["latestFrozenGatewaySourcePublic", "productionSigned", "storeReleased", "computerControlAccepted"]) {
  if (audit.releaseDecision?.[field] !== false) fail(`releaseDecision.${field} must remain false`);
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exit(1);
}
process.stdout.write(`PASS wallet-auth public evidence audit: RPC 0x1917, ${hostedIds.size} official hosted candidates, ${metadata.candidates.length - hostedIds.size} fail-closed candidates, ComputerControl pending\n`);
