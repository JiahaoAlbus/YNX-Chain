import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJSON, encodeWalletSessionControlProofHeader, signProductSessionChallenge } from "../src/index.js";
import { ProductSessionGatewayNodeHost } from "../src/product-session-gateway-node-host.js";
import { ProductSessionControlNodeHost } from "../src/product-session-control-node-host.js";
import { migrateProductSessionControlStateFileV2, parseProductSessionControlPersistedState } from "../src/product-session-control-node-store.js";
import { walletSessionControlReplayExpiry } from "../src/wallet-session-control.js";
import { ACCOUNT_PATH, DEVICE_PATH, at, deviceSecret, input, intentBody, ownerInput, pending, registry, requestId, token } from "./fixtures/product-session-control-v3-fixture.mjs";

const sha = value => createHash("sha256").update(value).digest("hex"), WALLET = "https://wallet.ynxweb4.com";
async function serve(t, host, { loseResponse = () => false } = {}) {
  const handler = host.handler(), server = createServer((request, response) => {
    const end = response.end.bind(response);
    response.end = (...args) => { if (loseResponse(request)) { response.destroy(); return response; } return end(...args); };
    void handler(request, response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const close = () => new Promise(resolve => { if (!server.listening) return resolve(); server.close(resolve); server.closeAllConnections(); });
  t.after(close); return { host, close, base: `http://127.0.0.1:${server.address().port}` };
}
async function post(server, request, { origin } = {}) {
  const headers = { "content-type": "application/json", "x-request-id": request.requestId, ...(origin ? { origin } : {}) };
  if (request.walletControlProof) headers["x-ynx-wallet-control-proof-v2"] = encodeWalletSessionControlProofHeader(request.walletControlProof);
  const response = await fetch(server.base + request.path, { method: "POST", headers, body: canonicalJSON(request.body) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function login(server, label, offset = 0) {
  const body = pending(label, { offset });
  const challengeInput = input("/v2/product-sessions/challenge", body), challengeResponse = await post(server, challengeInput);
  assert.equal(challengeResponse.status, 200, JSON.stringify(challengeResponse.body));
  const completeInput = input("/v2/product-sessions/complete", { ...body, completion: signProductSessionChallenge(challengeResponse.body.result, deviceSecret) });
  const completeResponse = await post(server, completeInput); assert.equal(completeResponse.status, 200, JSON.stringify(completeResponse.body));
  return { session: completeResponse.body.result, challengeInput, completeInput };
}
async function fixture(t, { io = fs, loseResponse } = {}) {
  const directory = fs.mkdtempSync(join(tmpdir(), "ynx-control-host-v3-")); fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "v2.json"), targetPath = join(directory, "v3.json"), backupPath = join(directory, "v2-before-migration.json");
  const clock = { offset: 0 };
  const options = statePath => ({ statePath, now: () => at(clock.offset), tokenFactory: () => token(requestId()) });
  const old = await serve(t, new ProductSessionGatewayNodeHost(registry, options(sourcePath)));
  const original = await login(old, requestId()); await old.close();
  const oldBytes = fs.readFileSync(sourcePath, "utf8"), expectedSourceDigest = sha(oldBytes);
  const migration = migrateProductSessionControlStateFileV2({ sourcePath, targetPath, backupPath, expectedSourceDigest });
  const host = new ProductSessionControlNodeHost(registry, { ...options(targetPath), io });
  const server = await serve(t, host, { loseResponse });
  const restart = async () => { await server.close(); return serve(t, new ProductSessionControlNodeHost(registry, options(targetPath))); };
  return { ...server, clock, original, sourcePath, targetPath, backupPath, oldBytes, expectedSourceDigest, migration, options, restart };
}

test("explicit offline migration preserves real v2 host bytes and backup; neither old host nor new startup silently downgrades/migrates", async t => {
  const f = await fixture(t);
  assert.equal(fs.readFileSync(f.sourcePath, "utf8"), f.oldBytes); assert.equal(fs.readFileSync(f.backupPath, "utf8"), f.oldBytes);
  assert.equal(f.host.snapshot().schemaVersion, 3); assert.equal(f.host.snapshot().authority.sessions.length, 1);
  assert.equal(f.migration.rollbackRequiresVersionThree, true);
  assert.throws(() => new ProductSessionGatewayNodeHost(registry, f.options(f.targetPath)), { code: "STATE_TAMPERED" });
  assert.throws(() => new ProductSessionControlNodeHost(registry, f.options(f.sourcePath)), { code: "STATE_TAMPERED" });
  assert.throws(() => new ProductSessionControlNodeHost(registry, f.options(join(f.sourcePath, "..", "missing.json"))), { code: "STATE_NOT_FOUND" });
  assert.throws(() => migrateProductSessionControlStateFileV2({ sourcePath: f.sourcePath, targetPath: f.targetPath, backupPath: f.backupPath, expectedSourceDigest: f.expectedSourceDigest }), { code: "STATE_TARGET_EXISTS" });
});

test("only wallet-origin CORS and the owner proof authorize batch logout; invalid requests create no proof or receipt", async t => {
  const f = await fixture(t), body = intentBody("host-cors", f.original.session.deviceBinding);
  f.clock.offset = 10;
  const request = ownerInput(DEVICE_PATH, body, { offset: 10 });
  const before = fs.readFileSync(f.targetPath, "utf8");
  assert.equal((await post(f, request, { origin: "https://creator.ynxweb4.com" })).status, 403);
  const preflight = await fetch(f.base + DEVICE_PATH, { method: "OPTIONS", headers: { origin: WALLET, "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-request-id,x-ynx-wallet-control-proof-v2" } });
  assert.equal(preflight.status, 204); assert.match(preflight.headers.get("access-control-allow-headers"), /x-ynx-wallet-control-proof-v2/);
  assert.equal(fs.readFileSync(f.targetPath, "utf8"), before);
  const invalid = await post(f, { ...request, body: { ...body, account: request.walletControlProof.account } }, { origin: WALLET });
  assert.equal(invalid.status, 400); assert.equal(f.host.snapshot().controlIntents.length, 0);
  assert.equal(f.host.snapshot().consumedProofs.filter(x => walletSessionControlReplayExpiry(x) !== null).length, 0);
  const accepted = await post(f, request, { origin: WALLET });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.result.status, "confirmed"); assert.equal(accepted.body.result.revocationConfirmed, true);
  const stored = parseProductSessionControlPersistedState(fs.readFileSync(f.targetPath, "utf8")).snapshot;
  assert.equal(stored.controlIntents.length, 1); assert.equal(stored.consumedProofs.filter(x => walletSessionControlReplayExpiry(x) !== null).length, 1);
  assert.equal(stored.authority.revokedSessions[0], f.original.session.sessionBinding); assert.equal(stored.audit.at(-1).requestId, request.requestId);
});

test("lost HTTP acknowledgement across restart returns the original durable intent receipt and preserves later login", async t => {
  let lose = true;
  const f = await fixture(t, { loseResponse: request => request.url === ACCOUNT_PATH && lose });
  const body = intentBody("lost-response"); f.clock.offset = 10;
  await assert.rejects(post(f, ownerInput(ACCOUNT_PATH, body, { offset: 10 }), { origin: WALLET })); lose = false;
  const stored = parseProductSessionControlPersistedState(fs.readFileSync(f.targetPath, "utf8")).snapshot, receipt = stored.controlIntents[0].receipt;
  const restarted = await f.restart(); f.clock.offset = 11; const newer = await login(restarted, "after-lost-ack", 11);
  f.clock.offset = 20; const retried = await post(restarted, ownerInput(ACCOUNT_PATH, body, { offset: 20 }), { origin: WALLET });
  assert.equal(retried.status, 200); assert.deepEqual(retried.body.result.receipt, receipt);
  const latest = restarted.host.snapshot(); assert.equal(latest.controlIntents.length, 1); assert.ok(!latest.authority.revokedSessions.includes(newer.session.sessionBinding));
  assert.equal(latest.consumedProofs.filter(x => walletSessionControlReplayExpiry(x) !== null).length, 2);
});

for (const stage of ["before-write", "rename-before", "rename-after", "directory-sync", "readback"]) test(`${stage} failure never confirms, and same intent reconciles the actual latest state without rollback`, async t => {
  let armed = false, renamed = false;
  const io = { ...fs,
    writeFileSync(...args) { if (armed && stage === "before-write") { armed = false; throw new Error("fixture write failure"); } return fs.writeFileSync(...args); },
    renameSync(...args) {
      if (armed && stage === "rename-before") { armed = false; throw new Error("fixture rename did not commit"); }
      const result = fs.renameSync(...args); renamed = true;
      if (armed && stage === "rename-after") { armed = false; throw new Error("fixture rename committed before error"); }
      return result;
    },
    fsyncSync(descriptor) { if (armed && stage === "directory-sync" && fs.fstatSync(descriptor).isDirectory()) { armed = false; throw new Error("fixture directory sync failure"); } return fs.fsyncSync(descriptor); },
    readFileSync(...args) { if (armed && renamed && stage === "readback") { armed = false; throw new Error("fixture readback failure"); } return fs.readFileSync(...args); },
  };
  const f = await fixture(t, { io }), body = intentBody(`failure-${stage}`); f.clock.offset = 10; armed = true; renamed = false;
  const failed = await post(f, ownerInput(ACCOUNT_PATH, body, { offset: 10 }), { origin: WALLET });
  assert.equal(failed.status, 503, JSON.stringify(failed.body)); assert.equal(failed.body.status, "unknown"); assert.equal(failed.body.revocationConfirmed, false); assert.equal(failed.body.result, undefined);
  const afterFailure = parseProductSessionControlPersistedState(fs.readFileSync(f.targetPath, "utf8")).snapshot;
  const committed = !["before-write", "rename-before"].includes(stage);
  assert.equal(afterFailure.controlIntents.length, committed ? 1 : 0);
  f.clock.offset = 11; const newer = await login(f, `newer-${stage}`, 11);
  f.clock.offset = 20; const retry = await post(f, ownerInput(ACCOUNT_PATH, body, { offset: 20 }), { origin: WALLET });
  assert.equal(retry.status, 200, JSON.stringify(retry.body)); assert.equal(retry.body.result.revocationConfirmed, true);
  assert.equal(retry.body.result.receipt.cutoff, at(committed ? 10 : 20).toISOString());
  assert.equal(f.host.snapshot().authority.revokedSessions.includes(newer.session.sessionBinding), !committed);
  assert.equal(fs.readFileSync(f.sourcePath, "utf8"), f.oldBytes); // Never restore an old state to the active file.
});

test("continued read failure after rename stays unknown; recovery confirms only the exact committed intent", async t => {
  let unreadable = false, armed = false;
  const io = { ...fs,
    renameSync(...args) { const value = fs.renameSync(...args); if (armed) unreadable = true; return value; },
    readFileSync(...args) { if (unreadable) throw new Error("fixture persistent read outage"); return fs.readFileSync(...args); },
  };
  const f = await fixture(t, { io }), body = intentBody("continued-read-outage");
  f.clock.offset = 10; armed = true;
  const first = await post(f, ownerInput(ACCOUNT_PATH, body, { offset: 10 }), { origin: WALLET });
  assert.equal(first.status, 503); assert.equal(first.body.revocationConfirmed, false);
  const receipt = parseProductSessionControlPersistedState(fs.readFileSync(f.targetPath, "utf8")).snapshot.controlIntents[0].receipt;
  f.clock.offset = 11;
  const stillUnknown = await post(f, ownerInput(ACCOUNT_PATH, body, { offset: 11 }), { origin: WALLET });
  assert.equal(stillUnknown.status, 503); assert.equal(stillUnknown.body.error.code, "STATE_DURABILITY_UNCERTAIN");
  assert.equal(stillUnknown.body.status, "unknown"); assert.equal(stillUnknown.body.revocationConfirmed, false); assert.equal(stillUnknown.body.result, undefined);
  unreadable = false; armed = false; f.clock.offset = 12;
  const recovered = await post(f, ownerInput(ACCOUNT_PATH, body, { offset: 12 }), { origin: WALLET });
  assert.equal(recovered.status, 200); assert.deepEqual(recovered.body.result.receipt, receipt);
});

test("same bytes in a substituted inode fail closed and never overwrite the substituted latest state", async t => {
  const f = await fixture(t), bytes = fs.readFileSync(f.targetPath, "utf8");
  const replacement = `${f.targetPath}.replacement`; fs.writeFileSync(replacement, bytes, { mode: 0o600 });
  fs.renameSync(replacement, f.targetPath); const inode = fs.statSync(f.targetPath).ino;
  f.clock.offset = 10;
  const refused = await post(f, ownerInput(ACCOUNT_PATH, intentBody("external-replacement"), { offset: 10 }), { origin: WALLET });
  assert.equal(refused.status, 500); assert.equal(refused.body.error.code, "STATE_TAMPERED");
  assert.equal(refused.body.revocationConfirmed, false); assert.equal(refused.body.result, undefined);
  assert.equal(fs.readFileSync(f.targetPath, "utf8"), bytes); assert.equal(fs.statSync(f.targetPath).ino, inode);
});

test("startup rejects a writable-by-others directory and does not repair it implicitly", async t => {
  const f = await fixture(t), directory = join(f.targetPath, "..");
  fs.chmodSync(directory, 0o755);
  assert.throws(() => new ProductSessionControlNodeHost(registry, f.options(f.targetPath)), { code: "STATE_PERMISSIONS" });
  assert.equal(fs.statSync(directory).mode & 0o777, 0o755);
});
