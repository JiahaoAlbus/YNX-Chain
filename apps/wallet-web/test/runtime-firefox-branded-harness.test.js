import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const source=await readFile(new URL("../scripts/runtime-firefox-branded.mjs",import.meta.url),"utf8");

test("branded Firefox harness accepts only the isolated verified app and profile",()=>{
  assert.match(source,/\/tmp\/ynx-firefox-install\./u);
  assert.match(source,/mkdtemp\(join\(tmpdir\(\),"ynx-firefox-branded-profile-"\)\)/u);
  assert.match(source,/--firefox-profile/u);
  assert.match(source,/--keep-profile-changes/u);
  assert.match(source,/"\/usr\/bin\/plutil"/u);
});

test("branded Firefox harness opens the popup on launch two and keeps release claims false",()=>{
  assert.match(source,/moz-extension:\/\/\$\{first\.addonUuid\}\/index\.html/u);
  assert.match(source,/second\.addonUuid===first\.addonUuid/u);
  assert.match(source,/firefoxPidsAtLoad\.length>0/u);
  assert.match(source,/extensions\.json/u);
  assert.match(source,/temporaryAddonPersistedAfterFirstShutdown/u);
  assert.match(source,/temporaryAddonReloadedOnSecondLaunch/u);
  assert.match(source,/temporaryAddonRemovedAfterSuccessfulShutdown/u);
  assert.match(source,/popupRequestedOnSecondLaunch/u);
  assert.match(source,/popupDomObserved:false/u);
  assert.match(source,/backgroundStarted:false/u);
  assert.match(source,/process\.kill\(pid,"SIGKILL"\)/u);
  for(const claim of ["installedLocal:false","providerSuccessClaimed:false","accountAuthorized:false","messageSigned:false","transactionSubmitted:false"])assert.match(source,new RegExp(claim,"u"));
});
