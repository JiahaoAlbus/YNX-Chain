import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("fallback contract always offers YNX download and MetaMask when YNX is absent", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /download"\)\.classList\.toggle\("hidden", ynxPresent\)/);
  assert.match(source, /metamask"\)\.classList\.toggle\("hidden", ynxPresent\)/);
});
