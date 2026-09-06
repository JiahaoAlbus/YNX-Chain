import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const source=await readFile(new URL("../scripts/runtime-branded.mjs",import.meta.url),"utf8");

test("branded runtime gate is selectable and does not inherit Playwright's extension blocker",()=>{
  assert.match(source,/process\.env\.YNX_BROWSER\|\|"all"/u);
  assert.match(source,/ignoreDefaultArgs:\["--disable-extensions"\]/u);
  assert.match(source,/--disable-extensions-except=/u);
  assert.match(source,/--load-extension=/u);
});

test("branded runtime gate uses disposable profiles, bounded launches, and honest release booleans",()=>{
  assert.match(source,/mkdtemp\(join\(tmpdir\(\),`ynx-wallet-/u);
  assert.match(source,/profileClass:"disposable-isolated-profile"/u);
  assert.match(source,/bounded\(chromium\.launchPersistentContext/u);
  assert.match(source,/installedLocal:false/u);
  assert.match(source,/providerSuccessClaimed:false/u);
  assert.match(source,/accountAuthorized:false/u);
  assert.match(source,/messageSigned:false/u);
  assert.match(source,/transactionSubmitted:false/u);
  assert.match(source,/server\.closeAllConnections\?\.\(\)/u);
  assert.match(source,/process\.exit\(results\.some/u);
});
