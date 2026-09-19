import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { centralRegisteredWebOrigins, centralRegistrationByProduct, migrateCentralRegistryDocumentV1, parseCentralRegistryDocument, WalletAuthError } from "../src/index.js";

const source = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));

test("central candidate contains exactly 26 unique, least-privilege, disabled products", () => {
  const registry = parseCentralRegistryDocument(source);
  assert.equal(registry.products.length, 26);
  assert.equal(registry.products.every((product) => product.reviewState === "pending-review" && !product.enabled), true);
  assert.equal(registry.products.every((product) => product.scopes.length <= product.maxScopes && product.scopes.every((scope) => !scope.includes("*"))), true);
  assert.throws(() => centralRegistrationByProduct(registry, "social"), code("REGISTRY_DISABLED"));
  assert.equal(centralRegistrationByProduct(registry, "social", { requireEnabled: false }).bundleId, "com.ynx.social");
  assert.deepEqual(centralRegistrationByProduct(registry, "quant", { requireEnabled: false }).scopes, ["quant:account", "quant:mandate:create", "quant:mandate:execute", "quant:mandate:revoke"]);
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

test("registry v4 binds exact HTTPS web origins and migrates to v5 without inferred browser access", () => {
  const v4 = structuredClone(source);
  for (const product of v4.products) { product.schemaVersion = 4; product.webOrigins = []; }
  const social = v4.products.find(product => product.productId === "social");
  social.reviewState = "approved";
  social.enabled = true;
  social.webOrigins = ["https://social.ynxweb4.com"];
  const parsed = parseCentralRegistryDocument(v4);
  assert.equal(parsed.products.find(product => product.productId === "social").schemaVersion, 5);
  assert.deepEqual(centralRegisteredWebOrigins(parsed), ["https://social.ynxweb4.com"]);
  assert.deepEqual(centralRegisteredWebOrigins(source), []);
  const insecure = structuredClone(v4);
  insecure.products.find(product => product.productId === "social").webOrigins = ["http://social.ynxweb4.com"];
  assert.throws(() => parseCentralRegistryDocument(insecure), code("INVALID_REGISTRY"));
  const path = structuredClone(v4);
  path.products.find(product => product.productId === "social").webOrigins = ["https://social.ynxweb4.com/callback"];
  assert.throws(() => parseCentralRegistryDocument(path), code("INVALID_REGISTRY"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
