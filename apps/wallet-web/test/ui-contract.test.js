import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {loadPreferences, savePreferences} from "../src/preferences.js";
import {subscribeProviderLifecycle} from "../src/provider.js";
import {catalog,LOCALES} from "../src/i18n.js";

test("Wallet offers its YNX download and has no other-provider login route", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /id="download" href="\$\{YNX_DOWNLOAD_URL\}"/);
  assert.doesNotMatch(source, /id="download"[^>]*>Android/);
  assert.match(source, /id="android-download" href="\$\{WALLET_DOWNLOAD_MATRIX.android.url\}"/);
  assert.doesNotMatch(source, /metamask|MetaMask/);
  assert.match(source, /companionLifecycle\.begin\(\)/);
  assert.match(source, /mobileWalletPresentation\(availability, mobileBrowser, CORE_WALLET_AUTH_BINDING,companionLifecycle\.publicAuthAvailable\?companionLifecycle\.callback:null\)/);
  assert.match(source, /companionLifecycle\.handleReturn\(location\.href\)/);
  assert.doesNotMatch(source, /pageshow|visibilitychange/);
  assert.match(source, /walletDiscoveryPresentation\(availability\)/);
  assert.match(source, /function localizedError\(error\)/);
  assert.doesNotMatch(source, /error\?\.message \|\| "Request failed closed\."/);
  assert.doesNotMatch(source, /error\?\.message \|\| "Wallet detection failed closed\."/);
  assert.match(source, /disabled aria-disabled="true" data-permanent-disabled="true"/);
  assert.match(source, /aria-describedby="download-meta"/);
  assert.match(source, /productionSigned=false/);
  assert.match(source, /button\.disabled = button\.dataset\.permanentDisabled === "true"/);
  assert.match(source, /document\.querySelector\("#platforms"\)\.classList\.toggle\("hidden", !presentation\.showYNXDownload\)/);
  assert.match(source, /if\(!preserveConnection&&!state\.account\)\{state\.provider=null;state\.wallet=null;state\.chainId=null\}/);
  assert.match(source, /if\(!state\.account\)forgetSession\(\);throw error/);
  assert.match(source, /const discoveryError=\(error\)=>localizedError\(error\)/);
  assert.doesNotMatch(source, /state\.provider\s*=\s*\{.*request/s);
});

test("390px RTL blue-white and large-text preview contracts remain buildable", async () => {
  const [app,styles,accessibility,index] = await Promise.all([
    readFile(new URL("../public/app.js",import.meta.url),"utf8"),
    readFile(new URL("../public/styles.css",import.meta.url),"utf8"),
    readFile(new URL("../public/accessibility.css",import.meta.url),"utf8"),
    readFile(new URL("../public/index.html",import.meta.url),"utf8"),
  ]);
  assert.match(index,/<html lang="en"/);
  assert.match(index,/<html lang="en" class="notranslate" translate="no">/);
  assert.match(index,/<meta name="google" content="notranslate">/);
  assert.match(app,/document\.documentElement\.dir = isRTL\(state\.locale\)/);
  assert.match(app,/aria-label="\$\{text\("walletConnection"\)\}"/);
  assert.match(app,/aria-label="\$\{text\("walletActions"\)\}"/);
  assert.doesNotMatch(app,/aria-label="Wallet (?:connection|actions)"/);
  assert.match(app,/requestedText === "large"/);
  assert.match(app,/loadPreferences\(localStorage\)/);
  assert.match(app,/acceptPreferenceUpdate\(state\.preferences,event\.newValue\)/);
  assert.match(app,/loadedPreferences\.status==="rejected"/);
  assert.match(styles,/@media\(max-width:520px\)/);
  assert.match(styles,/\.platform-grid\{display:grid/);
  assert.match(accessibility,/font-size: 125%/);
  assert.match(accessibility,/\.wallets a/);
  assert.match(accessibility,/min-height: 44px/);
  assert.doesNotMatch(app, /id="theme"|darkTheme|requestedTheme|prefers-color-scheme/);
  assert.doesNotMatch(styles, /color-scheme:dark|prefers-color-scheme|data-theme="dark"/);
  assert.match(accessibility, /forced-colors: active/);
});

test("legacy dark preference retains locale and custody records while the actual renderer stays light", async () => {
  const values = new Map([["unrelated-vault", "ciphertext-fixture"], ["unrelated-session", "session-fixture"]]);
  const storage = {getItem:key=>values.get(key)??null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key)};
  savePreferences(storage, {revision:0,locale:"en",theme:"system"}, {locale:"ar",theme:"dark"});
  const before = JSON.stringify([...values]), loaded = loadPreferences(storage);
  assert.equal(loaded.record.locale, "ar"); assert.equal(loaded.record.theme, "dark");
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const render = source.slice(source.indexOf("function render() {"), source.indexOf("\nfunction formError("));
  const document = {documentElement:{dataset:{}}}, app = {innerHTML:""};
  const environment = {document,app,state:{locale:loaded.record.locale,theme:loaded.record.theme,epoch:0,connectState:{chooserOpen:true},form:{},providers:{}},
    requestedText:"large",isRTL:locale=>locale==="ar",text:key=>key,options:()=>"",escape:value=>String(value??""),unavailablePlatforms:()=>"",statusContent:()=>"",
    YNX_DOWNLOAD_URL:"https://wallet.example",WALLET_DOWNLOAD_MATRIX:{android:{url:"https://wallet.example/qa.apk",bytes:1}},
    bind(){},applyActionGates(){},presentAvailability(){}};
  runInNewContext(render+"\nrender();",environment);
  assert.equal(document.documentElement.lang,"ar");assert.equal(document.documentElement.dir,"rtl");
  assert.equal(document.documentElement.dataset.theme,"light");assert.equal(document.documentElement.dataset.text,"large");
  assert.doesNotMatch(app.innerHTML,/id="theme"/);assert.equal(JSON.stringify([...values]),before);
});

test("all auxiliary extension pages use white canvases and preserve keyboard and forced-colors access",async()=>{
  for(const file of ["vault.css","approval.css","signer.css"]){
    const css=await readFile(new URL(`../extension/${file}`,import.meta.url),"utf8");
    assert.doesNotMatch(css,/prefers-color-scheme|color-scheme:light dark/);
    if(file!=="signer.css"){
      assert.match(css,/:root\{color-scheme:light;[^}]*background:#fff/);
      assert.match(css,/#002fa7/);assert.match(css,/focus-visible/);assert.match(css,/forced-colors:active/);
    }else assert.match(css,/@import "\.\/approval.css"/);
  }
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

test("provider approval stays in-place and success restores exact chooser focus lifecycle",async()=>{
  const source=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(source,/state\.connectState=result\.connectState;state\.account=result\.session\.account;state\.chainId=result\.session\.chainId/);
  assert.match(source,/queueMicrotask\(\(\)=>document\.querySelector\("#wallet-connect-trigger"\)\?\.focus\(\)\)/);
  assert.match(source,/data-pending-intent="\$\{state\.connectState\.pendingIntent\?"true":"false"\}"/);
  assert.match(source,/resolveRememberedWallet\(availability\)/);
  assert.match(source,/restoreTestnetSession\(provider,localStorage,\{assertCurrent\}\)/);
  assert.match(source,/accountsChanged\(accounts\)/);
  assert.match(source,/chainChanged\(chainId\)/);
  assert.match(source,/id="disconnect"/);
  assert.match(source,/id="switch-account"/);
  assert.match(source,/const connectionDetails = Boolean\(state\.account\) && state\.connectState\.chooserOpen && state\.connectState\.chooserMode === "connection-details"/);
  assert.match(source,/const providerChooserVisible = state\.connectState\.chooserOpen && !connectionDetails/);
  assert.match(source,/id="connection-controls" class="actions \$\{connectionDetails\?"":"hidden"\}"/);
  assert.doesNotMatch(source,/window\.open\s*\(/);
  assert.doesNotMatch(source,/(?:window\.)?location(?:\.href)?\s*=\s*[`'"]ynxwallet:\/\//);
});

test("active locale catalogs never suggest another-wallet login",()=>{
  for(const[locale]of LOCALES){const copy=catalog(locale);assert.doesNotMatch(JSON.stringify(copy),/metamask/iu);assert.ok(copy.copyAddress);assert.ok(copy.evmCompatibility);assert.match(copy.noWalletHelp,/YNX Wallet/);}
});

test("actual renderer lifecycle discards callbacks queued by a replaced provider",async()=>{
  const source=await readFile(new URL("../public/app.js",import.meta.url),"utf8"),code=source.slice(source.indexOf("function bindProviderLifecycle(provider)"),source.indexOf("\nfunction selectProvider"));
  const queued={},provider={isYNXWallet:true,providerInfo:{rdns:"com.ynx.wallet"},request(){},on:(event,listener)=>{queued[event]=listener},removeListener(){}},state={wallet:"ynx",provider,providerRevision:1,account:"old"};let calls=0;
  runInNewContext(code+"\nbindProviderLifecycle(provider)",{provider,state,subscribeProviderLifecycle,clearConnectedSession:()=>{calls++},reduceStandardWalletConnectState:()=>{calls++},rememberSession:()=>{calls++},render:()=>{calls++},STANDARD_WALLET_CONNECT_STATUS:{CONNECTED:"connected"}});
  state.providerRevision++;state.provider={};state.account="new-ynx-account";queued.accountsChanged(["0x"+"1".repeat(40)]);queued.chainChanged("0x1");queued.disconnect();
  assert.equal(calls,0);assert.equal(state.account,"new-ynx-account");
});
