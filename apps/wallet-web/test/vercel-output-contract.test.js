import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("Vercel deploys the complete atomic Wallet PWA output, not the source public fallback", async () => {
  const [config, build] = await Promise.all([
    readFile(new URL("../vercel.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
  ]);
  assert.deepEqual({buildCommand:config.buildCommand,outputDirectory:config.outputDirectory},{buildCommand:"npm run build",outputDirectory:"dist/pwa"});
  assert.deepEqual(config.headers,[{
    source:"/(sw|asset-integrity)\\.js",
    headers:[
      {key:"Cache-Control",value:"no-store, max-age=0, must-revalidate"},
      {key:"X-Content-Type-Options",value:"nosniff"},
    ],
  }]);
  assert.match(build,/join\(dist,"pwa","asset-integrity\.js"\)/);
  assert.match(build,/join\(dist,"pwa","core-auth-binding\.js"\)/);
  for (const module of ["provider.js","service-worker-policy.js"]) assert.match(build,new RegExp(`"${module.replace(".","\\.")}"`));
  assert.match(build,/for\(const file of pwaIntegrityFiles\)/);
});
