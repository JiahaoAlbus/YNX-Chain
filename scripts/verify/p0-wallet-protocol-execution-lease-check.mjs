import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = read("release/integration/p0-wallet-protocol-runtime-acceptance.json");
const lease = read("release/integration/p0-wallet-protocol-execution-lease.json");
const installedClientLease = read("release/integration/p0-wallet-protocol-installed-client-computer-control-lease.json");
const websiteHandoff = read("release/integration/p0-wallet-protocol-website-publication-handoff.json");
const installedClientPreflight = read("release/integration/p0-wallet-protocol-installed-client-preflight-evidence.json");
const deploymentRegistryPath = "release/integration/p0-wallet-protocol-deployment-registry-v4.json";
const deploymentRegistryBytes = fs.readFileSync(path.join(root, deploymentRegistryPath));
const deploymentRegistry = JSON.parse(deploymentRegistryBytes);
const fail = (message) => { console.error(`FAIL ${message}`); process.exit(1); };

if (acceptance.decision !== "ACCEPTED_FOR_CONTROLLED_RUNTIME_TRANSACTION") fail("runtime acceptance decision mismatch");
if (acceptance.authoritativeControlPlane?.branch !== "codex/p0-wallet-connectivity-control-plane-20260820" || acceptance.authoritativeControlPlane?.baseCommit !== "15d5ae2bc5278088fd2168cdbcb3746066bc851c" || acceptance.authoritativeControlPlane?.supersededAcceptanceCommit !== "401eee474ac188fed1fc1e6089d6a0f9e1250651") fail("authoritative control-plane reconciliation mismatch");
if (acceptance.acceptedProtocolContract?.commit !== "66003e76e804da16d472255efde50cb879055b96") fail("accepted protocol contract drifted");
if (acceptance.candidate?.remoteEvidenceHead !== "30ba2a0c41d7b070dec56f37e39653e21a780ead") fail("evidence head drifted");
if (acceptance.candidate?.corsSourceCommit !== "b28609abab6df3ed88bb58cf04472308068eaa0c") fail("CORS source drifted");
if (acceptance.candidate?.originBindingSourceCommit !== "5231e7509d6218bbbf25029cf73d456992cc37bd") fail("origin-binding source drifted");
if (acceptance.candidate?.candidateRuntimeCommit !== "49e30d999e9a9cbdd2c565021009f2cab0dc125c" || acceptance.candidate?.candidateRuntimeTree !== "39ed694f72486c50175db62b7fbe4b3eb6636946" || acceptance.candidate?.runtimeVerifierCommit !== "30ba2a0c41d7b070dec56f37e39653e21a780ead") fail("P0-003 runtime amendment drifted");
if (acceptance.requiredReconciliation?.runtimeMaterializationCommit !== acceptance.candidate.candidateRuntimeCommit || acceptance.requiredReconciliation?.requiredVersionSourceAfterDeploy !== acceptance.candidate.candidateRuntimeCommit) fail("runtime materialization/version binding mismatch");
if (acceptance.amendment?.amendmentId !== "P0-003" || acceptance.amendment?.legacyAuthority !== "SESSION_RETIRED_ONLY" || acceptance.amendment?.originInferenceAllowed !== false || acceptance.amendment?.authorityUpgradeAllowed !== false || acceptance.amendment?.productionStateReadOnlyBootRequiredBeforeMutation !== true) fail("P0-003 fail-closed boundary mismatch");
if (acceptance.candidate?.wholeTreeMergeAccepted !== false || acceptance.requiredReconciliation?.mode !== "MATERIALIZE_EXACT_OWNER_SUBTREE_NO_WHOLE_TREE_MERGE") fail("divergent whole-tree merge must remain forbidden");
if (acceptance.integrationVerification?.walletAuthTestsPassed !== 122 || acceptance.integrationVerification?.walletAuthTestsFailed !== 0 || acceptance.integrationVerification?.runtimeSourceTestsPassed !== 119 || acceptance.integrationVerification?.publicEvidenceTestsPassed !== 2 || acceptance.integrationVerification?.installedClientPreflightEvidenceTestsPassed !== 1 || acceptance.integrationVerification?.focusedTestsPassed !== 4 || acceptance.integrationVerification?.diffCheckPassed !== true || acceptance.integrationVerification?.productionStateCompatibilityPreflightPassed !== true) fail("exact-head verification mismatch");
if (acceptance.currentPublicEvidence?.observedSourceCommit !== "49e30d999e9a9cbdd2c565021009f2cab0dc125c" || acceptance.currentPublicEvidence?.registeredOriginOptionsStatus !== 204 || acceptance.currentPublicEvidence?.registeredOriginOptionsAccepted !== true || acceptance.currentPublicEvidence?.publicEvidenceCommit !== "b30775951dcea09bf6b72aeb4806f47ff81b3bef" || acceptance.currentPublicEvidence?.publicEvidenceBlob !== "6e42677719fca8c591d77eb02548b4ab0cc7b76d") fail("current public runtime evidence mismatch");
if (acceptance.runtimeCompletion?.status !== "PUBLIC_RUNTIME_VERIFIED" || acceptance.runtimeCompletion?.runtimeSourceCommit !== acceptance.candidate.candidateRuntimeCommit || acceptance.runtimeCompletion?.registrySha256 !== acceptance.deploymentRegistry.sha256 || acceptance.runtimeCompletion?.finalActivationVerified !== true) fail("runtime completion evidence mismatch");
if (acceptance.deploymentRegistry?.path !== deploymentRegistryPath || acceptance.deploymentRegistry?.blob !== "f11f73bb10943e6ae4e3ecd9f4e5bcedfb7b4701" || acceptance.deploymentRegistry?.sha256 !== "ae156b317b9a97bfd42397cca634021deefe10ffb009102899e24276d8721e31" || acceptance.deploymentRegistry?.bytes !== 20037 || acceptance.deploymentRegistry?.originInferenceAllowed !== false) fail("deployment registry identity mismatch");
if (createHash("sha256").update(deploymentRegistryBytes).digest("hex") !== acceptance.deploymentRegistry.sha256) fail("deployment registry content digest mismatch");
if (deploymentRegistryBytes.length !== 20037 || deploymentRegistry.registryVersion !== 2 || deploymentRegistry.products?.length !== 26) fail("deployment registry shape mismatch");
const expectedPreserved = ["calendar", "developer", "exchange", "finance", "quant", "shop"];
const enabled = deploymentRegistry.products.filter((product) => product.enabled).map((product) => product.productId);
if (JSON.stringify(enabled) !== JSON.stringify([...expectedPreserved, "social"])) fail("deployment registry enabled-client set mismatch");
for (const product of deploymentRegistry.products) {
  if (product.schemaVersion !== 4 || !Array.isArray(product.webOrigins)) fail(`deployment registry ${product.productId} is not schema v4`);
  if (product.productId !== "social" && product.webOrigins.length !== 0) fail(`unapproved web Origin on ${product.productId}`);
}
const social = deploymentRegistry.products.find((product) => product.productId === "social");
if (!social || social.productClientId !== "ynx-social-v1" || social.bundleId !== "com.ynx.social" || JSON.stringify(social.callbacks) !== JSON.stringify(["ynx-social://com.ynx.social"]) || social.reviewState !== "approved" || social.enabled !== true || JSON.stringify(social.webOrigins) !== JSON.stringify(["https://social.ynxweb4.com"])) fail("Social deployment registry binding mismatch");
for (const field of ["deployedPublic", "publicCorsVerified", "publicLifecycleVerified"]) {
  if (acceptance.releaseTruth?.[field] !== true) fail(`acceptance releaseTruth.${field} must be directly verified true`);
}
for (const field of ["integratedCentral", "installedClientVerified", "clientEndToEndVerified", "productionSigned", "storeReleased", "aggregatePublic"]) {
  if (acceptance.releaseTruth?.[field] !== false) fail(`acceptance releaseTruth.${field} must remain false`);
}

if (lease.status !== "COMPLETED_PUBLIC_RUNTIME_VERIFIED" || lease.leaseOwner !== "wallet-protocol" || lease.deploymentOwner !== "wallet-auth-gateway-runtime-owner" || lease.authorization?.executionAuthorized !== false) fail("closed runtime lease mismatch");
if (lease.leaseId !== "P0-WALLET-CONNECTIVITY-2026-08-runtime-lease-20260820T095840Z" || lease.supersedesLeaseId !== "P0-WALLET-CONNECTIVITY-2026-08-runtime-lease-20260820T092717Z" || lease.supersededAcceptanceCommit !== "401eee474ac188fed1fc1e6089d6a0f9e1250651" || lease.authoritativeBaseCommit !== "15d5ae2bc5278088fd2168cdbcb3746066bc851c") fail("lease supersession identity mismatch");
if (lease.target?.deploymentRegistryPath !== deploymentRegistryPath || lease.target?.deploymentRegistryBlob !== acceptance.deploymentRegistry.blob || lease.target?.deploymentRegistrySha256 !== acceptance.deploymentRegistry.sha256) fail("lease does not bind deployment registry");
if (lease.target?.candidateRuntimeCommit !== acceptance.candidate.candidateRuntimeCommit || lease.target?.requiredVersionSourceAfterDeploy !== acceptance.candidate.candidateRuntimeCommit || lease.target?.runtimeVerifierCommit !== acceptance.candidate.runtimeVerifierCommit || lease.target?.candidateCorsCommit !== acceptance.candidate.corsSourceCommit || lease.target?.acceptedEvidenceHead !== acceptance.candidate.remoteEvidenceHead) fail("lease target does not bind accepted candidate");
const issued = Date.parse(lease.issuedAt); const expires = Date.parse(lease.expiresAt);
if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires - issued > 2 * 60 * 60 * 1000) fail("lease expiry is invalid or exceeds two hours");
if (lease.authorization?.singleControlledTransaction !== true || lease.authorization?.automaticRollbackRequired !== true || lease.authorization?.exclusiveProductionWindowRequired !== true) fail("lease transaction controls incomplete");
if (JSON.stringify(lease.authorization?.allowedRoots) !== JSON.stringify(["packages/wallet-auth"])) fail("lease root is not owner-scoped");
for (const forbidden of ["wallet-ui-change", "wallet-platform-change", "other-product-change", "chain-core-change", "whole-tree-merge"]) {
  if (!lease.authorization?.forbiddenEffects?.includes(forbidden)) fail(`missing forbidden effect ${forbidden}`);
}
for (const field of ["preflightComplete", "productionStateCompatibilityPreflightComplete", "backupComplete", "deploymentStarted", "deploymentComplete", "rollbackDrillComplete", "runtimeAcceptanceComplete"]) {
  if (lease.executionState?.[field] !== true) fail(`lease executionState.${field} must be completed`);
}
if (lease.executionState?.installedClientAcceptanceComplete !== false || lease.completion?.evidenceCommit !== "b30775951dcea09bf6b72aeb4806f47ff81b3bef" || lease.completion?.integratedCentral !== false || lease.completion?.aggregatePublic !== false) fail("runtime completion boundary mismatch");
if (lease.postRuntimeBoundary?.installedClientComputerControlIncluded !== false || lease.postRuntimeBoundary?.separateInstalledClientLeaseRequired !== true || lease.postRuntimeBoundary?.aggregateTruthMayChangeUnderThisLease !== false) fail("installed-client boundary drifted");
if (installedClientLease.leaseId !== "P0-WALLET-CONNECTIVITY-2026-08-installed-client-computer-control-lease-20260820T101002Z" || installedClientLease.status !== "PRECHECK_REJECTED_NO_ELIGIBLE_INSTALLED_CLIENT" || installedClientLease.preflightRejectedReason !== "NO_ELIGIBLE_SIGNED_INSTALLED_CLIENT" || installedClientLease.authorization?.executionAuthorized !== false || installedClientLease.prerequisite?.publicRuntimeEvidenceCommit !== "b30775951dcea09bf6b72aeb4806f47ff81b3bef" || installedClientLease.prerequisite?.publicRuntimeSourceCommit !== "49e30d999e9a9cbdd2c565021009f2cab0dc125c") fail("installed-client lease rejection identity mismatch");
if (installedClientLease.preflightEvidence?.frozenPath !== "release/integration/p0-wallet-protocol-installed-client-preflight-evidence.json" || installedClientLease.preflightEvidence?.blob !== "8974960c4a2511bc8706311f3106a144505ace4f" || installedClientLease.preflightEvidence?.ownerEvidenceCommit !== "2d6c9aa354a459b224b79c11c69aab670336a41d" || installedClientLease.executionState?.preflightComplete !== false || installedClientLease.executionState?.computerControlStarted !== false || installedClientLease.executionState?.acceptanceComplete !== false || installedClientLease.executionState?.cleanupState !== "NOT_STARTED_NO_MUTATION") fail("installed-client fail-closed execution state mismatch");
if (installedClientPreflight.status !== "PRECHECK_REJECTED_NO_ELIGIBLE_INSTALLED_CLIENT" || installedClientPreflight.leaseId !== "P0-WALLET-CONNECTIVITY-2026-08-installed-client-computer-control-lease-20260820T101002Z" || installedClientPreflight.computerControl?.clientLaunched !== false || installedClientPreflight.computerControl?.authorizationAttempted !== false || installedClientPreflight.macos?.nativeYnxWalletFound !== false || installedClientPreflight.macos?.rejectedShortcut?.bundleIdentifier !== "com.microsoft.edgemac.app.plkhingfjhnclbfboobaipbemoiaogde" || installedClientPreflight.macos?.rejectedShortcut?.shortcutUrl !== "http://127.0.0.1:4173/" || installedClientPreflight.macos?.rejectedShortcut?.contentSha256 !== "6f9ec89055d8c775511176fbed1f46363e1060d886e80ebdad6d7824cca9479d" || installedClientPreflight.macos?.rejectedShortcut?.eligible !== false || installedClientPreflight.android?.physicalDeviceFound !== false || installedClientPreflight.ios?.physicalDeviceFound !== false || installedClientPreflight.leaseExecution?.computerControlStarted !== false || installedClientPreflight.leaseExecution?.acceptanceComplete !== false || installedClientPreflight.leaseExecution?.cleanupRequired !== false || installedClientPreflight.publicRuntimePrerequisite?.verified !== true) fail("installed-client preflight evidence mismatch");
for (const field of ["installedClientVerified", "standardWalletConnectionClientVerified", "accountVerified", "signVerified", "sendVerified", "transactionVerified", "integratedCentral", "aggregatePublic", "productionSigned", "storeReleased"]) if (installedClientLease.releaseTruth?.[field] !== false) fail(`installed-client lease releaseTruth.${field} must remain false`);
if (websiteHandoff.status !== "READY_FOR_WEBSITE_OWNER_REVIEW_NOT_PUBLISHED" || websiteHandoff.source?.publicRuntimeEvidenceCommit !== "b30775951dcea09bf6b72aeb4806f47ff81b3bef" || websiteHandoff.source?.runtimeSourceCommit !== "49e30d999e9a9cbdd2c565021009f2cab0dc125c") fail("Website publication handoff identity mismatch");
for (const field of ["websitePublished", "visibleBrowserAcceptance", "installedClientVerified", "standardWalletConnectionClientVerified", "integratedCentral", "aggregatePublic", "productionSigned", "storeReleased"]) if (websiteHandoff.releaseTruth?.[field] !== false) fail(`Website handoff releaseTruth.${field} must remain false`);

console.log(`PASS ${acceptance.acceptanceId}: runtime ${acceptance.candidate.candidateRuntimeCommit.slice(0, 12)} public verified, runtime lease closed, installed-client precheck rejected by exact Owner evidence 2d6c9aa3, Website handoff remains unexecuted`);
