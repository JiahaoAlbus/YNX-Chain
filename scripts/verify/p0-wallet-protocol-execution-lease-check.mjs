import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const acceptance = read("release/integration/p0-wallet-protocol-runtime-acceptance.json");
const lease = read("release/integration/p0-wallet-protocol-execution-lease.json");
const fail = (message) => { console.error(`FAIL ${message}`); process.exit(1); };

if (acceptance.decision !== "ACCEPTED_FOR_CONTROLLED_RUNTIME_TRANSACTION") fail("runtime acceptance decision mismatch");
if (acceptance.authoritativeControlPlane?.branch !== "codex/p0-wallet-connectivity-control-plane-20260820" || acceptance.authoritativeControlPlane?.baseCommit !== "5c81dbfc763039fc6be56f814fde20b77ee7117f" || acceptance.authoritativeControlPlane?.supersededAcceptanceCommit !== "401eee474ac188fed1fc1e6089d6a0f9e1250651") fail("authoritative control-plane reconciliation mismatch");
if (acceptance.acceptedProtocolContract?.commit !== "66003e76e804da16d472255efde50cb879055b96") fail("accepted protocol contract drifted");
if (acceptance.candidate?.remoteEvidenceHead !== "460353c654cd6fb907c734a884d54c21806cef23") fail("evidence head drifted");
if (acceptance.candidate?.corsSourceCommit !== "b28609abab6df3ed88bb58cf04472308068eaa0c") fail("CORS source drifted");
if (acceptance.candidate?.originBindingSourceCommit !== "5231e7509d6218bbbf25029cf73d456992cc37bd") fail("origin-binding source drifted");
if (acceptance.candidate?.wholeTreeMergeAccepted !== false || acceptance.requiredReconciliation?.mode !== "MATERIALIZE_EXACT_OWNER_SUBTREE_NO_WHOLE_TREE_MERGE") fail("divergent whole-tree merge must remain forbidden");
if (acceptance.integrationVerification?.walletAuthTestsPassed !== 119 || acceptance.integrationVerification?.walletAuthTestsFailed !== 0 || acceptance.integrationVerification?.packageDryRunPassed !== true) fail("exact-head verification mismatch");
if (acceptance.currentPublicEvidence?.observedSourceCommit !== "6ed04310383ed924065d23affc71f3e4d4c29d49" || acceptance.currentPublicEvidence?.registeredOriginOptionsStatus !== 405 || acceptance.currentPublicEvidence?.registeredOriginOptionsAccepted !== false) fail("current public negative evidence mismatch");
for (const field of ["integratedCentral", "deployedPublic", "publicCorsVerified", "publicLifecycleVerified", "installedClientVerified", "clientEndToEndVerified", "productionSigned", "storeReleased", "aggregatePublic"]) {
  if (acceptance.releaseTruth?.[field] !== false) fail(`acceptance releaseTruth.${field} must remain false`);
}

if (lease.status !== "ISSUED_NOT_EXECUTED" || lease.leaseOwner !== "wallet-protocol" || lease.deploymentOwner !== "wallet-auth-gateway-runtime-owner") fail("lease ownership mismatch");
if (lease.leaseId !== "P0-WALLET-CONNECTIVITY-2026-08-runtime-lease-20260820T091246Z" || lease.supersedesLeaseId !== "P0-WALLET-CONNECTIVITY-2026-08-runtime-lease-20260820T090524Z" || lease.supersededAcceptanceCommit !== "401eee474ac188fed1fc1e6089d6a0f9e1250651" || lease.authoritativeBaseCommit !== "5c81dbfc763039fc6be56f814fde20b77ee7117f") fail("lease supersession identity mismatch");
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
