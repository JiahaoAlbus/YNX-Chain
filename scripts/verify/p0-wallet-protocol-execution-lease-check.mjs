import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = read("release/integration/p0-wallet-protocol-runtime-acceptance.json");
const lease = read("release/integration/p0-wallet-protocol-execution-lease.json");
const deploymentRegistryPath = "release/integration/p0-wallet-protocol-deployment-registry-v4.json";
const deploymentRegistryBytes = fs.readFileSync(path.join(root, deploymentRegistryPath));
const deploymentRegistry = JSON.parse(deploymentRegistryBytes);
const fail = (message) => { console.error(`FAIL ${message}`); process.exit(1); };

if (acceptance.decision !== "ACCEPTED_FOR_CONTROLLED_RUNTIME_TRANSACTION") fail("runtime acceptance decision mismatch");
if (acceptance.authoritativeControlPlane?.branch !== "codex/p0-wallet-connectivity-control-plane-20260820" || acceptance.authoritativeControlPlane?.baseCommit !== "450f2e7aeaa720d65961bd7c5dc7db81eabb2c76" || acceptance.authoritativeControlPlane?.supersededAcceptanceCommit !== "401eee474ac188fed1fc1e6089d6a0f9e1250651") fail("authoritative control-plane reconciliation mismatch");
if (acceptance.acceptedProtocolContract?.commit !== "66003e76e804da16d472255efde50cb879055b96") fail("accepted protocol contract drifted");
if (acceptance.candidate?.remoteEvidenceHead !== "460353c654cd6fb907c734a884d54c21806cef23") fail("evidence head drifted");
if (acceptance.candidate?.corsSourceCommit !== "b28609abab6df3ed88bb58cf04472308068eaa0c") fail("CORS source drifted");
if (acceptance.candidate?.originBindingSourceCommit !== "5231e7509d6218bbbf25029cf73d456992cc37bd") fail("origin-binding source drifted");
if (acceptance.candidate?.wholeTreeMergeAccepted !== false || acceptance.requiredReconciliation?.mode !== "MATERIALIZE_EXACT_OWNER_SUBTREE_NO_WHOLE_TREE_MERGE") fail("divergent whole-tree merge must remain forbidden");
if (acceptance.integrationVerification?.walletAuthTestsPassed !== 119 || acceptance.integrationVerification?.walletAuthTestsFailed !== 0 || acceptance.integrationVerification?.packageDryRunPassed !== true) fail("exact-head verification mismatch");
if (acceptance.currentPublicEvidence?.observedSourceCommit !== "6ed04310383ed924065d23affc71f3e4d4c29d49" || acceptance.currentPublicEvidence?.registeredOriginOptionsStatus !== 405 || acceptance.currentPublicEvidence?.registeredOriginOptionsAccepted !== false) fail("current public negative evidence mismatch");
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
for (const field of ["integratedCentral", "deployedPublic", "publicCorsVerified", "publicLifecycleVerified", "installedClientVerified", "clientEndToEndVerified", "productionSigned", "storeReleased", "aggregatePublic"]) {
  if (acceptance.releaseTruth?.[field] !== false) fail(`acceptance releaseTruth.${field} must remain false`);
}

if (lease.status !== "ISSUED_NOT_EXECUTED" || lease.leaseOwner !== "wallet-protocol" || lease.deploymentOwner !== "wallet-auth-gateway-runtime-owner") fail("lease ownership mismatch");
if (lease.leaseId !== "P0-WALLET-CONNECTIVITY-2026-08-runtime-lease-20260820T092717Z" || lease.supersedesLeaseId !== "P0-WALLET-CONNECTIVITY-2026-08-runtime-lease-20260820T091246Z" || lease.supersededAcceptanceCommit !== "401eee474ac188fed1fc1e6089d6a0f9e1250651" || lease.authoritativeBaseCommit !== "450f2e7aeaa720d65961bd7c5dc7db81eabb2c76") fail("lease supersession identity mismatch");
if (lease.target?.deploymentRegistryPath !== deploymentRegistryPath || lease.target?.deploymentRegistryBlob !== acceptance.deploymentRegistry.blob || lease.target?.deploymentRegistrySha256 !== acceptance.deploymentRegistry.sha256) fail("lease does not bind deployment registry");
if (lease.target?.candidateRuntimeCommit !== acceptance.candidate.originBindingSourceCommit || lease.target?.candidateCorsCommit !== acceptance.candidate.corsSourceCommit || lease.target?.acceptedEvidenceHead !== acceptance.candidate.remoteEvidenceHead) fail("lease target does not bind accepted candidate");
const issued = Date.parse(lease.issuedAt); const expires = Date.parse(lease.expiresAt);
if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires - issued > 2 * 60 * 60 * 1000) fail("lease expiry is invalid or exceeds two hours");
if (lease.authorization?.executionAuthorized !== true || lease.authorization?.singleControlledTransaction !== true || lease.authorization?.automaticRollbackRequired !== true || lease.authorization?.exclusiveProductionWindowRequired !== true) fail("lease transaction controls incomplete");
if (JSON.stringify(lease.authorization?.allowedRoots) !== JSON.stringify(["packages/wallet-auth"])) fail("lease root is not owner-scoped");
for (const forbidden of ["wallet-ui-change", "wallet-platform-change", "other-product-change", "chain-core-change", "whole-tree-merge"]) {
  if (!lease.authorization?.forbiddenEffects?.includes(forbidden)) fail(`missing forbidden effect ${forbidden}`);
}
for (const field of ["preflightComplete", "backupComplete", "deploymentStarted", "deploymentComplete", "rollbackDrillComplete", "runtimeAcceptanceComplete", "installedClientAcceptanceComplete"]) {
  if (lease.executionState?.[field] !== false) fail(`lease executionState.${field} must start false`);
}
if (lease.postRuntimeBoundary?.installedClientComputerControlIncluded !== false || lease.postRuntimeBoundary?.separateInstalledClientLeaseRequired !== true || lease.postRuntimeBoundary?.aggregateTruthMayChangeUnderThisLease !== false) fail("installed-client boundary drifted");

console.log(`PASS ${acceptance.acceptanceId}: accepted source ${acceptance.candidate.originBindingSourceCommit.slice(0, 12)}, lease ${lease.leaseId} expires ${lease.expiresAt}, public remains false`);
