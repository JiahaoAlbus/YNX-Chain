import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "../..");
const registry = JSON.parse(readFileSync(resolve(packageRoot, "product-session-registry.json"), "utf8"));
const matrix = JSON.parse(readFileSync(resolve(repositoryRoot, "release/integration/wallet-product-session-router-migration.json"), "utf8"));

test("migration matrix covers the exact registry and cites only branch-local evidence", () => {
  assert.deepEqual(matrix.products.map((item) => item.productId), registry.products.map((item) => item.productId));
  assert.equal(matrix.productRuntimeMigrationCount, matrix.products.filter((item) => item.migrated).length);
  assert.equal(matrix.fixedProductCount, matrix.products.filter((item) => item.migrated).length);
  for (const product of matrix.products) {
    assert.ok(["contract-only", "legacy-direct", "shared-sdk-v1", "migrated-v2"].includes(product.consumer));
    assert.ok(Array.isArray(product.evidence) && product.evidence.length > 0);
    for (const path of product.evidence) assert.equal(existsSync(resolve(repositoryRoot, path)), true, `${product.productId} evidence is missing: ${path}`);
  }
});

test("legacy and shared-v1 consumers cannot be presented as v2 migrations", () => {
  for (const product of matrix.products) {
    const sources = product.evidence.map((path) => readFileSync(resolve(repositoryRoot, path), "utf8")).join("\n");
    if (product.consumer === "legacy-direct") assert.match(sources, /ynxwallet:\/\/authorize|wallet-auth/i);
    if (product.consumer === "shared-sdk-v1") {
      assert.match(sources, /@ynx-chain\/wallet-auth/);
      assert.doesNotMatch(sources, /RecoverableProductSessionClient|\/v2\/product-sessions\//);
    }
    if (product.consumer !== "migrated-v2") assert.equal(product.migrated, false);
  }
});

test("migrated-v2 requires separate runtime, Gateway and visible platform evidence", () => {
  for (const product of matrix.products.filter((item) => item.migrated)) {
    assert.equal(product.consumer, "migrated-v2");
    for (const field of ["runtimeEvidence", "gatewayEvidence", "platformEvidence"]) {
      assert.ok(Array.isArray(product[field]) && product[field].length > 0, `${product.productId} lacks ${field}`);
      for (const path of product[field]) assert.equal(existsSync(resolve(repositoryRoot, path)), true, `${product.productId} ${field} is missing: ${path}`);
    }
    const runtime = product.runtimeEvidence.map((path) => readFileSync(resolve(repositoryRoot, path), "utf8")).join("\n");
    const gateway = product.gatewayEvidence.map((path) => readFileSync(resolve(repositoryRoot, path), "utf8")).join("\n");
    assert.match(runtime, /RecoverableProductSessionClient/);
    assert.match(gateway, /\/v2\/product-sessions\/(challenge|complete|introspect)/);
  }
});
