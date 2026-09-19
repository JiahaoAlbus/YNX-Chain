import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const expectedSources=["/build-identity.json","/sw.js","/asset-integrity.js","/service-worker-policy.js"];

test("immutable Wallet deployment disables caching for identity and worker authority",async()=>{
  const deploymentPolicy=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
  assert.equal(deploymentPolicy.$schema,"https://openapi.vercel.sh/vercel.json");
  assert.equal(deploymentPolicy.buildCommand,"npm run build");
  assert.equal(deploymentPolicy.installCommand,"npm ci --no-audit --no-fund");
  assert.equal(deploymentPolicy.outputDirectory,"dist/pwa");
  assert.deepEqual(deploymentPolicy.headers.map(({source})=>source),expectedSources);
  for(const route of deploymentPolicy.headers)assert.deepEqual(route.headers,[{key:"Cache-Control",value:"no-store"}]);
});
