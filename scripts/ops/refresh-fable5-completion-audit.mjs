#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const matrix = read("release/integration/PRODUCT_RELEASE_MATRIX.json");
const ai = read("release/integration/AI_CAPABILITY_MATRIX.json");
const asset = read("release/security/ASSET_SECURITY_TRACEABILITY_MATRIX.json");
const catalog = read("release/integration/ECOSYSTEM_FUNCTION_CATALOG.json");
const vectors = read("docs/integration/CROSS_PRODUCT_TEST_VECTORS.json");
const count = (predicate) => matrix.products.filter(predicate).length;
const percent = (numerator, denominator) => Number(((100 * numerator) / denominator).toFixed(1));
const metric = (name, numerator, denominator, evidence, gaps) => ({ name, numerator, denominator, percent: percent(numerator, denominator), evidence, gaps });

const synced = count((product) => product.localSha === product.remoteSha);
const implemented = count((product) => product.states.implementedLocal);
const tested = count((product) => product.states.testedLocal);
const built = count((product) => product.states.builtLocal);
const central = count((product) => product.states.integratedCentral);
const shared = count((product) => product.states.sharedTestnetVerified);
const clean = count((product) => product.dirty === false);
const exactCi = count((product) => product.ci.exactHeadSuccess === true);
const releases = count((product) => product.states.releasePublished);
const artifacts = count((product) => product.states.artifactHosted);
const restores = count((product) => product.states.restoreVerified);
const completedE2E = vectors.vectors.filter((vector) => ["testnetVerified", "publicVerified", "verifiedComplete"].includes(vector.status)).length;
const websiteRoutes = catalog.products.filter((product) => product.publicRoutes.length > 0 && product.status !== "pending-recovery").length;
const aiCovered = ai.products.filter((product) => ["none", "advisory", "content", "developer", "operations-readonly", "native-ai"].includes(product.aiMode)).length;
const assetRelevant = asset.products.filter((product) => product.assetRelevant);
const assetCovered = assetRelevant.filter((product) => product.status !== "unverified").length;

const metrics = [
  metric("Source Push Completion", synced, 36, ["release/integration/PRODUCT_RELEASE_MATRIX.json"], [`${36 - synced} product branches are not synchronized`]),
  metric("Local Engineering", implemented + tested + built, 108, ["release/integration/PRODUCT_RELEASE_MATRIX.json"], [`implemented ${implemented}/36; tested ${tested}/36; built ${built}/36`]),
  metric("Central Integration", central, 36, ["release/integration/central-acceptance-decisions.json", "release/integration/PRODUCT_RELEASE_MATRIX.json"], [`${36 - central} products lack current fail-closed central acceptance`]),
  metric("Shared Testnet", shared, 36, ["release/integration/PRODUCT_RELEASE_MATRIX.json", "docs/acceptance/TESTNET_TRANSFER_AND_CONCURRENCY_EVIDENCE_2026_08_01.md"], ["operator runtime evidence exists, but no product row currently satisfies the full sharedTestnetVerified evidence gate"]),
  metric("Cross-product E2E", completedE2E, vectors.vectors.length, ["docs/integration/CROSS_PRODUCT_TEST_VECTORS.json"], [`${vectors.vectors.length - completedE2E} scenarios lack complete Tx/Event/Ledger/Explorer/Monitor evidence`]),
  metric("Public Website", websiteRoutes, 36, ["release/integration/ECOSYSTEM_FUNCTION_CATALOG.json", "https://ynxweb4.com/dapp"], [`${36 - websiteRoutes} products remain pending-recovery rather than evidence-complete product routes`]),
  metric("Security / Release / Operations", clean + exactCi + releases + artifacts + restores, 180, ["release/integration/PRODUCT_RELEASE_MATRIX.json"], [`clean ${clean}/36; exact-head CI ${exactCi}/36; release ${releases}/36; hosted artifact ${artifacts}/36; restore ${restores}/36`]),
  metric("AI Capability Coverage", aiCovered, 36, ["release/integration/AI_CAPABILITY_MATRIX.json"], ["documented coverage does not promote candidate AI providers or models to production"]),
  metric("Asset Security Coverage", assetCovered, assetRelevant.length, ["release/security/ASSET_SECURITY_TRACEABILITY_MATRIX.json"], [`${assetRelevant.length - assetCovered} asset-relevant products have no directly mapped candidate evidence`]),
];
const totalNumerator = metrics.reduce((sum, item) => sum + item.numerator, 0);
const totalDenominator = metrics.reduce((sum, item) => sum + item.denominator, 0);

const report = {
  schemaVersion: "1.0.0",
  generatedAt: matrix.generatedAt,
  controllerSourceCommit: matrix.controllerSourceCommit,
  status: "ACTIVE",
  completionRule: "Evidence-weighted gate units; no subjective rounding and no file-count proxy",
  metrics,
  overallFable5TestnetGoal: { numerator: totalNumerator, denominator: totalDenominator, percent: percent(totalNumerator, totalDenominator) },
  hardLocks: {
    all36MachineReadable: true,
    allValidSourcePushed: synced === 36,
    tier1CentralAcceptanceComplete: false,
    fourValidatorRestartRestoreComplete: false,
    atLeastEightE2EComplete: completedE2E >= 8,
    websiteMainVercelSourceEqualityProven: false,
    independentPublicProofComplete: false,
    externalProductionClaimsRemainFalse: matrix.products.every((product) => !product.states.mainnetReleased),
  },
};

const output = "release/integration/FABLE5_COMPLETION_AUDIT.json";
if (process.argv.includes("--check")) {
  if (JSON.stringify(read(output)) !== JSON.stringify(report)) throw new Error(`${output} is stale; refresh it`);
  console.log("Fable5 completion audit check passed");
} else {
  fs.writeFileSync(path.join(root, output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${output}: ${report.overallFable5TestnetGoal.percent}% evidence-weighted completion`);
}
