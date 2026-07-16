import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { OpsStore } from "./store.js";
const key = "test-integrity-key-with-more-than-32-bytes";
test("signed operational state survives restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ynx-state-")),
    path = join(dir, "state.json");
  const first = new OpsStore(path, key);
  await first.load();
  await first.observeFailure("rpc", "offline", "http://rpc/status");
  const second = new OpsStore(path, key);
  await second.load();
  assert.equal(second.snapshot().alerts[0]?.source, "rpc");
});
test("tampered operational state is rejected at restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ynx-state-")),
    path = join(dir, "state.json");
  const first = new OpsStore(path, key);
  await first.load();
  await first.observeFailure("rpc", "offline", "http://rpc/status");
  const raw = await readFile(path, "utf8");
  await writeFile(path, raw.replace("offline", "healthy"));
  const second = new OpsStore(path, key);
  await assert.rejects(() => second.load(), /integrity check failed/);
});
