import assert from "node:assert/strict";
import { chmod, link, lstat, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { after, test } from "node:test";
import { DurableSponsorshipAuthorizationLedger } from "../src/sponsorship-ledger-node.js";
import { userOperationDigest, WalletAuthError } from "../src/index.js";
import { vector } from "./fixtures/sponsorship-vector.mjs";

const roots = [];
after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

test("pre-ack SIGKILL leaves one durable sponsorship nonce and restart rejects replay", async () => {
  const root = await privateRoot();
  const statePath = join(root, "sponsorship-state.json");
  const child = spawn(process.execPath, [new URL("./fixtures/sponsorship-ledger-child.mjs", import.meta.url).pathname, statePath], { stdio: "ignore" });
  const result = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  assert.equal(result.signal === "SIGKILL" || result.code === 137, true);
  const ledger = new DurableSponsorshipAuthorizationLedger({ statePath, maximumConsumed: 2 });
  assert.equal(ledger.size, 1);
  const initial = vector(); initial[1].userOperationDigest = userOperationDigest(initial[0]);
  assert.throws(() => ledger.authorize(...initial), walletError("SPONSORSHIP_REPLAY"));
  assert.equal(ledger.size, 1);
  const [operation, request, policy, binding, at] = vector(); request.userOperationDigest = userOperationDigest(operation);
  assert.equal(ledger.authorize(operation, { ...request, requestNonce: "07".repeat(32) }, policy, binding, at).eligible, true);
  assert.equal(ledger.size, 2);
  assert.throws(() => ledger.authorize(operation, { ...request, requestNonce: "08".repeat(32) }, policy, binding, at), walletError("SPONSORSHIP_LEDGER_FULL"));
  assert.equal(ledger.size, 2);
  const raw = await readFile(statePath, "utf8");
  assert.equal(`${JSON.stringify(JSON.parse(raw))}\n`, raw);
  assert.equal((await lstat(statePath)).mode & 0o777, 0o600);
});

test("durable ledger rejects symlink state without changing its target", async () => {
  const root = await privateRoot();
  const target = join(root, "target.json");
  const statePath = join(root, "sponsorship-state.json");
  await writeFile(target, "owner-data", { mode: 0o600 });
  await symlink(target, statePath);
  assert.throws(() => new DurableSponsorshipAuthorizationLedger({ statePath }), walletError("SPONSORSHIP_STATE_UNSAFE"));
  assert.equal(await readFile(target, "utf8"), "owner-data");
});

test("durable ledger rejects broad mode, hard links, noncanonical JSON and oversize state", async () => {
  for (const fixture of ["broad", "hardlink", "noncanonical", "oversize"]) {
    const root = await privateRoot();
    const statePath = join(root, "sponsorship-state.json");
    await writeFile(statePath, '{"consumed":[],"schemaVersion":1}\n', { mode: fixture === "broad" ? 0o644 : 0o600 });
    if (fixture === "hardlink") await link(statePath, join(root, "second-link.json"));
    if (fixture === "noncanonical") await writeFile(statePath, '{ "schemaVersion": 1, "consumed": [] }\n', { mode: 0o600 });
    if (fixture === "oversize") await truncate(statePath, 32 * 1024 * 1024 + 1);
    const code = fixture === "noncanonical" ? "SPONSORSHIP_STATE_INVALID" : fixture === "oversize" ? "SPONSORSHIP_STATE_TOO_LARGE" : "SPONSORSHIP_STATE_UNSAFE";
    assert.throws(() => new DurableSponsorshipAuthorizationLedger({ statePath }), walletError(code));
  }
});

async function privateRoot() { const root = await mkdtemp(join(tmpdir(), "ynx-sponsorship-ledger-")); roots.push(root); await chmod(root, 0o700); return realpath(root); }
function walletError(code) { return (error) => error instanceof WalletAuthError && error.code === code; }
