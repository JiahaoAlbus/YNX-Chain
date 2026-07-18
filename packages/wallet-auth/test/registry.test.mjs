import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { centralRegistrationByProduct, parseCentralRegistryDocument, WalletAuthError } from "../src/index.js";

const source = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));

test("central candidate contains exactly 25 unique, least-privilege, disabled products", () => {
  const registry = parseCentralRegistryDocument(source);
  assert.equal(registry.products.length, 25);
  assert.equal(registry.products.every((product) => product.reviewState === "pending-review" && !product.enabled), true);
  assert.equal(registry.products.every((product) => product.scopes.length <= product.maxScopes && product.scopes.every((scope) => !scope.includes("*"))), true);
  assert.throws(() => centralRegistrationByProduct(registry, "social"), code("REGISTRY_DISABLED"));
  assert.equal(centralRegistrationByProduct(registry, "social", { requireEnabled: false }).bundleId, "com.ynx.social");
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
