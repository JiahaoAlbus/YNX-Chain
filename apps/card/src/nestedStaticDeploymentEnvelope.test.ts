import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Card nested deployment envelope preserves a fixed dist-web Output Directory without source rebuild",()=>{
  const manifest=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8")) as {scripts?:Record<string,unknown>};
  const build=readFileSync(new URL("../scripts/build-deployment-envelope.mjs",import.meta.url),"utf8");
  const verify=readFileSync(new URL("../scripts/verify-deployment-envelope.mjs",import.meta.url),"utf8");
  assert.equal(manifest.scripts?.["build:deployment-envelope"],"node scripts/build-deployment-envelope.mjs");
  assert.equal(manifest.scripts?.["verify:deployment-envelope"],"node scripts/verify-deployment-envelope.mjs");
  assert.match(build,/cpSync\(source,resolve\(envelope,"dist-web"\)/);
  assert.match(build,/build-static\.mjs/);
  assert.match(verify,/Nested Vercel output does not contain the exact static file set/);
  assert.match(verify,/\["run","build:web"\]/);
});
