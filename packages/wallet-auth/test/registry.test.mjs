import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { centralRegistrationByProduct, migrateCentralRegistryDocumentV1, parseCentralRegistryDocument, WalletAuthError } from "../src/index.js";

const source = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));

test("central registry contains 26 unique, least-privilege products with Exchange, Finance, Quant and Shop approved", () => {
  const registry = parseCentralRegistryDocument(source);
  assert.equal(registry.products.length, 26);
  const approved = registry.products.filter((product) => product.enabled);
  assert.deepEqual(approved.map((product) => product.productId), ["exchange", "finance", "quant", "shop"]);
  assert.equal(approved.every((product) => product.reviewState === "approved"), true);
  assert.equal(registry.products.filter((product) => !product.enabled).every((product) => product.reviewState === "pending-review"), true);
  assert.equal(registry.products.every((product) => product.scopes.length <= product.maxScopes && product.scopes.every((scope) => !scope.includes("*"))), true);
  assert.throws(() => centralRegistrationByProduct(registry, "social"), code("REGISTRY_DISABLED"));
  assert.equal(centralRegistrationByProduct(registry, "social", { requireEnabled: false }).bundleId, "com.ynx.social");
  assert.deepEqual(centralRegistrationByProduct(registry, "quant", { requireEnabled: false }).scopes, ["quant:account", "quant:mandate:create", "quant:mandate:execute", "quant:mandate:revoke"]);
  assert.equal(centralRegistrationByProduct(registry, "quant").enabled, true);
});

test("registry v1 migrates deterministically by adding disabled least-privilege Quant", () => {
  const legacy = structuredClone(source);
  legacy.registryVersion = 1;
  legacy.products = legacy.products.filter(product => product.productId !== "quant");
  const migrated = migrateCentralRegistryDocumentV1(legacy);
  assert.deepEqual(migrated.products.map(product => product.productId), parseCentralRegistryDocument(source).products.map(product => product.productId));
  assert.equal(centralRegistrationByProduct(migrated, "quant", { requireEnabled: false }).enabled, false);
  const tampered = structuredClone(legacy);
  tampered.products[0].productId = "unknown-replacement";
  assert.throws(() => migrateCentralRegistryDocumentV1(tampered), code("INVALID_REGISTRY"));
});

test("central registry rejects enablement without approval and identity tamper", () => {
  const enabled = structuredClone(source); enabled.products[0].enabled = true;
  assert.throws(() => parseCentralRegistryDocument(enabled), code("INVALID_REGISTRY"));
  const mismatch = structuredClone(source); mismatch.products[0].productClientId = mismatch.products[1].productClientId;
  assert.throws(() => parseCentralRegistryDocument(mismatch), code("INVALID_REGISTRY"));
  const wildcard = structuredClone(source); wildcard.products[0].scopes = ["ai:*"]; wildcard.products[0].maxScopes = 1;
  assert.throws(() => parseCentralRegistryDocument(wildcard), code("INVALID_REGISTRY"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
