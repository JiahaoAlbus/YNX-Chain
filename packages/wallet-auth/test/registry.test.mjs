import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { centralRegistrationByProduct, migrateCentralRegistryDocumentV1, parseCentralRegistryDocument, WalletAuthError } from "../src/index.js";

const source = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));

test("central registry contains 26 unique, least-privilege products with Calendar, Developer and accepted Testnet products approved", () => {
  const registry = parseCentralRegistryDocument(source);
  assert.equal(registry.products.length, 26);
  const approved = registry.products.filter((product) => product.enabled);
  assert.deepEqual(approved.map((product) => product.productId), ["calendar", "developer", "dex", "exchange", "finance", "mail", "merchant-console", "quant", "seller-console", "shop", "social"]);
  assert.equal(approved.every((product) => product.reviewState === "approved"), true);
  assert.equal(registry.products.filter((product) => !product.enabled).every((product) => product.reviewState === "pending-review"), true);
  assert.equal(registry.products.every((product) => product.scopes.length <= product.maxScopes && product.scopes.every((scope) => !scope.includes("*"))), true);
  assert.throws(() => centralRegistrationByProduct(registry, "ai"), code("REGISTRY_DISABLED"));
  const social = centralRegistrationByProduct(registry, "social");
  assert.equal(social.bundleId, "com.ynx.social");
  assert.deepEqual(social.callbacks, ["ynx-social://com.ynx.social"]);
  assert.deepEqual(social.scopes, ["account:read", "profile:link"]);
  assert.equal(social.sessionDurationSeconds, 240);
  assert.deepEqual(centralRegistrationByProduct(registry, "quant", { requireEnabled: false }).scopes, ["quant:account", "quant:mandate:create", "quant:mandate:execute", "quant:mandate:revoke"]);
  assert.equal(centralRegistrationByProduct(registry, "quant").enabled, true);
  const calendar = centralRegistrationByProduct(registry, "calendar");
  assert.equal(calendar.bundleId, "com.ynxweb4.calendar");
  assert.deepEqual(calendar.callbacks, ["ynxcalendar://wallet-auth/callback"]);
  assert.deepEqual(calendar.scopes, ["calendar:account", "calendar:recover"]);
  assert.deepEqual(calendar.productDeviceAlgorithms, ["p256-sha256"]);
  const mail = centralRegistrationByProduct(registry, "mail");
  assert.equal(mail.productClientId, "ynx-mail-v1");
  assert.equal(mail.bundleId, "com.ynxweb4.mail");
  assert.deepEqual(mail.callbacks, ["ynxmail://wallet-auth/callback"]);
  assert.deepEqual(mail.scopes, ["mail:account", "mail:recover"]);
  assert.equal(mail.sessionDurationSeconds, 240);
  const developer = centralRegistrationByProduct(registry, "developer");
  assert.equal(developer.bundleId, "com.ynxweb4.developer.testnetpreview");
  assert.deepEqual(developer.callbacks, ["ynxdeveloper://wallet-auth/callback"]);
  assert.deepEqual(developer.scopes, ["account:read", "developer:deploy"]);
  assert.equal(developer.sessionDurationSeconds, 180);
  const dex = centralRegistrationByProduct(registry, "dex");
  assert.equal(dex.productClientId, "ynx-dex-web-v1");
  assert.equal(dex.bundleId, "com.ynxweb4.dex.web");
  assert.deepEqual(dex.callbacks, ["https://dex.ynxweb4.com/wallet-auth/callback"]);
  assert.deepEqual(dex.scopes, ["account:read", "dex:positions:read", "dex:transaction:request"]);
  const merchant = centralRegistrationByProduct(registry, "merchant-console");
  assert.equal(merchant.requestingProduct, "pay-merchant");
  assert.deepEqual(merchant.callbacks, ["https://pay.ynxweb4.com/merchant/wallet-auth/callback"]);
  assert.deepEqual(merchant.scopes, ["account:read", "merchant:session:create"]);
  assert.equal(merchant.sessionDurationSeconds, 300);
  const seller = centralRegistrationByProduct(registry, "seller-console");
  assert.equal(seller.requestingProduct, "seller-console");
  assert.equal(seller.productClientId, "ynx-seller-v1");
  assert.deepEqual(seller.callbacks, ["ynxseller://wallet-auth/callback"]);
  assert.deepEqual(seller.scopes, ["account:read", "shop:seller:operate"]);
  assert.equal(seller.sessionDurationSeconds, 180);
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
