import assert from "node:assert/strict";
import { chmodSync, copyFileSync, linkSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJSON } from "../src/canonical.js";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const vector = JSON.parse(readFileSync(new URL("./fixtures/product-session-gateway-state-integrity-v1.json", import.meta.url), "utf8"));

test("shared v1 state-integrity vector fails closed with zero authoritative mutation", async (context) => {
  assert.equal(vector.schemaVersion, 1);
  assert.deepEqual(vector.checkpoints, ["before-administrative-response", "before-protocol-dispatch", "immediately-before-persist"]);
  for (const attack of vector.attacks) {
    await context.test(attack.name, async () => {
      const directory = mkdtempSync(join(tmpdir(), "ynx-product-session-integrity-"));
      chmodSync(directory, 0o700);
      try {
        const statePath = join(directory, "state.json");
        const host = new ProductSessionGatewayNodeHost(registry, runtime(statePath));
        const authoritativeBefore = canonicalJSON(host.snapshot());
        applyAttack(attack.name, statePath);
        const attackerArtifactBefore = artifact(statePath);
        const response = await serve(host);
        assert.equal(response.status, vector.requiredOutcome.httpStatus);
        assert.equal(response.payload.error.code, attack.expectedCode);
        assert.equal(canonicalJSON(host.snapshot()), authoritativeBefore);
        assert.deepEqual(artifact(statePath), attackerArtifactBefore);
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    });
  }
});

function runtime(statePath) {
  return { emitEvent: () => undefined, now: () => new Date("2026-08-14T12:00:00.000Z"), statePath, tokenFactory: () => "A".repeat(43) };
}

function applyAttack(name, statePath) {
  if (name === "world-readable") return chmodSync(statePath, 0o644);
  if (name === "hardlink-replacement") return linkSync(statePath, `${statePath}.hardlink`);
  if (name === "symlink-replacement") {
    renameSync(statePath, `${statePath}.original`);
    return symlinkSync(`${statePath}.original`, statePath);
  }
  if (name === "same-bytes-inode-replacement") {
    copyFileSync(statePath, `${statePath}.replacement`);
    chmodSync(`${statePath}.replacement`, 0o600);
    return renameSync(`${statePath}.replacement`, statePath);
  }
  if (name === "snapshot-digest-mismatch") {
    const envelope = JSON.parse(readFileSync(statePath, "utf8"));
    envelope.snapshot.audit.push({ at: "2026-08-14T12:00:00.000Z", code: "TAMPERED", outcome: "rejected", path: "/invalid", requestId: "req_tampered_state_001", sequence: 1, subject: "tampered" });
    return writeFileSync(statePath, `${canonicalJSON(envelope)}\n`, { mode: 0o600 });
  }
  throw new Error(`Unknown state-integrity attack: ${name}`);
}

function artifact(statePath) {
  const info = lstatSync(statePath);
  return { bytes: info.isSymbolicLink() ? null : readFileSync(statePath, "utf8"), ino: info.ino, mode: info.mode & 0o777, nlink: info.nlink, symlink: info.isSymbolicLink() };
}

async function serve(host) {
  const server = createServer(host.handler());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v2/product-sessions/challenge`, { body: "{}", headers: { "content-type": "application/json", "x-request-id": "req_state_integrity_001" }, method: "POST" });
    return { payload: await response.json(), status: response.status };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
