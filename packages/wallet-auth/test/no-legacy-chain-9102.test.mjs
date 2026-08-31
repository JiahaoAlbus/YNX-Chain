import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyChain9102Findings, verifyNoLegacyChain9102 } from "../scripts/verify-no-legacy-chain-9102.mjs";

test("release runtime scanner rejects every legacy 9102 chain identity", () => {
  assert.deepEqual(legacyChain9102Findings("apps/example/src/native.ts", 'const chainId = "ynx_9102-1";'), [{ file: "apps/example/src/native.ts", line: 1, code: "LEGACY_NATIVE_CHAIN_9102" }]);
  assert.deepEqual(legacyChain9102Findings("apps/example/dist/main.js", 'provider.request({method:"wallet_switchEthereumChain",params:[{chainId:"0x238e"}]})'), [{ file: "apps/example/dist/main.js", line: 1, code: "LEGACY_EVM_CHAIN_9102" }]);
  assert.deepEqual(legacyChain9102Findings("packages/example/src/network.kt", "val chainId = 9102"), [{ file: "packages/example/src/network.kt", line: 1, code: "LEGACY_DECIMAL_CHAIN_9102" }]);
});

test("release runtime scanner accepts only the current 6423 identities in tracked runtime surfaces", async () => {
  assert.deepEqual(legacyChain9102Findings("apps/example/src/network.ts", 'const native="ynx_6423-1"; const evm="0x1917"; const chainId=6423;'), []);
  const root = new URL("../../..", import.meta.url).pathname;
  assert.deepEqual(await verifyNoLegacyChain9102(root), []);
});
