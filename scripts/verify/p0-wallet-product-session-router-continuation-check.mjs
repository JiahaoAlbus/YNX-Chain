import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const fail = (m) => { console.error(`FAIL ${m}`); process.exit(1); };
const acceptance = read("release/integration/p0-wallet-connectivity/acceptance/wallet-product-session-router-d003a71b-20260820.json");
const evidence = read("release/integration/wallet-product-session-router-continuation-evidence-20260820.json");
const contract = read("release/integration/wallet-product-session-router-contract.json");
const migration = read("release/integration/wallet-product-session-router-migration.json");
const audit = read("release/integration/wallet-product-session-router-completion-audit.json");
const queue = read("release/integration/p0-wallet-connectivity/integration-queue.json");
const gitBlobOid = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

if (acceptance.decision !== "ACCEPTED_SOURCE_CHECKPOINT_PRODUCT_MIGRATION_PENDING" || acceptance.ownerCommit !== "d003a71b7658bbe530c5a9f646e6d3e908e22287" || acceptance.ownerTree !== "6708ee539dea6e9fdf281e31bc73ed2692def63c") fail("owner checkpoint identity mismatch");
for (const file of acceptance.sourceFiles) {
  const bytes = fs.readFileSync(path.join(root, file.path));
  if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256 || gitBlobOid(bytes) !== file.blob) fail(`source file identity mismatch: ${file.path}`);
}
if (evidence.acceptedArchitecture?.standardWalletProtocolCommit !== "66003e76e804da16d472255efde50cb879055b96" || evidence.acceptedArchitecture?.standardWalletProtocolAcceptanceCommit !== "9b6e101f29c9028b9d5a477258e341aa05ebc89f" || evidence.acceptedArchitecture?.standardWalletConsumerSdkCommit !== "315897e75c0ffe3e63435fe73cfec42244b851cc" || evidence.acceptedArchitecture?.standardConnectionSurvivesProductSessionFailure !== true || evidence.acceptedArchitecture?.privateServiceBecomesDegraded !== true || evidence.acceptedArchitecture?.localOrCannedProductSessionAllowed !== false) fail("two-layer architecture mismatch");
if (evidence.publicReadback?.version?.sourceCommit !== "6cf3ef845202bd879ed94515a71b323dd2fc9e14" || evidence.publicReadback?.health?.status !== 200 || evidence.publicReadback?.health?.bytes !== 197 || evidence.publicReadback?.ready?.status !== 200 || evidence.publicReadback?.ready?.bytes !== 195 || evidence.publicReadback?.version?.status !== 200 || evidence.publicReadback?.version?.bytes !== 301 || evidence.publicReadback?.registeredOriginOptions?.status !== 204 || evidence.publicReadback?.unregisteredOriginOptions?.status !== 403) fail("public readback mismatch");
if (evidence.tests?.walletAuth?.passed !== 233 || evidence.tests?.walletAuth?.failed !== 0 || evidence.tests?.migrationContract?.passed !== 4 || evidence.tests?.migrationContract?.failed !== 0 || evidence.tests?.socialReadOnlyCheckpoint?.testsPassed !== 18 || evidence.tests?.socialReadOnlyCheckpoint?.migratedV2 !== false) fail("test evidence mismatch");
if (contract.standardWalletConnection?.productSessionFailureOutcome?.standardConnection !== "CONNECTED" || contract.standardWalletConnection?.productSessionFailureOutcome?.privateYnxService !== "DEGRADED" || contract.standardWalletConnection?.productSessionFailureOutcome?.fabricatedLocalProductSession !== false || contract.releaseStatus?.deployedProductSessionV2SourceCommit !== "6cf3ef845202bd879ed94515a71b323dd2fc9e14" || contract.releaseStatus?.runtimeProductsMigrated !== 0 || contract.releaseStatus?.runtimeProductsRequired !== 12 || contract.releaseStatus?.aggregateComplete !== false) fail("router contract truth mismatch");
const requiredProducts = ["calendar","card","creator-studio","developer","dex","exchange","finance","pay","quant","shop","social","video"];
const routed = migration.products.filter((item) => requiredProducts.includes(item.productId));
if (migration.fixedProductCount !== 0 || migration.productRuntimeMigrationCount !== 0 || routed.length !== 12 || routed.some((item) => item.migrated !== false)) fail("product migration matrix mismatch");
if (audit.audit?.D_sharedSdkAndMigration?.registryReadyProducts !== 12 || audit.audit?.D_sharedSdkAndMigration?.runtimeMigratedProducts !== 0 || audit.completion !== false) fail("completion audit mismatch");
const route = queue.tasks.find((item) => item.taskId === "P0-016");
if (route?.status !== "ROUTED_PRODUCT_MIGRATION_EVIDENCE_REQUIRED" || route?.sourceCheckpoint !== acceptance.ownerCommit || route?.productsRequired !== 12 || route?.productsMigrated !== 0 || route?.products?.join(",") !== requiredProducts.join(",") || route?.promotionRequires?.length !== 3) fail("product owner routing mismatch");
for (const field of ["productConsumptionVerified","installedWalletApprovalVerified","walletConnectOrOtherWalletInteropVerified","computerControlVisibleFlowVerified","accountVerified","signVerified","transactionVerified","integratedCentral","aggregateComplete","productionSigned","storeReleased"]) if (acceptance.truth?.[field] !== false) fail(`${field} must remain false`);
if (acceptance.truth?.productsMigrated !== 0 || acceptance.truth?.productMigrationTotal !== 12) fail("accepted migration truth mismatch");
console.log("PASS d003a71b Router checkpoint: two-layer contract accepted source-only; 12 product owners routed, 0/12 migrated and all visible/client/aggregate gates remain false");
