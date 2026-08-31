import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("Settings controls real persisted Monaco preferences and manual durability", async () => {
  const workbench = await read("frontend/src/app/Workbench.tsx"),
    editor = await read("frontend/src/editor/CodeEditor.tsx");
  assert.match(workbench, /onClick=\{\(\) => setSettingsOpen\(true\)\}/);
  assert.match(workbench, /ynx-code-editor-preferences\/v1/);
  assert.match(workbench, /Editor font size/);
  assert.match(workbench, /Minimap/);
  assert.match(workbench, /Word wrap/);
  assert.match(workbench, /Auto save to workspace service/);
  assert.match(workbench, /autoSaveDelay/);
  assert.match(workbench, /!editorPreferences\.autoSave.*saveWorkspace/s);
  assert.match(editor, /fontSize,/);
  assert.match(editor, /minimap: \{ enabled: minimap \}/);
  assert.match(editor, /wordWrap,/);
});
