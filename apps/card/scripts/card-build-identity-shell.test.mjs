import test from "node:test";
import assert from "node:assert/strict";
import {applyCardBuildIdentityShell as shell} from "./card-build-identity-shell.mjs";
const html='<html lang="en"><head><title>YNX Card</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
const identity={releaseChannel:"qa",sourceCommit:"a".repeat(40),appVersion:"1.0.0"};
test("QA is visibly and accessibly distinguished with exact source and version",()=>{
  const result=shell(html,identity);
  assert.match(result,/<title>YNX Card QA \| 1.0.0<\/title>/);
  assert.ok(result.includes('aria-label="QA build, not the formal Card release"'));
  assert.ok(result.includes(`Source ${identity.sourceCommit}`));
  assert.ok(result.includes("Not the formal release. No real payments."));
  assert.ok(result.includes('<div id="root"></div><script src="/app.js"></script>'));
});
test("formal Testnet artifact retains product shell and does not get QA badge",()=>{
  const result=shell(html,{...identity,releaseChannel:"testnet-release"});
  assert.match(result,/<title>YNX Card \| 1.0.0<\/title>/);
  assert.ok(!result.includes('id="ynx-card-qa-build"'));
  assert.ok(result.includes('data-ynx-card-release-channel="testnet-release"'));
});
test("invalid source/version and runner-only cover fail closed",()=>{
  for(const patch of [{sourceCommit:"dev"},{appVersion:'1<script>'},{releaseChannel:"production"}])
    assert.throws(()=>shell(html,{...identity,...patch}),/identity/);
  assert.throws(()=>shell('<div>Electron</div>',identity),/product shell/);
});
