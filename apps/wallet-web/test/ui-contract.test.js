import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("fallback contract always offers YNX download and MetaMask when YNX is absent", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /id="download" href="\$\{YNX_DOWNLOAD_URL\}"/);
  assert.match(source, /id="metamask" href="\$\{METAMASK_DOWNLOAD_URL\}"/);
  assert.match(source, /if \(state\.providers\?\.metamask\) \{ event\.preventDefault\(\); return connect\("metamask"\); \}/);
  assert.match(source, /companionLifecycle\.begin\(\)/);
  assert.doesNotMatch(source, /openCanonicalYNXWalletRoute|location\.assign|ynxwallet:/);
  assert.match(source, /mobileBrowser \? false : !presentation\.showMetaMaskChoice/);
  assert.match(source, /mobileWalletPresentation\(availability, mobileBrowser, CORE_WALLET_AUTH_BINDING,companionLifecycle\.publicAuthAvailable\?companionLifecycle\.callback:null\)/);
  assert.match(source, /companionLifecycle\.handleReturn\(location\.href\)/);
  assert.doesNotMatch(source, /pageshow|visibilitychange/);
  assert.match(source, /walletDiscoveryPresentation\(availability\)/);
  assert.match(source, /function localizedError\(error\)/);
  assert.match(source, /function statusView\(status = state\.status\)/);
  assert.match(source, /status\.type === "error"/);
  assert.match(source, /state\.status=Object\.freeze\(status\)/);
  assert.doesNotMatch(source, /setStatus\(localizedError\(error\), "error"\)/);
  assert.doesNotMatch(source, /error\?\.message \|\| "Request failed closed\."/);
  assert.doesNotMatch(source, /error\?\.message \|\| "Wallet detection failed closed\."/);
  assert.match(source, /disabled aria-disabled="true" data-permanent-disabled="true"/);
  assert.match(source, /aria-describedby="download-meta"/);
  assert.match(source, /productionSigned=false/);
  assert.match(source, /button\.disabled = button\.dataset\.permanentDisabled === "true"/);
  assert.match(source, /document\.querySelector\("#platforms"\)\.classList\.toggle\("hidden", !presentation\.showYNXDownload\)/);
  assert.match(source, /state\.providers = Object\.freeze\(\{ynx:false,metamask:false\}\); state\.provider = null; state\.wallet = null; state\.account = null; state\.chainId = null; state\.rpcVerified = false; applyActionGates\(\); presentAvailability\(state\.providers\)/);
  assert.match(source, /catch \(error\) \{ forgetSession\(\); throw error; \}/);
  assert.match(source, /const discoveryError=\(error\)=>localizedError\(error\)/);
  assert.doesNotMatch(source, /state\.provider\s*=\s*\{.*request/s);
  assert.match(source,/navigator\.serviceWorker\.register\("\.\/sw\.js\?schema=7", \{type:"module",updateViaCache:"none"\}\)/);
  assert.match(source,/YNX_PWA_SHELL_UPGRADED/);
  const recovery=await readFile(new URL("../public/pwa-upgrade.js",import.meta.url),"utf8");
  assert.match(recovery,/registration\?\.unregister\(\)/);
  assert.match(recovery,/name\.startsWith\(cachePrefix\)/);
  assert.match(recovery,/localStorage\.removeItem\("ynx\.wallet\.web\.session\.v1"\)/);
});

test("390px RTL dark and large-text preview contracts remain buildable", async () => {
  const [app,styles,accessibility,index] = await Promise.all([
    readFile(new URL("../public/app.js",import.meta.url),"utf8"),
    readFile(new URL("../public/styles.css",import.meta.url),"utf8"),
    readFile(new URL("../public/accessibility.css",import.meta.url),"utf8"),
    readFile(new URL("../public/index.html",import.meta.url),"utf8"),
  ]);
  assert.match(index,/<html lang="en" translate="no" class="notranslate">/);
  assert.match(index,/<meta name="google" content="notranslate">/);
  assert.match(index,/<main id="app" translate="no" class="notranslate">/);
  assert.match(app,/document\.documentElement\.dir = isRTL\(state\.locale\)/);
  assert.match(app,/aria-label="\$\{text\("walletConnection"\)\}"/);
  assert.match(app,/aria-label="\$\{text\("walletActions"\)\}"/);
  assert.doesNotMatch(app,/aria-label="Wallet (?:connection|actions)"/);
  assert.match(app,/requestedText === "large"/);
  assert.match(app,/loadPreferences\(localStorage\)/);
  assert.match(app,/acceptPreferenceUpdate\(state\.preferences,event\.newValue\)/);
  assert.match(app,/preferencesRejected/);
  assert.match(styles,/@media\(max-width:520px\)/);
  assert.match(styles,/\.platform-grid\{display:grid/);
  assert.match(accessibility,/font-size: 125%/);
  assert.match(accessibility,/\.wallets a/);
  assert.match(accessibility,/min-height: 44px/);
});

test("PWA manifest declares exact standalone identity and real-logo icon sizes", async () => {
  const manifest=JSON.parse(await readFile(new URL("../public/manifest.webmanifest",import.meta.url),"utf8"));
  assert.deepEqual({id:manifest.id,start_url:manifest.start_url,scope:manifest.scope,display:manifest.display,lang:manifest.lang,dir:manifest.dir},{id:"/wallet/companion",start_url:"./",scope:"./",display:"standalone",lang:"en",dir:"auto"});
  assert.deepEqual(manifest.icons,[
    {src:"./ynx-icon-192.png",sizes:"192x192",type:"image/png",purpose:"any"},
    {src:"./ynx-icon-512.png",sizes:"512x512",type:"image/png",purpose:"any"},
    {src:"./ynx-icon-maskable-512.png",sizes:"512x512",type:"image/png",purpose:"maskable"},
  ]);
});
