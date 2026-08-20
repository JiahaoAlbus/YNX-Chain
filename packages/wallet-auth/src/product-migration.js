import { WalletAuthError } from "./canonical.js";

export const WALLET_PRODUCT_MIGRATION_SCHEMA_VERSION = 1;
export const WALLET_PRODUCT_MIGRATION_PRODUCTS = Object.freeze([
  "Social", "Pay", "Shop", "Exchange", "Quant", "Developer",
  "Video", "Creator Studio", "Calendar", "Finance", "DEX", "Card",
]);
export const WALLET_PRODUCT_MIGRATION_SCENARIOS = Object.freeze([
  "wallet-not-installed", "wallet-installed", "approved", "rejected",
  "timeout", "revoked", "second-open", "chain-temporary-disconnect-retry",
]);
export const WALLET_PRODUCT_MIGRATION_PLATFORMS = Object.freeze([
  "android", "ios", "macos", "web", "windows",
]);

const STATUSES = new Set(["NO_EVIDENCE", "PROTOCOL_ONLY", "IN_PROGRESS", "MIGRATED"]);
const RESULT_STATUSES = new Set(["PASSED", "FAILED"]);
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const TOKEN = /^[A-Za-z0-9._:-]{8,200}$/;

function fail(code, details) {
  throw new WalletAuthError(code, details);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("MIGRATION_MATRIX_INVALID", { path });
  return value;
}

function exactKeys(value, expected, path) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail("MIGRATION_MATRIX_INVALID", { path, expected: wanted, actual });
}

function string(value, path) {
  if (typeof value !== "string" || value.length === 0) fail("MIGRATION_MATRIX_INVALID", { path });
  return value;
}

function stringList(value, path, allowed = null) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    fail("MIGRATION_MATRIX_INVALID", { path });
  }
  const sorted = [...value].sort();
  if (new Set(value).size !== value.length || JSON.stringify(value) !== JSON.stringify(sorted)) {
    fail("MIGRATION_MATRIX_INVALID", { path, reason: "list-must-be-unique-and-sorted" });
  }
  if (allowed && value.some((item) => !allowed.includes(item))) fail("MIGRATION_MATRIX_INVALID", { path, reason: "unknown-value" });
  return Object.freeze([...value]);
}

function nullableCommit(value, path) {
  if (value === null) return null;
  if (typeof value !== "string" || !COMMIT.test(value)) fail("MIGRATION_MATRIX_INVALID", { path });
  return value;
}

function repositoryPath(value, path) {
  string(value, path);
  if (value.startsWith("/") || value.includes("..") || value.includes("\\") || value.includes("://")) {
    fail("MIGRATION_MATRIX_INVALID", { path, reason: "unsafe-repository-path" });
  }
  return value;
}

function timestamp(value, path) {
  string(value, path);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail("MIGRATION_MATRIX_INVALID", { path });
  return value;
}

function evidenceRecord(input, index) {
  const value = object(input, `products[].evidence[${index}]`);
  exactKeys(value, ["platform", "scenario", "status", "evidencePath", "evidenceSha256", "requestIds", "screenshots", "testedAt"], `products[].evidence[${index}]`);
  if (!WALLET_PRODUCT_MIGRATION_PLATFORMS.includes(value.platform)) fail("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].platform` });
  if (!WALLET_PRODUCT_MIGRATION_SCENARIOS.includes(value.scenario)) fail("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].scenario` });
  if (!RESULT_STATUSES.has(value.status)) fail("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].status` });
  repositoryPath(value.evidencePath, `products[].evidence[${index}].evidencePath`);
  if (typeof value.evidenceSha256 !== "string" || !SHA256.test(value.evidenceSha256)) fail("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].evidenceSha256` });
  const requestIds = stringList(value.requestIds, `products[].evidence[${index}].requestIds`);
  if (requestIds.some((item) => !TOKEN.test(item))) fail("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].requestIds` });
  const screenshots = stringList(value.screenshots, `products[].evidence[${index}].screenshots`);
  if (screenshots.length === 0) fail("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].screenshots`, reason: "visible-evidence-required" });
  screenshots.forEach((item, screenshotIndex) => repositoryPath(item, `products[].evidence[${index}].screenshots[${screenshotIndex}]`));
  return Object.freeze({ ...value, requestIds, screenshots, testedAt: timestamp(value.testedAt, `products[].evidence[${index}].testedAt`) });
}

function productRecord(input, expectedProduct) {
  const value = object(input, `products.${expectedProduct}`);
  exactKeys(value, ["product", "status", "sourceCommit", "sdkSourceCommit", "supportedPlatforms", "evidence", "unverifiedScenarios"], `products.${expectedProduct}`);
  if (value.product !== expectedProduct || !STATUSES.has(value.status)) fail("MIGRATION_MATRIX_INVALID", { product: expectedProduct });
  const sourceCommit = nullableCommit(value.sourceCommit, `products.${expectedProduct}.sourceCommit`);
  const sdkSourceCommit = nullableCommit(value.sdkSourceCommit, `products.${expectedProduct}.sdkSourceCommit`);
  const supportedPlatforms = stringList(value.supportedPlatforms, `products.${expectedProduct}.supportedPlatforms`, WALLET_PRODUCT_MIGRATION_PLATFORMS);
  const evidence = Object.freeze(value.evidence.map(evidenceRecord));
  const evidenceKeys = evidence.map((item) => `${item.platform}:${item.scenario}`);
  if (new Set(evidenceKeys).size !== evidenceKeys.length || JSON.stringify(evidenceKeys) !== JSON.stringify([...evidenceKeys].sort())) {
    fail("MIGRATION_MATRIX_INVALID", { product: expectedProduct, reason: "evidence-must-be-unique-and-sorted" });
  }
  if (evidence.some((item) => !supportedPlatforms.includes(item.platform))) fail("MIGRATION_MATRIX_INVALID", { product: expectedProduct, reason: "evidence-platform-not-supported" });
  const unverifiedScenarios = stringList(value.unverifiedScenarios, `products.${expectedProduct}.unverifiedScenarios`, WALLET_PRODUCT_MIGRATION_SCENARIOS);
  const required = supportedPlatforms.flatMap((platform) => WALLET_PRODUCT_MIGRATION_SCENARIOS.map((scenario) => `${platform}:${scenario}`));
  const passed = new Set(evidence.filter((item) => item.status === "PASSED").map((item) => `${item.platform}:${item.scenario}`));
  const failed = evidence.some((item) => item.status === "FAILED");
  const missingScenarios = [...new Set(required.filter((key) => !passed.has(key)).map((key) => key.slice(key.indexOf(":") + 1)))].sort();
  const expectedUnverified = value.status === "NO_EVIDENCE" || value.status === "PROTOCOL_ONLY"
    ? [...WALLET_PRODUCT_MIGRATION_SCENARIOS].sort()
    : missingScenarios;
  if (JSON.stringify(unverifiedScenarios) !== JSON.stringify(expectedUnverified)) fail("MIGRATION_MATRIX_INVALID", { product: expectedProduct, reason: "unverified-scenarios-mismatch", expected: expectedUnverified });

  if (value.status === "NO_EVIDENCE" || value.status === "PROTOCOL_ONLY") {
    if (sourceCommit !== null || sdkSourceCommit !== null || supportedPlatforms.length || evidence.length) fail("MIGRATION_UNPROVEN", { product: expectedProduct, status: value.status });
  } else if (value.status === "MIGRATED") {
    if (!sourceCommit || !sdkSourceCommit || !supportedPlatforms.includes("web") || required.length === 0 || failed || passed.size !== required.length || unverifiedScenarios.length) {
      fail("MIGRATION_UNPROVEN", { product: expectedProduct, status: value.status });
    }
  } else if (!sourceCommit || !sdkSourceCommit || supportedPlatforms.length === 0 || (evidence.length === required.length && !failed && missingScenarios.length === 0)) {
    fail("MIGRATION_UNPROVEN", { product: expectedProduct, status: value.status });
  }
  return Object.freeze({ ...value, sourceCommit, sdkSourceCommit, supportedPlatforms, evidence, unverifiedScenarios });
}

export function parseWalletProductMigrationMatrix(input) {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  object(value, "matrix");
  exactKeys(value, ["schemaVersion", "protocol", "products"], "matrix");
  if (value.schemaVersion !== WALLET_PRODUCT_MIGRATION_SCHEMA_VERSION || value.protocol !== "wallet-auth-v2") fail("MIGRATION_MATRIX_INVALID", { path: "matrix" });
  if (!Array.isArray(value.products) || value.products.length !== WALLET_PRODUCT_MIGRATION_PRODUCTS.length) fail("MIGRATION_MATRIX_INVALID", { path: "products" });
  const products = Object.freeze(value.products.map((item, index) => productRecord(item, WALLET_PRODUCT_MIGRATION_PRODUCTS[index])));
  return Object.freeze({ schemaVersion: value.schemaVersion, protocol: value.protocol, products });
}

export function walletProductMigrationSummary(input) {
  const matrix = parseWalletProductMigrationMatrix(input);
  const counts = Object.freeze(Object.fromEntries([...STATUSES].map((status) => [status, matrix.products.filter((item) => item.status === status).length])));
  const migratedProducts = Object.freeze(matrix.products.filter((item) => item.status === "MIGRATED").map((item) => item.product));
  return Object.freeze({ complete: migratedProducts.length === WALLET_PRODUCT_MIGRATION_PRODUCTS.length, counts, migratedProducts, totalProducts: matrix.products.length });
}
