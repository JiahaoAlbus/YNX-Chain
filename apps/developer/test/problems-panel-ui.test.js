import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("Problems panel renders current navigable language-server diagnostics", async () => {
  const workbench = await read("frontend/src/app/Workbench.tsx"),
    editor = await read("frontend/src/editor/CodeEditor.tsx");
  assert.match(editor, /onDiagnostics/);
  assert.match(editor, /EditorProblem/);
  assert.match(editor, /message: marker\.message/);
  assert.match(editor, /startLineNumber/);
  assert.match(editor, /diagnosticsCallbackRef/);
  assert.match(workbench, /problemsByPath/);
  assert.match(workbench, /project\.files\[path\] === entry\.content/);
  assert.match(workbench, /Language server problems/);
  assert.match(workbench, /problem\.path.*problem\.line.*problem\.column/s);
  assert.match(workbench, /onClick=\{\(\) => open\(problem\.path\)\}/);
  assert.doesNotMatch(workbench, /PROBLEMS <span>0<\/span>/);
});
