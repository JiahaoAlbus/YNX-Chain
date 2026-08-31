import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Card static build emits a deterministic source-bound Testnet runtime identity",()=>{
  const build=readFileSync(new URL("../scripts/build-web.mjs",import.meta.url),"utf8");
  assert.match(build,/execFileSync\("git",\["rev-parse","HEAD"\]/);
  assert.match(build,/execFileSync\("git",\["rev-parse","HEAD\^\{tree\}"\]/);
  assert.match(build,/runtime-identity\.json/);
  assert.match(build,/schemaVersion:"ynx\.card\.runtime-identity\.v1"/);
  assert.match(build,/environment:"testnet",evmChainId:6423,evmChainHex:"0x1917"/);
  assert.match(build,/paymentNetwork:"simulation",productionRealPayments:false/);
  assert.doesNotMatch(build,/9102|0x238e/);
});
