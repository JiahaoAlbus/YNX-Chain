import assert from "node:assert/strict";
import test from "node:test";
import { resolveExecutable } from "../../workspace-agent/src/sandbox.mjs";
import { runPythonLanguageRequest } from "../src/python-lsp.mjs";

const server = await resolveExecutable(["pyright-langserver"]);

test("Pyright provides real Python completion and diagnostics", { skip: !server }, async () => {
  const files = { "src/main.py": "def greet(name: str) -> str:\n    return f'Hello {name}'\n\ngre\n" };
  const completion = await runPythonLanguageRequest({ files, activePath: "src/main.py", operation: "completion", position: { line: 3, character: 3 } });
  const items = Array.isArray(completion.result) ? completion.result : completion.result?.items || [];
  assert.equal(completion.language, "python");
  assert.equal(completion.server.name, "pyright");
  assert.equal(completion.sandbox.network, false);
  assert.ok(items.some((item) => String(item.label) === "greet"), JSON.stringify(items.slice(0, 20)));
  const diagnostics = await runPythonLanguageRequest({ files: { "src/main.py": "value: int = 'wrong'\n" }, activePath: "src/main.py", operation: "diagnostics" });
  assert.ok(diagnostics.result.some((item) => item.code === "reportAssignmentType" && String(item.message).includes("int")), JSON.stringify(diagnostics.result));
});
