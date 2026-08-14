import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { YNX_TESTNET_CHAIN_QUANTITY } from "@ynx-chain/wallet-auth";

test("desktop shell consumes frozen Wallet Auth chain constant", () => {
  assert.equal(YNX_TESTNET_CHAIN_QUANTITY, "0x1917");
});

test("shell is explicit and fail closed", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
  assert.match(html, /Review and sign — unavailable/);
  assert.match(html, /disabled aria-disabled="true"/);
  assert.match(html, /Not created/);
  assert.match(main, /result !== YNX_TESTNET_CHAIN_QUANTITY/);
  assert.match(main, /signingEnabled: false/);
  assert.match(main, /window\.isVisible\(\)/);
  assert.match(main, /window\.getTitle\(\)/);
});
