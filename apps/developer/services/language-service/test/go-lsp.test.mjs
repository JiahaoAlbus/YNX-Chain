import assert from "node:assert/strict";
import test from "node:test";
import { resolveExecutable } from "../../workspace-agent/src/sandbox.mjs";
import { runGoLanguageRequest } from "../src/go-lsp.mjs";

const server = await resolveExecutable(["gopls"]);
const files = { "go.mod": "module ynx.dev/check\n\ngo 1.21\n", "main.go": "package main\nfunc add(left int, right int) int { return left + right }\nfunc main(){ _ = ad }\n" };

test("gopls provides real Go completion and definitions", { skip: !server }, async () => {
  const completion = await runGoLanguageRequest({ files, activePath: "main.go", operation: "completion", position: { line: 2, character: 19 } });
  const items = Array.isArray(completion.result) ? completion.result : completion.result?.items || [];
  assert.equal(completion.language, "go");
  assert.equal(completion.server.name, "gopls");
  assert.equal(completion.sandbox.network, false);
  assert.ok(items.some((item) => String(item.label) === "add"), JSON.stringify(items.slice(0, 20)));
  const definition = await runGoLanguageRequest({ files: { ...files, "main.go": "package main\nfunc add(a int,b int) int{return a+b}\nfunc main(){_ = add(1,2)}\n" }, activePath: "main.go", operation: "definition", position: { line: 2, character: 17 } });
  assert.ok(Array.isArray(definition.result) ? definition.result.length > 0 : Boolean(definition.result));
});

test("gopls provides real Go references, rename, formatting, and document symbols", { skip: !server }, async () => {
  const semanticFiles = {
    "go.mod": "module ynx.dev/check\n\ngo 1.21\n",
    "main.go": "package main\nfunc add(a int, b int) int { return a + b }\nfunc main() { _ = add(1, 2) }\n",
  };
  const symbolPosition = { line: 1, character: 6 };
  const references = await runGoLanguageRequest({ files: semanticFiles, activePath: "main.go", operation: "references", position: symbolPosition });
  assert.equal(references.result.length, 2);
  const rename = await runGoLanguageRequest({ files: semanticFiles, activePath: "main.go", operation: "rename", position: symbolPosition, newName: "sum" });
  assert.equal(rename.result.documentChanges?.[0]?.edits?.length, 2);
  const format = await runGoLanguageRequest({ files: semanticFiles, activePath: "main.go", operation: "format" });
  assert.ok(format.result.length > 0);
  const symbols = await runGoLanguageRequest({ files: semanticFiles, activePath: "main.go", operation: "documentSymbols" });
  assert.deepEqual(symbols.result.map((symbol) => symbol.name), ["add", "main"]);
});
