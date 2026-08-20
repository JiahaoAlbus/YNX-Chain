import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const fail = (m) => { console.error(`FAIL ${m}`); process.exit(1); };
const oldAcceptance = read("release/integration/p0-wallet-connectivity/acceptance/wallet-auth-v2-runtime-6cf3ef84-20260820.json");
const oldLease = read("release/integration/p0-wallet-connectivity/execution/wallet-auth-v2-runtime-lease-20260820.json");
const acceptance = read("release/integration/p0-wallet-connectivity/acceptance/wallet-auth-v2-full-subtree-6cf3ef84-20260820.json");
const lease = read("release/integration/p0-wallet-connectivity/execution/wallet-auth-v2-full-subtree-lease-20260820.json");
const evidence = read("release/integration/p0-wallet-connectivity/evidence/wallet-auth-v2-full-subtree-closure-20260820.json");
const inventory = fs.readFileSync(path.join(root, "release/integration/p0-wallet-connectivity/inventory/wallet-auth-6cf3ef84-ls-tree.txt"));

if (oldAcceptance.decision !== "SUPERSEDED_DEPENDENCY_CLOSURE_INCOMPLETE" || oldLease.status !== "SUPERSEDED_BEFORE_START_DEPENDENCY_CLOSURE" || oldLease.authorization?.executionAuthorized !== false || oldLease.executionState?.productionMutationObserved !== false) fail("seven-file lease not safely superseded");
if (acceptance.decision !== "ACCEPTED_EXACT_FULL_SUBTREE_FOR_GATED_RUNTIME_TRANSACTION" || acceptance.source?.commit !== "6cf3ef845202bd879ed94515a71b323dd2fc9e14" || acceptance.source?.walletAuthTree !== "4c544d2e2ddb63caef536ea67c8f27b45044fd89" || acceptance.source?.fullOwnerSubtreeRequired !== true || acceptance.source?.handPickedClosureAccepted !== false) fail("full-subtree acceptance mismatch");
if (acceptance.closure?.changedFiles !== 76 || acceptance.closure?.addedFiles !== 59 || acceptance.closure?.modifiedFiles !== 17 || acceptance.closure?.deletedFiles !== 0 || acceptance.closure?.subtreeEntries !== 160 || acceptance.closure?.archiveSha256 !== "fac046697f8cc3902976764f959d69f83e13067c37abfe2b37f9b8adf7ba2da0") fail("closure facts mismatch");
if (inventory.length !== 18241 || inventory.toString("utf8").trimEnd().split("\n").length !== 160 || createHash("sha256").update(inventory).digest("hex") !== "a96ba130a236459e6a3352d6c14be91c7c6bd0945b2eb019b5e65811ef3137b0") fail("inventory bytes mismatch");
if (acceptance.v2Registry?.blob !== "4f1f1326031f1dade8eaaaee4673ee96badd0259" || acceptance.v2Registry?.sha256 !== "d2826eb419abca4444ccb50d79537fa7f6a3643948d82ed9b52914b7169c107b" || acceptance.v2Registry?.originInferenceAllowed !== false || acceptance.v2Registry?.mutationAuthorized !== false) fail("v2 registry mismatch");
if (lease.status !== "ISSUED_NOT_STARTED" || lease.singleUse !== true || lease.authorization?.executionAuthorized !== true || lease.authorization?.productionActivationBlockedUntilCopied49eColdStartPasses !== true || lease.authorization?.materialization !== "REPLACE_EXACT_FULL_PACKAGES_WALLET_AUTH_SUBTREE_WITH_TREE_4c544d2e") fail("replacement lease mismatch");
const issued = Date.parse(lease.issuedAt), expires = Date.parse(lease.expiresAt); if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires - issued > 2*60*60*1000) fail("lease expiry invalid");
for (const field of ["copiedRuntimeColdStartComplete","preflightComplete","backupComplete","deploymentStarted","deploymentComplete","rollbackDrillComplete","publicAcceptanceComplete","leaseConsumed"]) if (lease.executionState?.[field] !== false) fail(`${field} must start false`);
if (evidence.integrationReproduced !== true || evidence.delta?.deleted !== 0 || evidence.sevenFileLease?.productionMutationObserved !== false || evidence.currentPublic?.source !== "49e30d999e9a9cbdd2c565021009f2cab0dc125c") fail("closure evidence mismatch");
for (const truth of [acceptance.truth,lease.truth]) { for (const field of ["candidateDeployedPublic","publicV2LifecycleVerified","installedClientVerified","integratedCentral","aggregatePublic","productionSigned","storeReleased"]) if (truth?.[field] !== false) fail(`${field} must remain false`); if (truth?.productRuntimeMigrations !== 0) fail("product migration must remain zero"); }
console.log(`PASS ${lease.leaseId}: seven-file lease superseded; exact 160-entry Wallet/Auth subtree is authorized only behind copied-49e cold-start and all production/client/product gates remain false`);
