import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WALLET_PRODUCT_MIGRATION_PRODUCTS,
  WALLET_PRODUCT_MIGRATION_SCENARIOS,
  parseWalletProductMigrationMatrix,
  walletProductMigrationSummary,
} from "../src/index.js";

const matrixPath = new URL("../integration/product-migration-matrix-v2.json", import.meta.url);

async function fixture() {
  return JSON.parse(await readFile(matrixPath, "utf8"));
}

function migratedEvidence() {
  return [...WALLET_PRODUCT_MIGRATION_SCENARIOS].sort().map((scenario) => ({
    platform: "web",
    scenario,
    status: "PASSED",
    evidencePath: `release/evidence/social-web-${scenario}.json`,
    evidenceSha256: "a".repeat(64),
    requestIds: [`req_social_${scenario.replaceAll("-", "_")}`],
    screenshots: [`release/evidence/social-web-${scenario}.png`],
    testedAt: "2026-08-20T00:00:00.000Z",
  }));
}

test("truthful migration matrix covers the exact 12 products without claiming migration", async () => {
  const matrix = parseWalletProductMigrationMatrix(await fixture());
  assert.deepEqual(matrix.products.map(({ product }) => product), WALLET_PRODUCT_MIGRATION_PRODUCTS);
  assert.deepEqual(walletProductMigrationSummary(matrix), {
    complete: false,
    counts: { NO_EVIDENCE: 8, PROTOCOL_ONLY: 4, IN_PROGRESS: 0, MIGRATED: 0 },
    migratedProducts: [],
    totalProducts: 12,
  });
});

test("MIGRATED requires exact source, SDK, platform, request and visible scenario evidence", async () => {
  const matrix = await fixture();
  matrix.products[0] = {
    product: "Social",
    status: "MIGRATED",
    sourceCommit: "1".repeat(40),
    sdkSourceCommit: "2".repeat(40),
    supportedPlatforms: ["web"],
    evidence: migratedEvidence(),
    unverifiedScenarios: [],
  };
  const summary = walletProductMigrationSummary(matrix);
  assert.deepEqual(summary.migratedProducts, ["Social"]);
  assert.equal(summary.complete, false);

  const withoutScreenshot = structuredClone(matrix);
  withoutScreenshot.products[0].evidence[0].screenshots = [];
  assert.throws(() => parseWalletProductMigrationMatrix(withoutScreenshot), (error) => error.code === "MIGRATION_MATRIX_INVALID");

  const missingScenario = structuredClone(matrix);
  const removed = missingScenario.products[0].evidence.pop();
  missingScenario.products[0].unverifiedScenarios = [removed.scenario];
  assert.throws(() => parseWalletProductMigrationMatrix(missingScenario), (error) => error.code === "MIGRATION_UNPROVEN");
});

test("status inflation, product reordering and false no-evidence commits fail closed", async () => {
  const inflated = await fixture();
  inflated.products[0].status = "MIGRATED";
  inflated.products[0].unverifiedScenarios = [];
  assert.throws(() => parseWalletProductMigrationMatrix(inflated), (error) => error.code === "MIGRATION_UNPROVEN");

  const reordered = await fixture();
  [reordered.products[0], reordered.products[1]] = [reordered.products[1], reordered.products[0]];
  assert.throws(() => parseWalletProductMigrationMatrix(reordered), (error) => error.code === "MIGRATION_MATRIX_INVALID");

  const invented = await fixture();
  invented.products[2].sourceCommit = "3".repeat(40);
  assert.throws(() => parseWalletProductMigrationMatrix(invented), (error) => error.code === "MIGRATION_UNPROVEN");
});

test("IN_PROGRESS is accepted only for a genuinely partial evidence set", async () => {
  const matrix = await fixture();
  const evidence = migratedEvidence().slice(0, 2);
  matrix.products[0] = {
    product: "Social",
    status: "IN_PROGRESS",
    sourceCommit: "4".repeat(40),
    sdkSourceCommit: "5".repeat(40),
    supportedPlatforms: ["web"],
    evidence,
    unverifiedScenarios: [...WALLET_PRODUCT_MIGRATION_SCENARIOS].filter((scenario) => !evidence.some((item) => item.scenario === scenario)).sort(),
  };
  assert.equal(parseWalletProductMigrationMatrix(matrix).products[0].status, "IN_PROGRESS");
});
