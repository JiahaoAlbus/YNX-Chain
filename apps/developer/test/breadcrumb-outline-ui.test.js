import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("Breadcrumb and Outline expose current-file navigation backed by document symbols", async () => {
  const workbench = await read("frontend/src/app/Workbench.tsx"),
    editor = await read("frontend/src/editor/CodeEditor.tsx"),
    outline = await read("frontend/src/outline/OutlinePanel.tsx"),
    language = await read("services/language-service/src/cpp-lsp.mjs");
  assert.match(workbench, /aria-label="Editor breadcrumbs"/);
  assert.match(workbench, /project\.active\.split\("\/"\)/);
  assert.match(workbench, /view === "outline"/);
  assert.match(outline, /"documentSymbols"/);
  assert.match(outline, /result\.content === content/);
  assert.match(outline, /role="tree"/);
  assert.match(outline, /onNavigate\(activePath, item\.line, item\.column\)/);
  assert.match(language, /textDocument\/documentSymbol/);
  assert.match(editor, /revealPositionInCenter/);
  assert.match(editor, /editor\.setPosition/);
});
