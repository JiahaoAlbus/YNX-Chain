import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = stripTypeScriptTypes(await readFile(new URL("../frontend/src/state/workspace.ts", import.meta.url), "utf8"));
const workspace = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const KEY = "ynx-code-project-v1";
const legacy = (count = 257) => ({ id: "legacy-local-project", name: "Saved before upgrade", revision: 300, remoteRevision: 0,
  files: Object.fromEntries(Array.from({ length: count }, (_, i) => [`src/f${i}.txt`, `unsynced edit ${i}\n`])), folders: ["src"], open: ["src/f0.txt"], active: "src/f0.txt" });
function storage(raw) {
  const values = new Map(raw === null ? [] : [[KEY, raw]]);
  globalThis.window = {};
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  return values;
}

test("legacy 257-file local workspace survives upgrade and attempted automatic save unchanged", async () => {
  const raw = JSON.stringify(legacy());
  const values = storage(raw);
  assert.deepEqual(workspace.workspaceRecoveryProblem(), { kind: "invalid", raw });
  await assert.rejects(workspace.saveProject(workspace.loadProject()), /needs recovery/);
  assert.equal(values.get(KEY), raw);
  assert.equal(values.size, 1);
});

test("malformed original bytes are preserved until an explicit verified backup and new workspace", async () => {
  const raw = '{\n  "name": "unfinished JSON 恢复"';
  const values = storage(raw);
  assert.equal(workspace.workspaceRecoveryProblem().raw, raw);
  workspace.backupRecoveryAndStartNew(raw);
  assert.equal(values.has(KEY), false);
  assert.equal([...values.keys()].filter(key => key.startsWith("ynx-code-recovery-backup-v1:")).length, 1);
  assert.equal([...values.values()][0], raw);
  await workspace.saveProject(workspace.loadProject());
  assert.equal([...values.entries()].find(([key]) => key.startsWith("ynx-code-recovery-backup-v1:"))[1], raw);
});

test("read failure blocks saving and never creates a default replacement", async () => {
  let writes = 0;
  globalThis.window = {};
  globalThis.localStorage = { getItem() { throw new Error("storage denied"); }, setItem() { writes++; }, removeItem() { writes++; } };
  assert.deepEqual(workspace.workspaceRecoveryProblem(), { kind: "unreadable", raw: null });
  await assert.rejects(workspace.saveProject(legacy(1)), /needs recovery/);
  assert.equal(writes, 0);
});

test("backup quota failure and failed readback keep original data in place", () => {
  const raw = JSON.stringify(legacy());
  let values = storage(raw);
  localStorage.setItem = () => { throw new Error("quota exceeded"); };
  assert.throws(() => workspace.backupRecoveryAndStartNew(raw), /quota exceeded/);
  assert.equal(values.get(KEY), raw);
  values = storage(raw);
  localStorage.setItem = () => {};
  assert.throws(() => workspace.backupRecoveryAndStartNew(raw), /backup could not be verified/);
  assert.equal(values.get(KEY), raw);
});

test("a newer other-tab save cannot be discarded by a stale recovery action", () => {
  const raw = JSON.stringify(legacy()), newer = JSON.stringify(legacy(256));
  const values = storage(newer);
  assert.throws(() => workspace.backupRecoveryAndStartNew(raw), /Saved data changed/);
  assert.equal(values.get(KEY), newer);
  assert.equal(values.size, 1);
  storage(raw);
  const originalSet = localStorage.setItem;
  localStorage.setItem = (key, value) => { originalSet(key, value); originalSet(KEY, newer); };
  assert.throws(() => workspace.backupRecoveryAndStartNew(raw), /newer data have been kept/);
  assert.equal(localStorage.getItem(KEY), newer);
});

test("valid old project retains its exact identity, file bytes and revisions through save and reload", async () => {
  const prior = legacy(256);
  storage(JSON.stringify(prior));
  assert.equal(workspace.workspaceRecoveryProblem(), null);
  assert.deepEqual(workspace.loadProject(), prior);
  await workspace.saveProject(workspace.loadProject());
  assert.deepEqual(workspace.loadProject(), prior);
});

test("native durable workspace remains usable if browser storage is unavailable", async () => {
  const prior = legacy(1);
  let saved;
  globalThis.window = { ynxDesktopWorkspace: { initialProject: prior, saveProject: async value => { saved = value; } } };
  globalThis.localStorage = { getItem() { throw new Error("WebKit storage denied"); }, setItem() { throw new Error("WebKit storage denied"); } };
  assert.equal(workspace.workspaceRecoveryProblem(), null);
  assert.deepEqual(workspace.loadProject(), prior);
  await workspace.saveProject(prior);
  assert.deepEqual(saved, prior);
});

test("native fallback opens its existing app snapshot only after backing up rejected browser data", () => {
  const raw = JSON.stringify(legacy());
  const values = storage(raw), prior = legacy(1);
  window.ynxDesktopWorkspace = { initialProject: prior };
  assert.equal(workspace.workspaceRecoveryProblem().raw, raw);
  workspace.backupRecoveryAndStartNew(raw);
  assert.deepEqual(workspace.loadProject(), prior);
  assert.equal([...values.values()][0], raw);
});

test("recovery gate wraps Workbench before mounting its persistence effects", async () => {
  const [main, gate] = await Promise.all([readFile(new URL("../frontend/src/main.tsx", import.meta.url), "utf8"), readFile(new URL("../frontend/src/app/WorkspaceRecoveryGate.tsx", import.meta.url), "utf8")]);
  assert.match(main, /<WorkspaceRecoveryGate><Workbench \/><\/WorkspaceRecoveryGate>/);
  assert.match(gate, /if \(!problem\) return children/);
  assert.match(gate, /new Blob\(\[problem\.raw\]/);
  assert.match(gate, /backupRecoveryAndStartNew\(problem\.raw\)/);
  assert.match(gate, /aria-labelledby="workspace-recovery-title"/);
});
