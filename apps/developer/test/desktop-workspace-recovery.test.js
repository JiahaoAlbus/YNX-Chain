import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = stripTypeScriptTypes(await readFile(new URL("../frontend/src/state/workspace.ts", import.meta.url), "utf8"));
let sequence = 0;
const loadModule = () => import(`data:text/javascript;base64,${Buffer.from(`${source}\n// context ${sequence++}`).toString("base64")}`);
const browserStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const snapshot = () => ({ id: "same-project-id", name: "Restart proof", revision: 7, remoteRevision: 2,
  files: { "src/proof.cpp": "// content survives a changed loopback origin\n" }, folders: ["src"], open: ["src/proof.cpp"], active: "src/proof.cpp" });

test("native relaunch restores the same project and edits with a completely empty new-origin localStorage", async () => {
  let disk = null;
  globalThis.localStorage = browserStorage();
  globalThis.window = { ynxDesktopWorkspace: { initialProject: null, saveProject: async value => { disk = structuredClone(value); } } };
  const firstLaunch = await loadModule();
  await firstLaunch.saveProject(snapshot());
  globalThis.localStorage = browserStorage();
  globalThis.window = { ynxDesktopWorkspace: { initialProject: disk, saveProject: async value => { disk = structuredClone(value); } } };
  const secondLaunch = await loadModule();
  assert.deepEqual(secondLaunch.loadProject(), snapshot());
});

test("same-origin reload keeps acknowledged newer edits while another project's cache cannot replace the native identity", async () => {
  const stored = snapshot();
  globalThis.localStorage = browserStorage();
  globalThis.window = { ynxDesktopWorkspace: { initialProject: stored, saveProject: async () => {} } };
  const workspace = await loadModule();
  const edited = { ...stored, revision: 8, files: { ...stored.files, "draft.txt": "offline edit" } };
  await workspace.saveProject(edited);
  assert.deepEqual(workspace.loadProject(), edited);
  localStorage.setItem("ynx-code-project-v1", JSON.stringify({ ...edited, id: "unrelated-port-cache", revision: 100 }));
  assert.deepEqual(workspace.loadProject(), stored);
});

test("native persistence failure rejects save, and persisted snapshots exclude unrelated credentials", async () => {
  globalThis.localStorage = browserStorage();
  let written;
  globalThis.window = { ynxDesktopWorkspace: { initialProject: null, saveProject: async value => { written = value; } } };
  const workspace = await loadModule();
  await workspace.saveProject({ ...snapshot(), walletSession: "must-not-persist", collaborationCredential: "must-not-persist" });
  assert.deepEqual(written, snapshot());
  window.ynxDesktopWorkspace.saveProject = async () => { throw new Error("disk unavailable"); };
  await assert.rejects(workspace.saveProject(snapshot()), /disk unavailable/);
});

test("browser-only projects and empty native workspaces still recover, and malformed records are not accepted", async () => {
  globalThis.localStorage = browserStorage();
  globalThis.window = {};
  const workspace = await loadModule();
  await workspace.saveProject(snapshot());
  assert.deepEqual(workspace.loadProject(), snapshot());
  const empty = { ...snapshot(), files: {}, folders: [], open: [], active: "" };
  assert.deepEqual(workspace.restoreProject(empty), empty);
  assert.equal(workspace.restoreProject({ ...snapshot(), id: "../escape" }), null);
  assert.equal(workspace.restoreProject({ ...snapshot(), files: { "../escape": "bad" } }), null);
  assert.equal(workspace.restoreProject({ ...snapshot(), files: { "src/proof.cpp": 42 } }), null);
  assert.equal(workspace.restoreProject({ ...snapshot(), files: { "src/proof.cpp": "x".repeat(2 * 1024 * 1024) } }), null);
});

test("native menu actions reach current Workbench handlers and expose import/export dialog delegates", async () => {
  const [native, workbench] = await Promise.all([
    readFile(new URL("../desktop/macos/main.m", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/app/Workbench.tsx", import.meta.url), "utf8"),
  ]);
  for (const command of ["new-file", "save", "import-project", "export-project"]) {
    assert.ok(native.includes(`@"command":@"${command}"`));
    assert.ok(workbench.includes(`detail?.command === "${command}"`));
  }
  assert.doesNotMatch(native, /#create-project|#import-project|#export-project|#editor/);
  for (const method of ["runOpenPanelWithParameters", "runJavaScriptConfirmPanelWithMessage", "runJavaScriptTextInputPanelWithPrompt", "NSSavePanel", "@selector(paste:)"]) assert.ok(native.includes(method));
  assert.match(native, /message\.frameInfo\.mainFrame/);
  assert.match(native, /origin\.port!=_port/);
});
