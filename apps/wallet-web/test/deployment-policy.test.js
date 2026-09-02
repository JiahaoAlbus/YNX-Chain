import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const expectedSources=["/build-identity.json","/sw.js","/asset-integrity.js","/service-worker-policy.js"];

test("immutable Wallet deployment disables caching for identity and worker authority",async()=>{
  const policy=JSON.parse(await readFile(new URL("../public/vercel.json",import.meta.url),"utf8"));
  assert.equal(policy.$schema,"https://openapi.vercel.sh/vercel.json");
  assert.deepEqual(policy.headers.map(({source})=>source),expectedSources);
  for(const route of policy.headers)assert.deepEqual(route.headers,[{key:"Cache-Control",value:"no-store"}]);
});
