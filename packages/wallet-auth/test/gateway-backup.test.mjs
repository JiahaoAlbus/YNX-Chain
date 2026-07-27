import assert from "node:assert/strict";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  canonicalJSON,
  centralProtocolEntry,
  createGatewayChallenge,
  createProductSessionProof,
  httpBodyDigest,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
} from "../src/index.js";
import {
  CANONICAL_GATEWAY_BACKUP_ALGORITHM,
  CANONICAL_GATEWAY_BACKUP_SCHEMA_VERSION,
  createGatewayStateBackup,
  decodeGatewayBackupKey,
  readGatewayStateEnvelope,
  restoreGatewayStateBackup,
  verifyGatewayStateBackup,
} from "../src/gateway-backup.js";
import * as packageBackup from "@ynx-chain/wallet-auth/gateway-backup";
import * as universalPackage from "@ynx-chain/wallet-auth";
import { CanonicalWalletGatewayNodeHost, encodeGatewayProofHeader } from "../src/gateway-node-host.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const BACKUP_TIME = new Date("2026-07-15T12:05:00.000Z");
const VERIFY_TIME = new Date("2026-07-15T12:06:00.000Z");
const KEY = Buffer.alloc(32, 0x27);
const WRONG_KEY = Buffer.alloc(32, 0x41);

function approvedRegistry() {
  const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  for (const id of ["social", "wallet"]) {
    const product = registry.products.find((item) => item.productId === id);
    product.reviewState = "approved";
    product.enabled = true;
  }
  return registry;
}

function completion(registry, productId, nonce, challenge) {
  const registration = registry.products.find((item) => item.productId === productId);
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce,
    requestingProduct: registration.requestingProduct,
    productClientId: registration.productClientId,
    bundleId: registration.bundleId,
    callback: registration.callbacks[0],
    scopes: [...registration.scopes],
    purpose: `Authorize ${productId} before a recovery drill.`,
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  return {
    authorizationRequest,
    walletApproval,
    gatewayCompletion: signGatewayChallenge(createGatewayChallenge(walletApproval, {
      challenge,
      expiresAt: "2026-07-15T12:03:00.000Z",
    }, NOW), PRODUCT_DEVICE_SECRET),
  };
}

function proof(session, path, nonce) {
  const body = "{}";
  return encodeGatewayProofHeader(createProductSessionProof(session, {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest(body),
    nonce,
    issuedAt: NOW.toISOString(),
    expiresAt: "2026-07-15T12:00:30.000Z",
  }, PRODUCT_DEVICE_SECRET));
}

async function serve(host, run) {
  const server = createServer(host.handler());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function privateDirectory(root, name) {
  const directory = join(root, name);
  mkdirSync(directory, { mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}

function errorCode(code) {
  return (caught) => caught?.code === code;
}

async function nonEmptyGatewayState(statePath) {
  const registry = approvedRegistry();
  const host = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  let consumedProof;
  await serve(host, async (base) => {
    for (const [id, nonce, challenge] of [
      ["social", "social_backup_nonce_abcdefghijkl", "social_backup_challenge_abcdefgh"],
      ["wallet", "wallet_backup_nonce_abcdefghijkl", "wallet_backup_challenge_abcdefgh"],
    ]) {
      const response = await fetch(`${base}/v1/wallet/sessions/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: canonicalJSON(completion(registry, id, nonce, challenge)),
      });
      assert.equal(response.status, 200, await response.text());
    }
    const walletSession = host.snapshot().sessionStore.sessions.find((item) => item.productClientId === "ynx-wallet-v1");
    consumedProof = proof(walletSession, "/v1/wallet/sessions", "backup_consumed_proof_abcdefghijkl");
    const inventory = await fetch(`${base}/v1/wallet/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ynx-product-session-proof": consumedProof },
      body: "{}",
    });
    assert.equal(inventory.status, 200, await inventory.text());
  });
  return { consumedProof, host, registry, snapshot: host.snapshot() };
}

test("encrypted backup restores exact Gateway state and preserves consumed-proof replay rejection", async () => {
  const root = mkdtempSync(join(tmpdir(), "ynx-wallet-gateway-backup-"));
  chmodSync(root, 0o700);
  try {
    const sourceDirectory = privateDirectory(root, "source");
    const backupDirectory = privateDirectory(root, "backup");
    const restoreDirectory = privateDirectory(root, "restore");
    const statePath = join(sourceDirectory, "state.json");
    const backupPath = join(backupDirectory, "gateway.backup.json");
    const restoredPath = join(restoreDirectory, "state.json");
    const source = await nonEmptyGatewayState(statePath);
    const state = readGatewayStateEnvelope(statePath);

    const created = createGatewayStateBackup({ backupPath, key: KEY, statePath, now: () => BACKUP_TIME });
    assert.equal(created.algorithm, CANONICAL_GATEWAY_BACKUP_ALGORITHM);
    assert.equal(created.schemaVersion, CANONICAL_GATEWAY_BACKUP_SCHEMA_VERSION);
    assert.equal(created.sourceStateDigest, state.stateDigest);
    assert.equal(statSync(backupPath).mode & 0o777, 0o600);
    assert.equal(created.backupBytes, Buffer.byteLength(readFileSync(backupPath, "utf8")));

    const rawBackup = readFileSync(backupPath, "utf8");
    const walletSession = source.snapshot.sessionStore.sessions.find((item) => item.productClientId === "ynx-wallet-v1");
    for (const forbidden of [walletSession.account, walletSession.sessionBinding, "ynx-wallet-v1", "ynx-social-v1", KEY.toString("base64url"), ACCOUNT_SECRET, PRODUCT_DEVICE_SECRET]) {
      assert.equal(rawBackup.includes(forbidden), false);
    }

    const verified = verifyGatewayStateBackup({
      backupPath,
      key: KEY,
      maxAgeMs: 120_000,
      minimumCreatedAt: BACKUP_TIME.toISOString(),
      now: () => VERIFY_TIME,
    });
    assert.equal(verified.verified, true);
    assert.equal(verified.backupSha256, created.backupSha256);

    const restored = restoreGatewayStateBackup({
      backupPath,
      key: KEY,
      statePath: restoredPath,
      maxAgeMs: 120_000,
      minimumCreatedAt: BACKUP_TIME.toISOString(),
      now: () => VERIFY_TIME,
    });
    assert.equal(restored.restored, true);
    assert.equal(restored.restoredStateDigest, state.stateDigest);
    assert.equal(statSync(restoredPath).mode & 0o777, 0o600);

    const recoveredHost = new CanonicalWalletGatewayNodeHost(source.registry, { statePath: restoredPath, now: () => NOW });
    assert.deepEqual(recoveredHost.snapshot(), source.snapshot);
    await serve(recoveredHost, async (base) => {
      const replay = await fetch(`${base}/v1/wallet/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ynx-product-session-proof": source.consumedProof },
        body: "{}",
      });
      assert.equal(replay.status, 409);
      assert.equal((await replay.json()).error.code, "REPLAY");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backup authentication, recovery-point policy and no-overwrite controls fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "ynx-wallet-gateway-backup-policy-"));
  chmodSync(root, 0o700);
  try {
    const sourceDirectory = privateDirectory(root, "source");
    const backupDirectory = privateDirectory(root, "backup");
    const restoreDirectory = privateDirectory(root, "restore");
    const statePath = join(sourceDirectory, "state.json");
    const backupPath = join(backupDirectory, "gateway.backup.json");
    const targetPath = join(restoreDirectory, "state.json");
    new CanonicalWalletGatewayNodeHost(approvedRegistry(), { statePath, now: () => NOW });
    createGatewayStateBackup({ backupPath, key: KEY, statePath, now: () => BACKUP_TIME });

    assert.throws(() => verifyGatewayStateBackup({ backupPath, key: WRONG_KEY, now: () => VERIFY_TIME }), errorCode("BACKUP_TAMPERED"));
    assert.throws(() => verifyGatewayStateBackup({ backupPath, key: KEY, minimumCreatedAt: "2026-07-15T12:05:01.000Z", now: () => VERIFY_TIME }), errorCode("BACKUP_ROLLBACK"));
    assert.throws(() => verifyGatewayStateBackup({ backupPath, key: KEY, maxAgeMs: 59_999, now: () => VERIFY_TIME }), errorCode("BACKUP_EXPIRED"));
    assert.throws(() => verifyGatewayStateBackup({ backupPath, key: KEY, minimumCreatedAt: "not-a-time", now: () => VERIFY_TIME }), errorCode("INVALID_BACKUP_POLICY"));
    assert.throws(() => createGatewayStateBackup({ backupPath, key: KEY, statePath, now: () => BACKUP_TIME }), errorCode("BACKUP_EXISTS"));

    writeFileSync(targetPath, "do-not-overwrite", { mode: 0o600 });
    assert.throws(() => restoreGatewayStateBackup({ backupPath, key: KEY, statePath: targetPath, now: () => VERIFY_TIME }), errorCode("RESTORE_TARGET_EXISTS"));
    assert.equal(readFileSync(targetPath, "utf8"), "do-not-overwrite");

    const futurePath = join(backupDirectory, "future.backup.json");
    createGatewayStateBackup({ backupPath: futurePath, key: KEY, statePath, now: () => new Date("2026-07-15T12:12:00.000Z") });
    assert.throws(() => verifyGatewayStateBackup({ backupPath: futurePath, key: KEY, now: () => BACKUP_TIME }), errorCode("BACKUP_FUTURE"));

    const tamperedPath = join(backupDirectory, "tampered.backup.json");
    createGatewayStateBackup({ backupPath: tamperedPath, key: KEY, statePath, now: () => BACKUP_TIME });
    const tampered = JSON.parse(readFileSync(tamperedPath, "utf8"));
    tampered.ciphertext = `${tampered.ciphertext.slice(0, -1)}${tampered.ciphertext.endsWith("A") ? "B" : "A"}`;
    writeFileSync(tamperedPath, canonicalJSON(tampered), { mode: 0o600 });
    const absentTarget = join(restoreDirectory, "absent-after-tamper.json");
    assert.throws(() => restoreGatewayStateBackup({ backupPath: tamperedPath, key: KEY, statePath: absentTarget, now: () => VERIFY_TIME }), errorCode("BACKUP_TAMPERED"));
    assert.equal(existsSync(absentTarget), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backup reader rejects broad permissions, hard links and symlink paths", () => {
  const root = mkdtempSync(join(tmpdir(), "ynx-wallet-gateway-backup-files-"));
  chmodSync(root, 0o700);
  try {
    const sourceDirectory = privateDirectory(root, "source");
    const backupDirectory = privateDirectory(root, "backup");
    const statePath = join(sourceDirectory, "state.json");
    const backupPath = join(backupDirectory, "gateway.backup.json");
    new CanonicalWalletGatewayNodeHost(approvedRegistry(), { statePath, now: () => NOW });
    createGatewayStateBackup({ backupPath, key: KEY, statePath, now: () => BACKUP_TIME });

    chmodSync(backupPath, 0o644);
    assert.throws(() => verifyGatewayStateBackup({ backupPath, key: KEY, now: () => VERIFY_TIME }), errorCode("BACKUP_PERMISSIONS"));
    chmodSync(backupPath, 0o600);

    const hardLink = join(backupDirectory, "gateway-hardlink.backup.json");
    linkSync(backupPath, hardLink);
    assert.throws(() => verifyGatewayStateBackup({ backupPath, key: KEY, now: () => VERIFY_TIME }), errorCode("BACKUP_PERMISSIONS"));
    unlinkSync(hardLink);

    const symlink = join(backupDirectory, "gateway-symlink.backup.json");
    symlinkSync(backupPath, symlink);
    assert.throws(() => verifyGatewayStateBackup({ backupPath: symlink, key: KEY, now: () => VERIFY_TIME }), errorCode("BACKUP_UNAVAILABLE"));
    unlinkSync(symlink);

    chmodSync(backupDirectory, 0o755);
    assert.throws(() => verifyGatewayStateBackup({ backupPath, key: KEY, now: () => VERIFY_TIME }), errorCode("BACKUP_PERMISSIONS"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backup performance drill emits canonical integer metrics and bounded failures", () => {
  const script = fileURLToPath(new URL("../scripts/run-gateway-backup-drill.mjs", import.meta.url));
  const completed = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      YNX_WALLET_GATEWAY_BACKUP_DRILL_SAMPLES: "5",
      YNX_WALLET_GATEWAY_SOURCE_COMMIT: "a".repeat(40),
    },
  });
  assert.equal(completed.status, 0, completed.stderr);
  const payload = JSON.parse(completed.stdout);
  assert.equal(canonicalJSON(payload), completed.stdout.trim());
  assert.equal(payload.samples, 5);
  assert.equal(payload.sourceCommit, "a".repeat(40));
  assert.equal(payload.evidence.exactSnapshotRestored, true);
  assert.equal(payload.evidence.tamperRejected, true);
  for (const distribution of [payload.backup, payload.verify, payload.restoreAndColdStart]) {
    for (const key of ["minMicroseconds", "p50Microseconds", "p95Microseconds", "p99Microseconds", "maxMicroseconds"]) {
      assert.equal(Number.isSafeInteger(distribution[key]), true);
      assert.equal(distribution[key] >= 0, true);
    }
  }
  assert.equal(completed.stdout.includes(tmpdir()), false);

  const rejected = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, YNX_WALLET_GATEWAY_BACKUP_DRILL_SAMPLES: "invalid" },
  });
  assert.equal(rejected.status, 1);
  const error = JSON.parse(rejected.stderr);
  assert.equal(error.stage, "policy");
  assert.equal(error.error.code, "BACKUP_DRILL_FAILED");
  assert.equal(rejected.stderr.includes("file://"), false);
  assert.equal(rejected.stderr.includes(" at "), false);
});

test("Node-only backup subpath and CLI expose summaries without paths or keys", () => {
  assert.equal(Object.hasOwn(universalPackage, "createGatewayStateBackup"), false);
  assert.equal(packageBackup.createGatewayStateBackup, createGatewayStateBackup);
  assert.equal(packageBackup.restoreGatewayStateBackup, restoreGatewayStateBackup);
  assert.equal(packageBackup.verifyGatewayStateBackup, verifyGatewayStateBackup);
  assert.deepEqual(decodeGatewayBackupKey(KEY.toString("base64url")), KEY);

  const root = mkdtempSync(join(tmpdir(), "ynx-wallet-gateway-backup-cli-"));
  chmodSync(root, 0o700);
  try {
    const sourceDirectory = privateDirectory(root, "source");
    const backupDirectory = privateDirectory(root, "backup");
    const restoreDirectory = privateDirectory(root, "restore");
    const statePath = join(sourceDirectory, "state.json");
    const backupPath = join(backupDirectory, "gateway.backup.json");
    const restoredPath = join(restoreDirectory, "state.json");
    new CanonicalWalletGatewayNodeHost(approvedRegistry(), { statePath, now: () => NOW });
    const script = fileURLToPath(new URL("../scripts/ynx-wallet-gateway-backup.mjs", import.meta.url));
    const secret = KEY.toString("base64url");
    const baseEnv = {
      ...process.env,
      YNX_WALLET_GATEWAY_BACKUP_KEY_BASE64URL: secret,
      YNX_WALLET_GATEWAY_BACKUP_PATH: backupPath,
    };

    const created = spawnSync(process.execPath, [script, "create"], { encoding: "utf8", env: { ...baseEnv, YNX_WALLET_GATEWAY_STATE_PATH: statePath } });
    assert.equal(created.status, 0, created.stderr);
    assert.equal(JSON.parse(created.stdout).operation, "create");
    assert.equal(created.stdout.includes(secret), false);
    assert.equal(created.stdout.includes(statePath), false);
    assert.equal(created.stdout.includes(backupPath), false);

    const verified = spawnSync(process.execPath, [script, "verify"], { encoding: "utf8", env: baseEnv });
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).result.verified, true);

    const restored = spawnSync(process.execPath, [script, "restore"], { encoding: "utf8", env: { ...baseEnv, YNX_WALLET_GATEWAY_STATE_PATH: restoredPath } });
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(JSON.parse(restored.stdout).result.restored, true);

    const rejected = spawnSync(process.execPath, [script, "verify"], {
      encoding: "utf8",
      env: { ...baseEnv, YNX_WALLET_GATEWAY_BACKUP_KEY_BASE64URL: WRONG_KEY.toString("base64url") },
    });
    assert.equal(rejected.status, 1);
    assert.equal(JSON.parse(rejected.stderr).error.code, "BACKUP_TAMPERED");
    assert.equal(rejected.stderr.includes(backupPath), false);
    assert.equal(rejected.stderr.includes(WRONG_KEY.toString("base64url")), false);

    const malformed = spawnSync(process.execPath, [script, "verify"], {
      encoding: "utf8",
      env: { ...baseEnv, YNX_WALLET_GATEWAY_BACKUP_KEY_BASE64URL: "not-a-canonical-key" },
    });
    assert.equal(malformed.status, 1);
    assert.equal(JSON.parse(malformed.stderr).error.code, "INVALID_BACKUP_KEY");
    assert.equal(malformed.stderr.includes(backupPath), false);
    assert.equal(malformed.stderr.includes("file://"), false);
    assert.equal(malformed.stderr.includes(" at "), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
