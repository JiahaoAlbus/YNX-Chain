import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { readOpenedFiles } = await import("../src/explorer/openFiles.ts");

test("ordinary opening accepts independent text file extensions and retains existing project bytes", async () => {
  const existing = { "main.cpp": "existing unsaved content" };
  const names = ["probe.py", "probe.js", "probe.ts", "probe.md", "probe.json", "LICENSE"];
  const additions = await readOpenedFiles(names.map(name => new File([`public ${name}`], name)), existing);
  assert.deepEqual(Object.keys(additions), names);
  for (const name of names) assert.equal(additions[name], `public ${name}`);
  assert.deepEqual(existing, { "main.cpp": "existing unsaved content" });
});
test("a conflicting or duplicate basename cannot overwrite existing content", async () => {
  const existing = { "probe.py": "keep" };
  await assert.rejects(readOpenedFiles([new File(["replace"], "probe.py")], existing), /already exists/);
  await assert.rejects(readOpenedFiles([new File(["one"], "same.js"), new File(["two"], "same.js")], {}), /already exists/);
  assert.equal(existing["probe.py"], "keep");
});
test("invalid text, unsafe paths and merged capacity reject the entire operation", async () => {
  await assert.rejects(readOpenedFiles([new File([new Uint8Array([255])], "binary.dat")], {}), /UTF-8/);
  await assert.rejects(readOpenedFiles([new File(["escape"], "../escape.py")], {}), /unsafe path/);
  const existing = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`old${i}.txt`, "keep"]));
  await assert.rejects(readOpenedFiles([new File(["new"], "extra.py")], existing), /256-file/);
  assert.equal(Object.keys(existing).length, 256);
});
