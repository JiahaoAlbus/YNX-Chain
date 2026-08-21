import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const read=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("release pins accepted manifest and truthful endpoint states",async()=>{
  const runtime=await read("src/public/runtime-config.js");
  assert.match(runtime,/1\.0\.0-p0\.2/);
  assert.match(runtime,/3c606cad1d9bfa71fc507f54b6ad8184a6580c7df75440675b5db921b7e67bb5/);
  assert.match(runtime,/appGateway:Object\.freeze\(\{status:"UNAVAILABLE"\}\)/);
  assert.match(runtime,/searchProductApi:Object\.freeze\(\{status:"PENDING"/);
});

test("public Search remains usable without login and Wallet controls are explicit",async()=>{
  const [app,html,launcher]=await Promise.all([read("src/public/app.js"),read("src/public/index.html"),read("src/public/safe-wallet-launcher.js")]);
  assert.match(app,/let locale = resolve\(localStorage\.getItem\("ynx-search-locale"\) \|\| "en"\)/);
  assert.match(html,/id="search-form"/);
  assert.match(html,/id="wallet-button"[^>]*>Connect Wallet</);
  assert.match(html,/id="private-wallet-button"[^>]*disabled>Private service degraded</);
  assert.match(html,/https:\/\/ynxweb4\.com\/dapp\/download/);
  assert.match(html,/https:\/\/metamask\.io\/download\//);
  assert.match(app,/launchSearchWalletAuthorization/);
  assert.doesNotMatch(app,/location\.(?:href|assign)\s*=/);
  assert.match(launcher,/launchWebAuthorization/);
  assert.doesNotMatch(launcher,/`ynxwallet:\/\/authorize/);
});

test("release-facing browser files contain no loopback or development endpoints",async()=>{
  const files=await Promise.all(["src/public/app.js","src/public/index.html","src/public/runtime-config.js","src/public/standard-wallet.js","src/public/safe-wallet-launcher.js"].map(read));
  for(const body of files)assert.doesNotMatch(body,/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2|example\.com)/);
});

test("local and staging launch serve the bundled browser application",async()=>{
  const [packageJson,environment]=await Promise.all([read("package.json"),read("deploy/search-staging.env.example")]);
  const scripts=JSON.parse(packageJson).scripts;
  assert.match(scripts.start,/npm run build/);
  assert.match(scripts.start,/YNX_SEARCH_STATIC_DIR=dist/);
  assert.match(environment,/^YNX_SEARCH_STATIC_DIR=dist$/m);
});
