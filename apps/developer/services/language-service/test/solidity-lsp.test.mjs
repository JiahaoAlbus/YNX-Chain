import assert from "node:assert/strict";
import test from "node:test";
import { resolveExecutable } from "../../workspace-agent/src/sandbox.mjs";
import { runSolidityLanguageRequest } from "../src/solidity-lsp.mjs";

const available = Boolean(await resolveExecutable(["nomicfoundation-solidity-language-server"]));
const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Counter {
  uint256 public value;
  function set(uint256 next) external { value = next; }
}`;

test("Nomic Foundation LSP provides real Solidity completion and definitions", { skip: !available }, async () => {
  const files = { "contracts/Counter.sol": source };
  const completion = await runSolidityLanguageRequest({ files, activePath: "contracts/Counter.sol", operation: "completion", position: { line: 4, character: 2 } });
  const items = Array.isArray(completion.result) ? completion.result : completion.result?.items || [];
  assert.ok(items.length > 0);
  assert.equal(completion.language, "solidity");
  assert.equal(completion.sandbox.network, false);
  const definition = await runSolidityLanguageRequest({ files, activePath: "contracts/Counter.sol", operation: "definition", position: { line: 4, character: 41 } });
  assert.ok(definition.result);
});

test("Nomic Foundation LSP publishes Solidity diagnostics", { skip: !available }, async () => {
  const result = await runSolidityLanguageRequest({ files: { "contracts/Broken.sol": "pragma solidity ^0.8.20; contract Broken { function set(uint256 value) external { value = ; } }" }, activePath: "contracts/Broken.sol", operation: "diagnostics", position: { line: 0, character: 0 } });
  assert.ok(Array.isArray(result.result));
  assert.ok(result.result.length > 0);
});
