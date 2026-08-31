import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const source=await readFile(new URL("../scripts/runtime-branded-cdp.mjs",import.meta.url),"utf8");

test("native branded CDP harness isolates profiles and never disables extensions",()=>{
  assert.match(source,/mkdtemp\(join\(tmpdir\(\),`ynx-wallet-/u);
  assert.doesNotMatch(source,/"--disable-extensions"/u);
  assert.match(source,/--disable-extensions-except=/u);
  assert.match(source,/--load-extension=/u);
  assert.match(source,/dailyProfileTouched:false/u);
  assert.match(source,/process\.env\.YNX_BRANDED_HEADED==="1"/u);
  assert.match(source,/headed\?\[\]:\["--headless=new"\]/u);
  assert.match(source,/"--disable-gpu"/u);
  assert.match(source,/"--remote-allow-origins=\*"/u);
  assert.match(source,/visibleBrowserAcceptance:false/u);
  assert.match(source,/ws:\/\/127\.0\.0\.1/u);
  assert.match(source,/rm\(join\(profile,"DevToolsActivePort"\),\{force:true\}\)/u);
});

test("native branded CDP harness wakes MV3, proves two PIDs, and cleans its process group",()=>{
  assert.match(source,/extensions manager entry list/u);
  assert.match(source,/extensionEntry=launch\.managerEntries\.find/u);
  assert.match(source,/const extensionId=extensionEntry\.id/u);
  assert.match(source,/COMMAND_LINE_EXTENSION_NOT_LOADED/u);
  assert.match(source,/YNX_WALLET_DISCOVER/u);
  assert.match(source,/serviceworker/u);
  assert.match(source,/first\.pid!==second\.pid/u);
  assert.match(source,/process\.kill\(-child\.pid,"SIGTERM"\)/u);
  assert.match(source,/process\.kill\(-child\.pid,"SIGKILL"\)/u);
  assert.match(source,/"\/usr\/bin\/open",\["-n",browserSpec\.app/u);
  assert.match(source,/const marker=`--user-data-dir=\$\{profile\}`/u);
  assert.match(source,/process\.kill\(pid,"SIGKILL"\)/u);
  for(const claim of ["installedLocal:false","providerSuccessClaimed:false","accountAuthorized:false","messageSigned:false","transactionSubmitted:false"])assert.match(source,new RegExp(claim,"u"));
});
