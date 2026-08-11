import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

const root=new URL("../",import.meta.url);

test("Bridge Web exposes useful read-only evidence before login and exact Wallet actions after login",async()=>{
  const[html,app,wallet]=await Promise.all([readFile(new URL("index.html",root),"utf8"),readFile(new URL("app.js",root),"utf8"),readFile(new URL("wallet-auth-entry.js",root),"utf8")]);
  for(const id of["connect-wallet","install-wallet","wallet-status","source-chain","destination-chain","amount","sender","recipient","request-quote","review-quote","submit-transfer","route-list","provider-list"])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/id="submit-transfer"[^>]*disabled/);
  assert.match(html,/id="submission">Disabled/);
  assert.match(app,/external submission remains disabled/i);
  assert.match(app,/bridge:quote:read/);assert.match(app,/bridge:review:create/);
  assert.match(app,/X-YNX-Product-Session-Proof/);assert.doesNotMatch(app,/X-YNX-App-Session/);
  assert.match(wallet,/createProductDeviceIdentity/);assert.match(wallet,/verifyAuthorization/);assert.match(wallet,/createProductSessionProof/);assert.match(wallet,/indexedDB\.open/);
  assert.match(wallet,/ynx-bridge-web-v1/);assert.match(wallet,/web\.ynx\.bridge/);assert.match(wallet,/https:\/\/ynxweb4\.com\/bridge\/wallet-auth\/callback/);
});

test("Bridge UI never invents execution or provider availability",async()=>{
  const app=await readFile(new URL("app.js",root),"utf8");
  assert.match(app,/routes\.routes\?\.some\(route=>route\.executable\)/);
  assert.match(app,/currentQuote\.executable/);
  assert.doesNotMatch(app,/liveBridge\s*=\s*true/);
  assert.doesNotMatch(app,/executable\s*=\s*true/);
  assert.doesNotMatch(app,/submit-transfer[^\n]*addEventListener/);
});
