import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("live chain gate uses read methods implemented by the accepted YNX devnet", async () => {
  const source = await readFile(new URL("../scripts/live-chain-tools-check.mjs", import.meta.url), "utf8");
  assert.match(source, /rpc\("net_version"\)/);
  assert.match(source, /rpc\("eth_getBlockByNumber",\["latest",false\]\)/);
  assert.doesNotMatch(source, /rpc\("eth_gasPrice"\)/);
});
