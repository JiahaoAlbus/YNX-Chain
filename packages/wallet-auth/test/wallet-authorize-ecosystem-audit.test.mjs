import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const audit = JSON.parse(await readFile(new URL("../../../release/integration/wallet-authorize-ecosystem-source-runtime-audit-20260821.json", import.meta.url), "utf8"));
const registry = JSON.parse(await readFile(new URL("../product-session-registry.json", import.meta.url), "utf8"));

test("ecosystem authorize audit covers every registered client exactly once", () => {
  assert.equal(audit.registeredClientCount, 13);
  assert.equal(audit.requiredProductCount, 12);
  assert.equal(audit.nonProductRegistryClientCount, 1);
  assert.deepEqual(audit.products.map(({ productId }) => productId).sort(), registry.products.map(({ productId }) => productId).sort());
  assert.equal(new Set(audit.products.map(({ productId }) => productId)).size, audit.products.length);
});

test("v1 consumer audit remains an immutable historical checkpoint", () => {
  const frozenFindings = [...audit.scanner.registeredProductFindings, ...audit.scanner.otherEcosystemFindings];
  assert.equal(frozenFindings.length, audit.scanner.findingCount);
  assert.equal(new Set(frozenFindings.map(({ file, line, code }) => `${file}:${line}:${code}`)).size, frozenFindings.length);
});

test("no registered product is promoted without the three owner evidence segments", () => {
  assert.equal(audit.productsConnected, 0);
  assert.equal(audit.productsMigratedV2, 0);
  assert.equal(audit.truth.registryV3Public, false);
  assert.equal(audit.truth.deployedPublic, false);
  assert.deepEqual(audit.requiredOwnerEvidenceSegments.map(({ segment }) => segment), ["runtime-source", "public-gateway-v2", "visible-platform-lifecycle"]);
  for (const product of audit.products) {
    assert.equal(product.runtime.connected, false, product.productId);
    assert.equal(product.runtime.productSessionV2, false, product.productId);
    assert.ok(product.blocker.length > 20, product.productId);
    assert.ok(product.migrationHandoff.length >= 3, product.productId);
  }
});

test("every EVM product handoff addresses the exact 0x1917 MetaMask flow", () => {
  for (const product of audit.products.filter(({ evmCompatible }) => evmCompatible)) {
    assert.notEqual(product.audit.metaMask0x1917, "not-applicable", product.productId);
    assert.ok(product.migrationHandoff.join(" ").includes("0x1917"), product.productId);
  }
});
