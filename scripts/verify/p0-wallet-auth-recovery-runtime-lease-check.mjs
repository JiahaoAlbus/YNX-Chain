import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const fail = (message) => { console.error(`FAIL ${message}`); process.exit(1); };
const acceptancePath = "release/integration/p0-wallet-connectivity/acceptance/wallet-auth-recovery-runtime-a5a2841e-20260820.json";
const leasePath = "release/integration/p0-wallet-connectivity/execution/wallet-auth-recovery-runtime-lease-20260820.json";
const evidencePath = "release/integration/p0-wallet-connectivity/evidence/wallet-auth-recovery-runtime-a5a2841e-review-20260820.json";
const registryPath = "release/integration/p0-wallet-protocol-deployment-registry-v4.json";
const acceptance = read(acceptancePath);
const lease = read(leasePath);
const evidence = read(evidencePath);
const registryBytes = fs.readFileSync(path.join(root, registryPath));

const candidate = "a5a2841e870d7d21df0f761179f2c47d9ca83ccc";
const walletAuthTree = "53790596eeba9388b02cb43ac8cc51939f00ce5d";
const priorRuntime = "49e30d999e9a9cbdd2c565021009f2cab0dc125c";
const registrySha = "ae156b317b9a97bfd42397cca634021deefe10ffb009102899e24276d8721e31";

if (acceptance.decision !== "REVOKED_RUNTIME_MOUNT_GAP" || acceptance.runtimeMountGap?.requiredRoutesMounted !== false || acceptance.runtimeMountGap?.runtimeReady !== false || acceptance.runtimeMountGap?.deploymentAuthorized !== false) fail("runtime mount-gap revocation mismatch");
if (acceptance.ownerCandidate?.acceptedCommit !== candidate || acceptance.ownerCandidate?.walletAuthTree !== walletAuthTree) fail("accepted source identity mismatch");
if (acceptance.ownerCandidate?.wholeTreeMergeAccepted !== false || acceptance.ownerCandidate?.unknownSuccessorCommitsAccepted !== false || acceptance.ownerCandidate?.remoteHeadDriftAccepted !== false) fail("source scope widened");
if (acceptance.reconciliation?.mode !== "MATERIALIZE_EXACT_PACKAGES_WALLET_AUTH_SUBTREE_NO_WHOLE_TREE_MERGE" || acceptance.reconciliation?.requiredCurrentPublicRuntimeSource !== priorRuntime || acceptance.reconciliation?.requiredCandidateSourceAfterDeploy !== candidate) fail("reconciliation mismatch");
if (acceptance.integrationVerification?.walletAuthTests?.passed !== 222 || acceptance.integrationVerification?.recoveryCoordinatorTests?.passed !== 29 || acceptance.integrationVerification?.sdkTests?.passed !== 13 || acceptance.integrationVerification?.runtimeProductsMigrated !== 0) fail("verification counts mismatch");
if (acceptance.deploymentRegistry?.sha256 !== registrySha || acceptance.deploymentRegistry?.blob !== "f11f73bb10943e6ae4e3ecd9f4e5bcedfb7b4701" || acceptance.deploymentRegistry?.mutationAuthorized !== false) fail("registry binding mismatch");
if (createHash("sha256").update(registryBytes).digest("hex") !== registrySha || registryBytes.length !== 20037) fail("registry bytes mismatch");

if (lease.status !== "REVOKED_BEFORE_START" || lease.singleUse !== true || lease.authorization?.executionAuthorized !== false || lease.executionState?.revokedBeforeStart !== true || lease.executionState?.productionMutationObserved !== false) fail("lease was not revoked before start");
if (lease.acceptancePath !== acceptancePath || lease.source?.candidateRuntimeCommit !== candidate || lease.source?.candidateWalletAuthTree !== walletAuthTree || lease.source?.currentPublicRuntimeCommit !== priorRuntime) fail("lease source mismatch");
if (lease.source?.materializationMode !== "EXACT_PACKAGES_WALLET_AUTH_SUBTREE_ONLY" || JSON.stringify(lease.authorization?.allowedRoots) !== JSON.stringify(["packages/wallet-auth"])) fail("lease scope mismatch");
for (const target of ["6437", "6439", "6441", "Chain Core", "Website", "Developer SDK", "Shop"]) if (!lease.authorization?.forbiddenTargets?.includes(target)) fail(`missing forbidden target ${target}`);
for (const effect of ["whole-tree-merge", "registry-mutation", "origin-inference", "unrelated-service-restart", "installed-client-acceptance", "product-migration-claim"]) if (!lease.authorization?.forbiddenEffects?.includes(effect)) fail(`missing forbidden effect ${effect}`);
const issued = Date.parse(lease.issuedAt); const expires = Date.parse(lease.expiresAt);
if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires - issued > 2 * 60 * 60 * 1000) fail("lease expiry invalid");
for (const field of ["preflightComplete", "backupComplete", "deploymentStarted", "deploymentComplete", "rollbackDrillComplete", "publicAcceptanceComplete", "installedClientAcceptanceComplete", "leaseConsumed"]) if (lease.executionState?.[field] !== false) fail(`executionState.${field} must start false`);

if (evidence.sourceCommit !== candidate || evidence.walletAuthTree !== walletAuthTree || evidence.reviewFindings?.runtimeProductsMigrated !== 0 || evidence.reviewFindings?.candidatePublicRuntimeVerified !== false || evidence.reviewFindings?.productSessionV2RoutesMounted !== false || evidence.reviewFindings?.runtimeReady !== false || evidence.reviewFindings?.leaseRevokedBeforeStart !== true) fail("review evidence mismatch");
for (const truth of [acceptance.currentTruth, lease.truthBoundary]) {
  for (const field of ["candidateDeployedPublic", "currentHeadDeployedPublic", "installedClientVerified", "accountVerified", "signVerified", "sendVerified", "transactionVerified", "integratedCentral", "aggregatePublic", "productionSigned", "storeReleased"]) if (truth?.[field] !== false) fail(`${field} must remain false`);
  if (truth?.runtimeProductsMigrated !== 0) fail("runtimeProductsMigrated must remain zero");
}

console.log(`PASS ${lease.leaseId}: revoked before start because ${candidate.slice(0, 12)} does not mount Product Session v2; old public runtime and every client/product/aggregate gate remain unchanged`);
