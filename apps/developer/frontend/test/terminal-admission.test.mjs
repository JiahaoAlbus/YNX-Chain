import assert from "node:assert/strict";
import test from "node:test";
import { applyPackageMetadata, mergeTerminalFiles, mergeStoppedTerminalWorkspace, persistTerminalWorkspace, stopSelectedTerminals, terminalCommonBase } from "../src/terminal/admission.ts";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("selected terminal stop and synchronization completes before package admission", async () => {
  const events = [], stopped = deferred(); let live = true;
  const work = stopSelectedTerminals("ours", async () => live ? [{ sessionId: "a", runtimeId: "ours" }, { sessionId: "b", runtimeId: "other" }] : [{ sessionId: "b", runtimeId: "other" }], async id => { events.push(`stop:${id}`); await stopped.promise; live = false; events.push("synced"); });
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(events, ["stop:a"]);
  stopped.resolve(); await work; events.push("install"); assert.deepEqual(events, ["stop:a", "synced", "install"]);
});
test("failed Stop and retained terminal prohibit package admission", async () => {
  const list = async () => [{ sessionId: "a", runtimeId: "ours" }];
  await assert.rejects(stopSelectedTerminals("ours", list, async () => { throw new Error("Remote child remains"); }), /child remains/);
  await assert.rejects(stopSelectedTerminals("ours", list, async () => {}), /still active/);
});
test("edits arriving during the real async save boundary are retained and stop installation", async () => {
  let editor = "original"; const saving = deferred(); let install = false;
  const operation = persistTerminalWorkspace(editor, () => editor, () => saving.promise).then(() => { install = true; });
  editor = "new local edits"; saving.resolve({ revision: 2 });
  await assert.rejects(operation, /Edits made during/); assert.equal(editor, "new local edits"); assert.equal(install, false);
});
test("metadata arriving after local package edits cannot overwrite them", async () => {
  const expected = { "package.json": "before", "package-lock.json": "lock1", "main.js": "source" }, installation = deferred();
  let local = { ...expected };
  const operation = installation.promise.then(updates => ({ updates, next: applyPackageMetadata(local, expected, updates) }));
  local["package.json"] = "new user manifest"; installation.resolve({ "package.json": "installed manifest", "package-lock.json": "lock2" });
  const result = await operation; assert.equal(result.next, null); assert.equal(local["package.json"], "new user manifest"); assert.equal(result.updates["package-lock.json"], "lock2");
});
test("online admission keeps the original common base when remote revision advances", () => {
  const base = JSON.stringify({ files: { "a.js": "base" } }), remote = JSON.stringify({ files: { "a.js": "remote edit" } });
  assert.equal(terminalCommonBase(base, remote, 1, 2), base);
  assert.equal(terminalCommonBase("", remote, 1, 2), "");
  assert.throws(() => mergeTerminalFiles(JSON.parse(base).files, { "a.js": "local edit" }, JSON.parse(remote).files), /conflict/);
});
test("disjoint edits merge while delete/edit conflicts retain both inputs", () => {
  assert.deepEqual(mergeTerminalFiles({ a: "1", b: "1" }, { a: "2", b: "1" }, { a: "1", b: "3" }), { a: "2", b: "3" });
  const ours = {}, theirs = { a: "changed" }; assert.throws(() => mergeTerminalFiles({ a: "before" }, ours, theirs), /conflict/); assert.deepEqual(theirs, { a: "changed" }); assert.deepEqual(ours, {});
});
test("terminal-created files and local tab navigation survive stop together", () => {
  const base = { name: "project", files: { "main.cpp": "compiled", "README.md": "readme" }, folders: [], open: ["main.cpp"], active: "main.cpp" };
  const local = { ...base, open: ["main.cpp", "README.md"], active: "README.md" };
  const remote = { ...base, files: { ...base.files, "native-qa-note.txt": "PTY marker\n" } };
  const merged = mergeStoppedTerminalWorkspace(base, local, remote);
  assert.equal(merged.files["native-qa-note.txt"], "PTY marker\n");
  assert.equal(merged.active, "README.md"); assert.deepEqual(merged.open, local.open);
});
test("stop merges disjoint unsaved edits and refuses same-file or project-name conflicts", () => {
  const base = { name: "project", files: { a: "base", b: "base" }, folders: [], open: ["a"], active: "a" };
  const local = { ...base, files: { ...base.files, a: "unsaved" } };
  const remote = { ...base, files: { ...base.files, b: "terminal" } };
  assert.deepEqual(mergeStoppedTerminalWorkspace(base, local, remote).files, { a: "unsaved", b: "terminal" });
  assert.throws(() => mergeStoppedTerminalWorkspace(base, local, { ...remote, files: { ...remote.files, a: "terminal edit" } }), /conflict/);
  assert.throws(() => mergeStoppedTerminalWorkspace(base, { ...local, name: "ours" }, { ...remote, name: "theirs" }), /names conflict/);
  assert.equal(local.files.a, "unsaved"); assert.equal(remote.files.b, "terminal");
});
