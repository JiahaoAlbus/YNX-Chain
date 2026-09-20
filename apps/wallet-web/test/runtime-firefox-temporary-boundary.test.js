import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const source=await readFile(new URL("../scripts/runtime-firefox-temporary-boundary.mjs",import.meta.url),"utf8");
test("Firefox boundary gate proves temporary absence through the branded runtime add-on actor",()=>{
  assert.match(source,/connectWithMaxRetries/u);
  assert.match(source,/getInstalledAddon\(result\.addonId\)/u);
  assert.match(source,/extensions\.json/u);
  assert.match(source,/temporaryAddonNonPersistenceProved/u);
  assert.match(source,/installedLocal:false/u);
  assert.match(source,/popupDomObserved:false/u);
});
