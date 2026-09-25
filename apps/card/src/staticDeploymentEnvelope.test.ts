import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Card static deployment envelope satisfies the existing Vercel build command without rebuilding source",()=>{
  const build=readFileSync(new URL("../scripts/build-web.mjs",import.meta.url),"utf8");
  const envelope=JSON.parse(readFileSync(new URL("../static-deploy-package.json",import.meta.url),"utf8")) as {private?:unknown;scripts?:Record<string,unknown>;dependencies?:unknown;devDependencies?:unknown};
  assert.match(build,/static-deploy-package\.json/);
  assert.match(build,/dist-web\/package\.json/);
  assert.equal(envelope.private,true);
  assert.equal(envelope.scripts?.["build:web"],"node -e \"\"");
  assert.equal(envelope.dependencies,undefined);
  assert.equal(envelope.devDependencies,undefined);
});
