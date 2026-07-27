import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BrowserState, PhishingPolicy, updateBoundary } from "../src/state.js";

async function tempState(prefix = "ynx-browser-") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, path: join(dir, "state.json") };
}

test("tabs, history, bookmarks, downloads and recovery persist", async () => {
  const { path } = await tempState();
  const state = new BrowserState(path);
  let tab = await state.openTab("https://a.example");
  tab = await state.updateTab(tab.id, { title: "A" });
  await state.recordVisit(tab, { title: "A", url: tab.url });
  await state.addBookmark({ title: "A", url: tab.url });
  await state.recordDownload({ filename: "a.pdf", url: "https://a.example/a.pdf", state: "completed" });
  const snapshot = await state.snapshot();
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.history.length, 1);
  assert.equal(snapshot.bookmarks.length, 1);
  assert.equal(snapshot.downloads.length, 1);
  assert.equal((await state.recoveryPlan()).length, 1);
});

test("private state leaves no persistent trace", async () => {
  const { path } = await tempState("ynx-browser-private-");
  const state = new BrowserState(path);
  const tab = await state.openTab("https://private.example", { privateMode: true });
  await state.recordVisit(tab, { title: "Private", url: tab.url });
  await state.recordDownload({ filename: "private.txt", url: tab.url, state: "completed" }, { privateMode: true });
  state.closePrivateWindow();
  await assert.rejects(readFile(path), { code: "ENOENT" });
});

test("crash recovery excludes private tabs", async () => {
  const { path } = await tempState("ynx-crash-");
  const state = new BrowserState(path);
  const tab = await state.openTab("https://a.example");
  await state.updateTab(tab.id, { crashed: true });
  await state.openTab("https://private.example", { privateMode: true });
  const plan = await state.recoveryPlan();
  assert.deepEqual(plan.map(item => [item.url, item.crashed]), [["https://a.example", true]]);
});

test("v1 migration removes persisted private traces and upgrades to v2", async () => {
  const { path } = await tempState("ynx-migrate-");
  await writeFile(path, JSON.stringify({
    version: 1,
    tabs: [
      { id: "normal", url: "https://normal.example", title: "Normal", privateMode: false },
      { id: "private", url: "https://private.example", title: "Private", privateMode: true }
    ],
    activeTabId: "private",
    history: [
      { id: "visit", title: "Normal", url: "https://normal.example", visitedAt: "2026-07-27T00:00:00.000Z" },
      { id: "private-visit", title: "Private", url: "https://private.example", visitedAt: "2026-07-27T00:01:00.000Z", privateMode: true }
    ],
    bookmarks: [
      { id: "private-bookmark", title: "Private", url: "https://private.example", privateMode: true }
    ],
    downloads: [
      { id: "normal-download", filename: "normal.txt", url: "https://normal.example/a", state: "completed" },
      { id: "private-download", filename: "private.txt", url: "https://private.example/a", state: "completed", privateMode: true },
      { id: "ephemeral-download", filename: "ephemeral.txt", url: "https://private.example/b", state: "completed", ephemeral: true }
    ],
    closedTabs: [{ id: "closed-private", url: "https://private.example", title: "Private", privateMode: true }],
    audit: []
  }));

  const state = new BrowserState(path);
  const snapshot = await state.snapshot();
  assert.equal(snapshot.version, 2);
  assert.deepEqual(snapshot.tabs.map(tab => tab.id), ["normal"]);
  assert.equal(snapshot.activeTabId, "normal");
  assert.deepEqual(snapshot.history.map(item => item.id), ["visit"]);
  assert.deepEqual(snapshot.bookmarks, []);
  assert.deepEqual(snapshot.downloads.map(item => item.id), ["normal-download"]);
  assert.deepEqual(snapshot.closedTabs, []);
  assert.equal(JSON.parse(await readFile(path, "utf8")).version, 2);
  assert.equal(JSON.parse(await readFile(`${path}.bak`, "utf8")).version, 1);
});

test("tab identity and privacy classification cannot be patched by a caller", async () => {
  const { path } = await tempState("ynx-tab-boundary-");
  const state = new BrowserState(path);
  const normal = await state.openTab("https://normal.example");
  const updatedNormal = await state.updateTab(normal.id, { id: "attacker", privateMode: true, title: "Updated" });
  assert.equal(updatedNormal.id, normal.id);
  assert.equal(updatedNormal.privateMode, false);
  assert.equal(updatedNormal.title, "Updated");

  const privateTab = await state.openTab("https://private.example", { privateMode: true });
  const updatedPrivate = await state.updateTab(privateTab.id, { id: "attacker-private", privateMode: false, title: "Still Private" });
  assert.equal(updatedPrivate.id, privateTab.id);
  assert.equal(updatedPrivate.privateMode, true);

  await state.recordVisit({ ...normal, privateMode: true }, { title: "Normal Visit", url: normal.url });
  assert.equal((await state.snapshot()).history.length, 1);
});

test("corrupt primary state restores a valid backup without importing private data", async () => {
  const { path } = await tempState("ynx-corrupt-");
  await writeFile(`${path}.bak`, JSON.stringify({
    version: 2,
    tabs: [{ id: "restored", url: "https://restored.example", title: "Restored", privateMode: false }],
    activeTabId: "restored",
    history: [],
    bookmarks: [],
    downloads: [],
    closedTabs: [],
    audit: []
  }));
  await writeFile(path, "{invalid-json");

  const state = new BrowserState(path);
  const snapshot = await state.snapshot();
  assert.equal(snapshot.tabs[0].id, "restored");
  assert.equal(JSON.parse(await readFile(path, "utf8")).version, 2);
});

test("backup, export, selective delete and restore form a recoverable lifecycle", async () => {
  const { dir, path } = await tempState("ynx-lifecycle-");
  const state = new BrowserState(path, { clock: () => "2026-07-27T12:00:00.000Z" });
  const tab = await state.openTab("https://a.example");
  await state.recordVisit(tab, { title: "A", url: tab.url });
  await state.addBookmark({ title: "A", url: tab.url });
  await state.recordDownload({ filename: "a.pdf", url: "https://a.example/a.pdf", state: "completed" });
  await state.recordAudit("permission-decision", { origin: "https://a.example", decision: "deny" });

  const backupPath = join(dir, "browser.backup.json");
  const exportPath = join(dir, "browser.export.json");
  const backup = await state.createBackup(backupPath);
  assert.equal(backup.version, 2);
  assert.ok(backup.records >= 5);

  const exported = await state.exportTo(exportPath);
  assert.equal(exported.includeAudit, false);
  const exportPayload = JSON.parse(await readFile(exportPath, "utf8"));
  assert.equal(exportPayload.schemaVersion, "ynx.browser.export.v1");
  assert.equal(exportPayload.data.audit.length, 0);
  assert.equal(exportPayload.data.tabs.length, 1);

  const deleted = await state.deleteData({ history: true, bookmarks: true, downloads: true, audit: true, sessions: true });
  assert.deepEqual(deleted, { history: 1, bookmarks: 1, downloads: 1, audit: 1, sessions: 1 });
  const empty = await state.snapshot();
  assert.equal(empty.tabs.length, 0);
  assert.equal(empty.history.length, 0);
  assert.equal(empty.bookmarks.length, 0);
  assert.equal(empty.downloads.length, 0);
  assert.equal(empty.audit.length, 0);
  await assert.rejects(state.deleteData(), /at least one browser data class/);

  const restored = await state.restoreBackup(backupPath);
  assert.equal(restored.tabs.length, 1);
  assert.equal(restored.history.length, 1);
  assert.equal(restored.bookmarks.length, 1);
  assert.equal(restored.downloads.length, 1);
  assert.equal(restored.audit.length, 1);
});

test("unsupported future state fails closed", async () => {
  const { path } = await tempState("ynx-future-state-");
  await writeFile(path, JSON.stringify({ version: 999 }));
  const state = new BrowserState(path);
  await assert.rejects(state.snapshot(), /unsupported browser state version/);
});

test("phishing boundary states evidence limits", () => {
  const policy = new PhishingPolicy({ blockedOrigins: ["https://bad.example"] });
  assert.equal(policy.check("https://bad.example/x").action, "warn");
  assert.equal(policy.check("https://unknown.example").claim, "not-a-safety-guarantee");
});

test("updates require a valid signature and newer semver", () => {
  assert.equal(updateBoundary({ currentVersion: "1.0.0", offeredVersion: "1.1.0", signatureValid: true, channel: "stable" }).allowed, true);
  assert.equal(updateBoundary({ currentVersion: "1.0.0", offeredVersion: "2.0.0", signatureValid: false, channel: "stable" }).allowed, false);
});
