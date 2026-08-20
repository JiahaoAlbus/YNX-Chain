import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const fail = (message) => { console.error(`FAIL ${message}`); process.exit(1); };
const acceptancePath = "release/integration/p0-wallet-connectivity/acceptance/wallet-auth-v2-runtime-6cf3ef84-20260820.json";
const leasePath = "release/integration/p0-wallet-connectivity/execution/wallet-auth-v2-runtime-lease-20260820.json";
const evidencePath = "release/integration/p0-wallet-connectivity/evidence/wallet-auth-v2-runtime-6cf3ef84-review-20260820.json";
const revokedLeasePath = "release/integration/p0-wallet-connectivity/execution/wallet-auth-recovery-runtime-lease-20260820.json";
const acceptance = read(acceptancePath), lease = read(leasePath), evidence = read(evidencePath), revokedLease = read(revokedLeasePath);
const source = "6cf3ef845202bd879ed94515a71b323dd2fc9e14", tree = "4c544d2e2ddb63caef536ea67c8f27b45044fd89";

if (revokedLease.status !== "REVOKED_BEFORE_START" || revokedLease.authorization?.executionAuthorized !== false || revokedLease.executionState?.productionMutationObserved !== false) fail("withdrawn a5a lease is not safely revoked");
if (acceptance.decision !== "SUPERSEDED_DEPENDENCY_CLOSURE_INCOMPLETE" || acceptance.candidate?.sourceCommit !== source || acceptance.candidate?.walletAuthTree !== tree || acceptance.candidate?.scopeFiles !== 7) fail("superseded candidate identity mismatch");
if (acceptance.supersession?.withdrawnCandidate !== "a5a2841e870d7d21df0f761179f2c47d9ca83ccc" || acceptance.supersession?.revokedLeaseReusable !== false) fail("supersession boundary mismatch");
if (Object.keys(acceptance.acceptedBlobs ?? {}).length !== 7 || acceptance.candidate?.wholeTreeMergeAccepted !== false || acceptance.candidate?.successorCommitsAccepted !== false) fail("accepted source scope widened");
const routes = ["/v2/product-sessions/challenge","/v2/product-sessions/complete","/v2/product-sessions/introspect","/v2/product-sessions/revoke","/v2/product-sessions/devices/revoke"];
if (JSON.stringify(acceptance.runtimeMount?.routes) !== JSON.stringify(routes) || acceptance.runtimeMount?.v1AdministrationPreserved !== true || acceptance.runtimeMount?.separateDurableV2NodeHost !== true || acceptance.runtimeMount?.implicitRemoteActivation !== false) fail("runtime mount contract mismatch");
if (acceptance.integrationVerification?.walletAuth !== "231/231" || acceptance.integrationVerification?.v2Combined !== "21/21" || acceptance.integrationVerification?.nodeHost !== "6/6" || acceptance.integrationVerification?.daemon !== "2/2" || acceptance.integrationVerification?.sdk !== "13/13") fail("integration test counts mismatch");

if (lease.status !== "SUPERSEDED_BEFORE_START_DEPENDENCY_CLOSURE" || lease.singleUse !== true || lease.authorization?.executionAuthorized !== false || lease.executionState?.supersededBeforeStart !== true || lease.executionState?.productionMutationObserved !== false || lease.source?.candidateRuntimeCommit !== source || lease.source?.candidateWalletAuthTree !== tree) fail("seven-file lease was not superseded safely");
if (lease.source?.materializationMode !== "EXACT_SEVEN_WALLET_AUTH_FILES_NO_WHOLE_TREE_MERGE" || lease.v2Registry?.sourceBlob !== "4f1f1326031f1dade8eaaaee4673ee96badd0259" || lease.v2Registry?.sha256 !== "d2826eb419abca4444ccb50d79537fa7f6a3643948d82ed9b52914b7169c107b" || lease.v2Registry?.originInferenceAllowed !== false || lease.v2Registry?.mutationAuthorized !== false) fail("source or registry binding mismatch");
if (lease.v2State?.explicitAbsolutePathRequired !== true || lease.v2State?.mustDifferFromV1StatePath !== true || lease.v2State?.resolvedPathMustBeRecordedInPreflightEvidence !== true) fail("v2 state path gate missing");
const issued = Date.parse(lease.issuedAt), expires = Date.parse(lease.expiresAt);
if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires - issued > 2 * 60 * 60 * 1000) fail("lease expiry invalid");
for (const field of ["preflightComplete","backupComplete","deploymentStarted","deploymentComplete","rollbackDrillComplete","publicAcceptanceComplete","installedClientAcceptanceComplete","leaseConsumed"]) if (lease.executionState?.[field] !== false) fail(`executionState.${field} must start false`);
if (evidence.sourceCommit !== source || evidence.walletAuthTree !== tree || evidence.changedFiles !== 7 || evidence.review?.fiveV2RoutesMounted !== true || evidence.review?.candidateObservedPublic !== false || evidence.review?.sevenFileDependencyClosureCompleteOn49e !== false || evidence.review?.preflightFailedClosed !== true || evidence.review?.productionMutationObserved !== false) fail("review evidence mismatch");
for (const truth of [acceptance.truth, lease.truth]) {
  for (const field of ["candidateDeployedPublic","publicV2LifecycleVerified","installedClientVerified","enhancedSdkAccepted","integratedCentral","aggregatePublic","productionSigned","storeReleased"]) if (truth?.[field] !== false) fail(`${field} must remain false`);
  if (truth?.productRuntimeMigrations !== 0) fail("productRuntimeMigrations must remain zero");
}
console.log(`PASS ${lease.leaseId}: superseded before start because seven files are not the 49e dependency closure; production remains unchanged`);
