import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fork, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  canonicalJSON,
  centralProtocolEntry,
  createGatewayChallenge,
  gatewayStateDigest,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
} from "../src/index.js";
import {
  CanonicalWalletGatewayNodeHost,
  inspectGatewayStateLock,
  recoverGatewayStateLock,
} from "../src/gateway-node-host.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

function approvedRegistry() {
  const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  const social = registry.products.find(item => item.productId === "social");
  social.reviewState = "approved";
  social.enabled = true;
  return registry;
}

function completion(registry) {
  const registration = registry.products.find(item => item.productId === "social");
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce: "pre_ack_crash_completion_abcdefghijklmnop",
    purpose: "Prove explicit stale-lock recovery preserves an unknown pre-ack outcome.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, {
    challenge: "pre_ack_crash_challenge_abcdefghijklmnop",
    expiresAt: "2026-07-15T12:03:00.000Z",
  }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

async function listen(host) {
  const server = createServer(host.handler());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

async function listenProcess(statePath) {
  const script = fileURLToPath(new URL("./helpers/gateway-node-shared-state-child.mjs", import.meta.url));
  const child = fork(script, [statePath], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const port = await new Promise((resolve, reject) => {
    child.once("message", message => resolve(message.port));
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`Gateway child exited before listening (${code}): ${stderr}`)));
  });
  return {
    base: `http://127.0.0.1:${port}`,
    kill: () => new Promise((resolve, reject) => {
      child.once("exit", (_code, signal) => signal === "SIGKILL" ? resolve() : reject(new Error(`Gateway child did not terminate by SIGKILL: ${stderr}`)));
      child.kill("SIGKILL");
    }),
  };
}

async function post(base, body) {
  const response = await fetch(`${base}/v1/wallet/sessions/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const payload = await response.json();
  return { code: payload.error?.code ?? null, status: response.status };
}

async function waitForLock(path) {
  const deadline = Date.now() + 2_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error("Gateway owner lock was not observed before the deadline");
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

function enlargeValidState(statePath) {
  const envelope = JSON.parse(readFileSync(statePath, "utf8"));
  envelope.snapshot.consumedProductProofs = Array.from({ length: 20_000 }, (_, index) => index.toString(16).padStart(64, "0"));
  envelope.stateDigest = gatewayStateDigest(envelope.snapshot);
  writeFileSync(statePath, canonicalJSON(envelope), { mode: 0o600 });
}

test("SIGKILL before acknowledgement leaves a fail-closed owner lock recoverable only after explicit verified policy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ynx-wallet-stale-lock-"));
  const statePath = join(directory, "state.json");
  const lockPath = `${statePath}.lock`;
  const registry = approvedRegistry();
  new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  enlargeValidState(statePath);
  const before = JSON.parse(readFileSync(statePath, "utf8"));
  const body = canonicalJSON(completion(registry));
  const child = await listenProcess(statePath);
  let settled = false;
  const pending = post(child.base, body)
    .then(value => ({ error: null, value }), error => ({ error, value: null }))
    .finally(() => { settled = true; });
  await waitForLock(lockPath);
  assert.equal(settled, false);
  const active = inspectGatewayStateLock(statePath);
  assert.equal(active.locked, true);
  assert.equal(active.ownerAlive, true);
  const recoveryNow = new Date(Date.parse(active.acquiredAt) + 10_000);
  assert.throws(
    () => recoverGatewayStateLock(registry, { minimumAgeMs: 0, now: () => recoveryNow, statePath }),
    error => error.code === "STATE_LOCK_ACTIVE",
  );

  await child.kill();
  assert.ok((await pending).error instanceof Error);
  const stale = inspectGatewayStateLock(statePath);
  assert.equal(stale.locked, true);
  assert.equal(stale.ownerAlive, false);

  const blockedHost = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const blockedServer = await listen(blockedHost);
  try {
    const blocked = await post(blockedServer.base, body);
    assert.deepEqual(blocked, { code: "STATE_LOCKED", status: 503 });
  } finally {
    await blockedServer.close();
  }
  assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), before);
  assert.throws(
    () => recoverGatewayStateLock(registry, { minimumAgeMs: 10_001, now: () => recoveryNow, statePath }),
    error => error.code === "STATE_LOCK_TOO_FRESH",
  );
  const wrongRegistry = structuredClone(registry);
  wrongRegistry.products.find(item => item.productId === "social").displayName = "YNX Social Recovery Mismatch";
  assert.throws(
    () => recoverGatewayStateLock(wrongRegistry, { minimumAgeMs: 0, now: () => recoveryNow, statePath }),
    error => error.code === "REGISTRY_STATE_MISMATCH",
  );
  assert.equal(existsSync(lockPath), true);

  const temporaryStatePath = `${statePath}.${stale.ownerPid}.tmp`;
  if (existsSync(temporaryStatePath)) unlinkSync(temporaryStatePath);
  symlinkSync(statePath, temporaryStatePath);
  assert.throws(
    () => recoverGatewayStateLock(registry, { minimumAgeMs: 10_000, now: () => recoveryNow, statePath }),
    error => error.code === "STATE_LOCK_TAMPERED",
  );
  assert.equal(existsSync(lockPath), true);
  assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), before);
  unlinkSync(temporaryStatePath);
  writeFileSync(temporaryStatePath, "partial", { flag: "wx", mode: 0o600 });
  const recovered = recoverGatewayStateLock(registry, { minimumAgeMs: 10_000, now: () => recoveryNow, statePath });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.discardedTemporaryState, true);
  assert.equal(recovered.stateDigest, before.stateDigest);
  assert.equal(recovered.registrySha256, createHash("sha256").update(canonicalJSON(registry)).digest("hex"));
  assert.equal(existsSync(lockPath), false);
  assert.equal(existsSync(temporaryStatePath), false);

  const restarted = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW });
  const restartedServer = await listen(restarted);
  let retry;
  try { retry = await post(restartedServer.base, body); }
  finally { await restartedServer.close(); }
  assert.ok(retry.status === 200 || (retry.status === 409 && retry.code === "REPLAY"));
  const final = new CanonicalWalletGatewayNodeHost(registry, { statePath, now: () => NOW }).snapshot();
  assert.equal(final.sessionStore.sessions.length, 1);
  assert.equal(final.sessionStore.consumedNonces.length, 1);
  assert.equal(final.sessionStore.audit.filter(item => item.type === "session-created").length, 1);
  assert.equal(final.consumedProductProofs.length, 20_000);
});

test("state-lock CLI emits canonical bounded errors without stack or local paths", () => {
  const script = fileURLToPath(new URL("../scripts/ynx-wallet-gateway-state-lock.mjs", import.meta.url));
  const failed = spawnSync(process.execPath, [script, "recover"], { encoding: "utf8", env: {} });
  assert.equal(failed.status, 2);
  assert.equal(failed.stdout, "");
  const error = JSON.parse(failed.stderr);
  assert.equal(canonicalJSON(error), failed.stderr.trim());
  assert.deepEqual(error, { error: { code: "MISSING_ENVIRONMENT", message: "YNX_WALLET_GATEWAY_STATE_PATH is required" }, ok: false });
  assert.doesNotMatch(failed.stderr, /(?:\/private\/|\.mjs:\d+|\n\s+at )/);

  const missingState = spawnSync(process.execPath, [script, "recover"], {
    encoding: "utf8",
    env: {
      YNX_WALLET_GATEWAY_LOCK_MINIMUM_AGE_MS: "0",
      YNX_WALLET_GATEWAY_REGISTRY_PATH: "/private/tmp/nonexistent-registry.json",
      YNX_WALLET_GATEWAY_STATE_PATH: "/private/tmp/nonexistent-state.json",
    },
  });
  assert.equal(missingState.status, 2);
  assert.deepEqual(JSON.parse(missingState.stderr), {
    error: { code: "LOCK_COMMAND_FAILED", message: "Canonical Gateway state lock command failed closed" },
    ok: false,
  });
  assert.doesNotMatch(missingState.stderr, /\/private\//);
});
