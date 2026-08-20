import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionRequest, migrateProductSessionGatewayNodeStateRegistryV2, parseProductSessionRegistry,
  productSessionRegistryV2MigrationSource, ProductSessionGatewayKernel, signProductSessionApproval, signProductSessionChallenge,
} from "../src/index.js";

const currentRegistry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const previousRegistry = { ...currentRegistry, schemaVersion: 2, products: currentRegistry.products.filter((product) => product.productId !== "wallet-web-companion").map(({ retiredClients: _retiredClients, ...product }) => product) };
const previousRuntimeRegistry = { ...currentRegistry, products: currentRegistry.products.filter((product) => product.productId !== "wallet-web-companion").map((product) => ({ ...product, retiredClients: [] })) };
const NOW = new Date("2026-08-14T01:00:00.000Z");
const secret = Buffer.alloc(32, 33), secretText = secret.toString("base64url");
const deviceKey = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");
const token = (label) => createHash("sha256").update(label).digest("base64url");

test("reviewed registry v2 copied state migrates deterministically to v3 and purges retired authority", () => {
  let sequence = 0;
  const prior = new ProductSessionGatewayKernel(previousRuntimeRegistry, () => token(`migration-${sequence++}`));
  const shop = previousRegistry.products.find((item) => item.productId === "shop");
  const pending = createProductSessionRequest(previousRuntimeRegistry, {
    productId: "shop", platform: "android", deviceId: "migration-device-001", deviceKey, scopes: shop.scopes,
    purpose: "Migrate the exact retired Shop Android authority.", nonce: token("migration-nonce"), state: token("migration-state"),
  }, NOW);
  const approval = signProductSessionApproval(previousRuntimeRegistry, pending, { accountSecret: "1".padStart(64, "0"), scopes: pending.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const challengeBody = { request: pending, approval };
  const challenge = JSON.parse(dispatch(prior, "req_migration_challenge_01", "/v2/product-sessions/challenge", challengeBody).body).result;
  const completeBody = { request: pending, approval, completion: signProductSessionChallenge(challenge, secretText) };
  assert.equal(dispatch(prior, "req_migration_complete_001", "/v2/product-sessions/complete", completeBody).status, 200);
  const sourceSnapshot = prior.snapshot();
  const sourceEnvelope = envelope(previousRegistry, sourceSnapshot);
  const sourceBytes = canonicalJSON(sourceEnvelope);
  const migrated = migrateProductSessionGatewayNodeStateRegistryV2({ currentRegistry, previousRegistry, stateEnvelope: sourceEnvelope });
  assert.equal(canonicalJSON(sourceEnvelope), sourceBytes);
  assert.equal(migrated.registrySha256, sha256(canonicalJSON(parseProductSessionRegistry(currentRegistry))));
  assert.equal(migrated.snapshot.authority.revokedSessions.length, 1);
  assert.equal(migrated.snapshot.authority.revokedDevices.length, 1);
  assert.equal(migrated.snapshot.authority.issuedChallenges.length, 0);
  assert.equal(migrated.snapshot.idempotency.length, 0);
  assert.equal(migrated.snapshotSha256, sha256(canonicalJSON(migrated.snapshot)));
  assert.deepEqual(migrateProductSessionGatewayNodeStateRegistryV2({ currentRegistry, previousRegistry, stateEnvelope: sourceEnvelope }), migrated);
});

test("unreviewed registry or copied-state tamper fails closed without changing its bytes", () => {
  const sourceEnvelope = envelope(previousRegistry, new ProductSessionGatewayKernel(previousRuntimeRegistry, () => token("unused")).snapshot());
  for (const input of [
    { currentRegistry: { ...currentRegistry, wallet: { ...currentRegistry.wallet, downloadUrl: "https://attacker.example/wallet" } }, previousRegistry, stateEnvelope: sourceEnvelope },
    { currentRegistry, previousRegistry: { ...previousRegistry, chainId: "ynx_attacker-1" }, stateEnvelope: sourceEnvelope },
    { currentRegistry, previousRegistry, stateEnvelope: { ...sourceEnvelope, registrySha256: "00".repeat(32) } },
    { currentRegistry, previousRegistry, stateEnvelope: { ...sourceEnvelope, snapshotSha256: "00".repeat(32) } },
  ]) {
    const before = canonicalJSON(input);
    assert.throws(() => migrateProductSessionGatewayNodeStateRegistryV2(input));
    assert.equal(canonicalJSON(input), before);
  }
});

function envelope(registry, snapshot) { return { registrySha256: sha256(canonicalJSON(productSessionRegistryV2MigrationSource(registry))), schemaVersion: 1, snapshot, snapshotSha256: sha256(canonicalJSON(snapshot)) }; }
function dispatch(kernel, requestId, path, body) { return kernel.dispatch({ requestId, method: "POST", path, body, proof: null, networkAvailable: true }, NOW); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
