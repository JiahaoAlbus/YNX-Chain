import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionRequest, migrateLegacy6cfProductSessionGatewayNodeState, migrateProductSessionGatewayNodeStateRegistryV2, parseProductSessionRegistry,
  productSessionRegistryV2MigrationSource, ProductSessionGatewayKernel, signProductSessionApproval, signProductSessionChallenge, WalletAuthError,
} from "../src/index.js";

const currentRegistry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const production6cfFormat = JSON.parse(readFileSync(new URL("../testdata/product-session-legacy-6cf-production-format-v1.json", import.meta.url), "utf8"));
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

test("exact production-format canonical 6cf envelope migrates only with mandatory source and registry file digests", () => {
  const snapshot = new ProductSessionGatewayKernel(previousRuntimeRegistry, () => token("unused")).snapshot();
  const stateBytes = canonicalJSON({ schemaVersion: 1, snapshot, snapshotDigest: sha256(canonicalJSON(snapshot)) });
  const previousRegistryBytes = `${canonicalJSON(previousRegistry)}\n`;
  const currentRegistryBytes = `${canonicalJSON(currentRegistry)}\n`;
  const input = {
    currentRegistryBytes,
    expectedCurrentRegistryFileSha256: sha256(currentRegistryBytes),
    expectedPreviousRegistryFileSha256: sha256(previousRegistryBytes),
    expectedSourceStateFileSha256: sha256(stateBytes),
    previousRegistryBytes,
    stateBytes,
  };
  const migrated = migrateLegacy6cfProductSessionGatewayNodeState(input);
  assert.equal(migrated.registrySha256, sha256(canonicalJSON(parseProductSessionRegistry(currentRegistry))));
  assert.equal(migrated.snapshotSha256, sha256(canonicalJSON(migrated.snapshot)));
  assert.deepEqual(migrateLegacy6cfProductSessionGatewayNodeState(input), migrated);
  for (const changed of [
    { expectedSourceStateFileSha256: "00".repeat(32) },
    { expectedPreviousRegistryFileSha256: "00".repeat(32) },
    { expectedCurrentRegistryFileSha256: "00".repeat(32) },
    { stateBytes: stateBytes.replace("snapshotDigest", "snapshotSha256") },
    { stateBytes: ` ${stateBytes}` },
    { stateBytes: `${stateBytes}\n` },
    { stateBytes: stateBytes.replace("{", '{"schemaVersion":1,') },
    { stateBytes: stateBytes.replace("{", '{"unknown":true,') },
    { stateBytes: `${stateBytes}{}` },
  ]) assert.throws(() => migrateLegacy6cfProductSessionGatewayNodeState({ ...input, ...changed }));
  for (const [label, malformed, code] of [
    ["trailing newline", `${stateBytes}\n`, "REGISTRY_STATE_MISMATCH"],
    ["duplicate root key", stateBytes.replace("{", '{"schemaVersion":1,'), "REGISTRY_STATE_MISMATCH"],
    ["unknown root key", stateBytes.replace("{", '{"unknown":true,'), "UNKNOWN_OR_MISSING_FIELD"],
    ["trailing JSON token", `${stateBytes}{}`, "INVALID_MIGRATION"],
  ]) {
    const before = malformed;
    assert.throws(
      () => migrateLegacy6cfProductSessionGatewayNodeState({ ...input, stateBytes: malformed, expectedSourceStateFileSha256: sha256(malformed) }),
      (error) => error instanceof WalletAuthError && error.code === code,
      label,
    );
    assert.equal(malformed, before);
  }
});

test("production 343f state fixture is bound to the exact 6cf no-trailing-byte writer without exporting private state", () => {
  assert.deepEqual(production6cfFormat, {
    schemaVersion: 1,
    fixtureClass: "digest-bound-production-format-without-state-contents",
    publicSourceCommit: "6cf3ef845202bd879ed94515a71b323dd2fc9e14",
    writerPath: "packages/wallet-auth/src/product-session-gateway-node-host.js",
    writerGitBlob: "07b55e35596a18b388e8e723b9f8b78a5c332db2",
    writerFileSha256: "7d05ffd24406b1702096beebacaeea54a43df03b52deba251a239d8252ca1b4b",
    stateFileSha256: "343f4cbbce0aed1e3cc5894156c4480e69dfc4775e0b347c63d555bd51790d23",
    stateFileBytes: 7608,
    stateRootFields: ["schemaVersion", "snapshot", "snapshotDigest"],
    encoding: "utf8-canonical-json-exactly-one-value-no-bom-no-trailing-bytes",
    trailingNewline: false,
    stateContentsIncluded: false,
    stateContentsExclusionReason: "Production Product Session state remains private; this fixture binds the directly read file digest and the exact public 6cf writer implementation without exporting state contents.",
  });
});

test("offline 6cf migration artifact creates one private output and rejects digest mismatch without output", () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-product-session-migrate-")); chmodSync(directory, 0o700);
  const snapshot = new ProductSessionGatewayKernel(previousRuntimeRegistry, () => token("unused")).snapshot();
  const paths = {
    current: join(directory, "current.json"), previous: join(directory, "previous.json"), source: join(directory, "source.json"),
    output: join(directory, "migrated.json"), rejected: join(directory, "rejected.json"),
  };
  writeFileSync(paths.current, `${canonicalJSON(currentRegistry)}\n`);
  writeFileSync(paths.previous, `${canonicalJSON(previousRegistry)}\n`);
  writeFileSync(paths.source, canonicalJSON({ schemaVersion: 1, snapshot, snapshotDigest: sha256(canonicalJSON(snapshot)) }), { mode: 0o600 });
  const base = [
    "--current-registry", paths.current,
    "--expected-current-registry-file-sha256", sha256(readFileSync(paths.current, "utf8")),
    "--expected-previous-registry-file-sha256", sha256(readFileSync(paths.previous, "utf8")),
    "--expected-source-state-file-sha256", sha256(readFileSync(paths.source, "utf8")),
    "--previous-registry", paths.previous,
    "--source-state", paths.source,
  ];
  const migrationScript = fileURLToPath(new URL("../scripts/ynx-wallet-product-session-state-migrate.mjs", import.meta.url));
  const success = spawnSync(process.execPath, [migrationScript, ...base, "--output-state", paths.output], { encoding: "utf8" });
  assert.equal(success.status, 0, success.stderr);
  const receipt = JSON.parse(success.stdout), output = JSON.parse(readFileSync(paths.output, "utf8"));
  assert.equal(receipt.migratedStateFileSha256, sha256(readFileSync(paths.output, "utf8")));
  assert.equal(output.registrySha256, receipt.registryStateBindingSha256);
  const failure = spawnSync(process.execPath, [migrationScript, ...base.map((value) => value === sha256(readFileSync(paths.source, "utf8")) ? "00".repeat(32) : value), "--output-state", paths.rejected], { encoding: "utf8" });
  assert.notEqual(failure.status, 0);
  assert.equal(existsSync(paths.rejected), false);
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
