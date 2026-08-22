import assert from "node:assert/strict";
import test from "node:test";
import { resolveExecutable } from "../../workspace-agent/src/sandbox.mjs";
import { runRustLanguageRequest } from "../src/rust-lsp.mjs";

const server = await resolveExecutable(["rust-analyzer"]);
const manifest = "[package]\nname = \"ynx_check\"\nversion = \"0.1.0\"\nedition = \"2021\"\n";

test("rust-analyzer provides real Rust completion and definitions", { skip: !server }, async () => {
  const files = { "Cargo.toml": manifest, "src/main.rs": "fn add(left: i32, right: i32) -> i32 { left + right }\nfn main(){ let _ = ad; }\n" };
  const completion = await runRustLanguageRequest({ files, activePath: "src/main.rs", operation: "completion", position: { line: 1, character: 21 } });
  const items = Array.isArray(completion.result) ? completion.result : completion.result?.items || [];
  assert.equal(completion.language, "rust");
  assert.equal(completion.server.name, "rust-analyzer");
  assert.equal(completion.sandbox.network, false);
  assert.ok(items.some((item) => String(item.label).startsWith("add")), JSON.stringify(items.slice(0, 20)));
  const definition = await runRustLanguageRequest({ files: { "Cargo.toml": manifest, "src/main.rs": "fn add(a:i32,b:i32)->i32{a+b}\nfn main(){let _=add(1,2);}\n" }, activePath: "src/main.rs", operation: "definition", position: { line: 1, character: 17 } });
  assert.ok(Array.isArray(definition.result) ? definition.result.length > 0 : Boolean(definition.result));
});
