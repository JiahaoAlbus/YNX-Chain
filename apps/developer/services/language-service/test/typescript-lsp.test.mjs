import assert from "node:assert/strict";
import test from "node:test";
import { resolveExecutable } from "../../workspace-agent/src/sandbox.mjs";
import { runTypescriptLanguageRequest } from "../src/typescript-lsp.mjs";

const server = await resolveExecutable(["typescript-language-server"]);
const files = { "src/math.ts": "export function add(left: number, right: number) { return left + right; }\nconst total = ad\n" };

test("TypeScript language server provides real completion, definitions and document symbols", { skip: !server }, async () => {
  const completion = await runTypescriptLanguageRequest({ files, activePath: "src/math.ts", operation: "completion", position: { line: 1, character: 16 } });
  const items = Array.isArray(completion.result) ? completion.result : completion.result?.items || [];
  assert.equal(completion.language, "typescript");
  assert.equal(completion.server.name, "typescript-language-server");
  assert.equal(completion.sandbox.network, false);
  assert.ok(items.some((item) => String(item.label) === "add"), JSON.stringify(items.slice(0, 12)));
  const definition = await runTypescriptLanguageRequest({ files: { "src/math.ts": "function add(a: number,b: number){return a+b;}\nadd(1,2);\n" }, activePath: "src/math.ts", operation: "definition", position: { line: 1, character: 1 } });
  assert.ok(Array.isArray(definition.result) ? definition.result.length > 0 : Boolean(definition.result));
  const symbols = await runTypescriptLanguageRequest({ files, activePath: "src/math.ts", operation: "documentSymbols" });
  assert.ok(Array.isArray(symbols.result));
  assert.ok(symbols.result.some((item) => String(item.name) === "add"), JSON.stringify(symbols.result));
});
