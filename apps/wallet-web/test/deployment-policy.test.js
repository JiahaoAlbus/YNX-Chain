import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const expectedSources=["/(.*)","/build-identity.json","/sw.js","/asset-integrity.js","/service-worker-policy.js"];
const securityHeaders=[
  {key:"Content-Security-Policy",value:"default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; frame-src 'none'; form-action 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://rpc-testnet.ynxweb4.com https://evm.ynxweb4.com; manifest-src 'self'; worker-src 'self'"},
  {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=(), payment=(), usb=()"},
  {key:"Referrer-Policy",value:"no-referrer"},
  {key:"X-Content-Type-Options",value:"nosniff"},
  {key:"X-Frame-Options",value:"DENY"},
];

test("immutable Wallet deployment disables caching for identity and worker authority",async()=>{
  const deploymentPolicy=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
  assert.equal(deploymentPolicy.$schema,"https://openapi.vercel.sh/vercel.json");
  assert.equal(deploymentPolicy.buildCommand,"npm run build");
  assert.equal(deploymentPolicy.installCommand,"npm ci --no-audit --no-fund");
  assert.equal(deploymentPolicy.outputDirectory,"dist/pwa");
  assert.deepEqual(deploymentPolicy.headers.map(({source})=>source),expectedSources);
  assert.deepEqual(deploymentPolicy.headers[0].headers,securityHeaders);
  for(const route of deploymentPolicy.headers.slice(1))assert.deepEqual(route.headers,[{key:"Cache-Control",value:"no-store"}]);
});
