import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = stripTypeScriptTypes(await readFile(new URL("../frontend/src/editor/native-edit.ts", import.meta.url), "utf8"));
const { createDesktopEditRouter, registerDesktopEditor, installDesktopEditBridge } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const all = ["selectAll", "undo", "redo", "cut", "copy", "paste"];
function element({ type = "textarea", monaco = false, readOnly = false, disabled = false, editable = false } = {}) {
  return { readOnly, disabled, isContentEditable: editable, getAttribute: () => null,
    matches: selector => selector === "textarea.inputarea" ? type === "textarea" && monaco : ["input", "textarea"].includes(type) };
}
function target(active, { focused = true, readOnly = false, connected = true, model = {} } = {}) {
  const calls = [];
  const root = { isConnected: connected, contains: value => value === active };
  const listeners = new Set();
  const editor = { getDomNode: () => root, hasTextFocus: () => focused, getModel: () => model,
    focus: () => calls.push(["focus"]), trigger: (...args) => calls.push(args),
    onDidDispose: listener => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; } };
  return { editor, readOnly: () => readOnly, calls, dispose: () => [...listeners].forEach(listener => listener()) };
}
function page(active, targets) {
  const document = { activeElement: active, body: {}, documentElement: {} };
  return { document, route: createDesktopEditRouter(document, () => targets) };
}

test("native Select All, Undo and Redo issue exactly one Monaco command on the focused model", () => {
  for (const command of ["selectAll", "undo", "redo"]) {
    const active = element({ monaco: true }), editor = target(active);
    assert.equal(page(active, [editor]).route(command), "handled");
    assert.deepEqual(editor.calls, [["focus"], ["keyboard", command === "selectAll" ? "editor.action.selectAll" : command, null]]);
  }
});

test("split and diff editors follow actual focus rather than primary or remembered editor", () => {
  for (const selected of [0, 1, 2]) {
    const elements = [element({ monaco: true }), element({ monaco: true }), element({ monaco: true })];
    const editors = elements.map((active, i) => target(active, { focused: i === selected }));
    assert.equal(page(elements[selected], editors).route("selectAll"), "handled");
    for (const [i, editor] of editors.entries()) assert.equal(editor.calls.length, i === selected ? 2 : 0);
  }
});

test("native-menu window blur may retain the exact Monaco textarea, but never a different input", () => {
  const active = element({ monaco: true }), editor = target(active, { focused: false });
  assert.equal(page(active, [editor]).route("selectAll"), "handled");
  editor.calls.length = 0;
  assert.equal(page(element({ type: "input" }), [editor]).route("selectAll"), "native");
  assert.deepEqual(editor.calls, []);
});

test("Cut, Copy and Paste forward one genuine WebKit clipboard event without a second editor command", () => {
  const active = element({ monaco: true }), editor = target(active), { route } = page(active, [editor]);
  for (const command of ["cut", "copy", "paste"]) assert.equal(route(command), "native");
  assert.deepEqual(editor.calls, []);
  assert.doesNotMatch(source, /navigator\.clipboard|execCommand|setValue|executeEdits|getValueInRange/);
});

test("read-only original diff and collaboration editors allow selection/copy but block mutation and undo", () => {
  const active = element({ monaco: true }), editor = target(active, { readOnly: true }), { route } = page(active, [editor]);
  for (const command of ["undo", "redo", "cut", "paste"]) assert.equal(route(command), "blocked");
  assert.deepEqual(editor.calls, []);
  assert.equal(route("copy"), "native");
  assert.equal(route("selectAll"), "handled");
});

test("Monaco find input and Workbench text fields retain native text-control semantics", () => {
  const active = element({ type: "input" }), widget = target(active, { focused: false });
  for (const command of all) assert.equal(page(active, [widget]).route(command), "native");
  assert.deepEqual(widget.calls, []);
  for (const command of all) assert.equal(page(element({ type: "div", editable: true }), []).route(command), "native");
});

test("read-only and disabled ordinary inputs cannot be changed through the menu", () => {
  const readonly = page(element({ readOnly: true }), []).route;
  for (const command of ["undo", "redo", "cut", "paste"]) assert.equal(readonly(command), "blocked");
  assert.equal(readonly("selectAll"), "native"); assert.equal(readonly("copy"), "native");
  for (const command of all) assert.equal(page(element({ disabled: true }), []).route(command), "blocked");
});

test("missing models, detached editors, ambiguous editor ownership and whole-page focus fail closed", () => {
  const active = element({ monaco: true });
  assert.equal(page(active, [target(active, { model: null })]).route("selectAll"), "blocked");
  assert.equal(page(active, [target(active), target(active)]).route("selectAll"), "blocked");
  const detached = target(active, { connected: false });
  const { document, route } = page(active, [detached]);
  for (const command of all) assert.equal(route(command), "blocked");
  for (const command of all) assert.equal(page(active, []).route(command), "blocked");
  document.activeElement = document.body;
  assert.equal(route("selectAll"), "blocked"); assert.deepEqual(detached.calls, []);
  document.activeElement = element({ type: "button" });
  assert.equal(route("selectAll"), "blocked");
  assert.equal(route("unknown-command"), "blocked");
});

test("a failed Monaco command cannot fall back to native document editing", () => {
  const active = element({ monaco: true }), editor = target(active);
  editor.editor.trigger = () => { throw new Error("disposed while dispatching"); };
  assert.throws(() => page(active, [editor]).route("selectAll"), /disposed/);
});

test("mounted editors unregister on disposal and the Workbench bridge removes only its own handler", () => {
  const active = element({ monaco: true }), editor = target(active), window = {}, document = { activeElement: active, body: {}, documentElement: {} };
  const unregister = registerDesktopEditor(editor.editor, editor.readOnly), cleanup = installDesktopEditBridge(window, document);
  assert.equal(window.__ynxDesktopEdit("selectAll"), "handled");
  editor.dispose(); editor.calls.length = 0;
  assert.equal(window.__ynxDesktopEdit("selectAll"), "blocked");
  unregister(); cleanup();
  assert.equal(window.__ynxDesktopEdit, undefined);
  const previous = () => "blocked"; window.__ynxDesktopEdit = previous;
  const remove = installDesktopEditBridge(window, document); remove();
  assert.equal(window.__ynxDesktopEdit, previous);
});

test("native menu targets, all mounted editor surfaces and modified-diff persistence are wired", async () => {
  const [native, editor, workbench] = await Promise.all([
    readFile(new URL("../desktop/macos/main.m", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/editor/CodeEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/app/Workbench.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(native, /item\.target=self; item\.representedObject=command/);
  for (const command of all) assert.ok(native.includes(`command:@"${command}"`));
  assert.match(native, /YNXShouldForwardNativeEdit\(route,error,NSApp\.keyWindow==window,window\.firstResponder==responder\)/);
  assert.match(native, /location\.origin!==origin/);
  assert.equal((editor.match(/registerDesktopEditor\(/g) || []).length, 4);
  assert.match(editor, /modified\.onDidChangeModelContent/);
  assert.match(editor, /value !== contentRef\.current\) changeCallbackRef\.current\(value\)/);
  assert.match(workbench, /useEffect\(\(\) => installDesktopEditBridge\(window, document\), \[\]\)/);
});

test("compiled native forwarding gate rejects handled, blocked, failed and changed-focus results", { skip: process.platform !== "darwin", timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "ynx-desktop-edit-")); t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, "edit-routing-proof"), exec = promisify(execFile);
  await exec("/usr/bin/clang", ["-fobjc-arc", `-fmodules-cache-path=${root}/module-cache`, fileURLToPath(new URL("./fixtures/macos-edit-routing.m", import.meta.url)), "-o", binary, "-framework", "Cocoa", "-framework", "Security", "-framework", "WebKit"], { timeout: 45000 });
  const { stdout } = await exec(binary);
  assert.match(stdout, /Native Edit selectors and no-fallback forwarding gates passed/);
});
