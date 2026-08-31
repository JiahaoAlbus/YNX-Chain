import assert from "node:assert/strict";
import test from "node:test";
import {chromiumManifest, extensionHomepage, extensionVersion, firefoxManifest} from "../src/extension-manifest.js";

test("extension packages expose truthful install metadata without hosted-update claims", () => {
  for (const manifest of [chromiumManifest, firefoxManifest]) {
    assert.equal(manifest.name,"YNX Wallet");
    assert.match(manifest.description,/Independent YNX Testnet wallet provider/);
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, extensionVersion);
    assert.equal(manifest.homepage_url, extensionHomepage);
    assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
    assert.equal(manifest.permissions.includes("alarms"),false);
    assert.equal(manifest.action.default_popup, "index.html");
    assert.deepEqual(manifest.options_ui,{page:"vault.html",open_in_tab:true});
    assert.deepEqual(manifest.commands._execute_action.suggested_key,{default:"Ctrl+Shift+Y",mac:"MacCtrl+Shift+Y"});
    assert.equal(manifest.commands._execute_action.description,"Open YNX Wallet for the active DApp");
    assert.deepEqual(manifest.content_scripts.map(({matches,run_at,all_frames,match_about_blank,world})=>({matches,run_at,all_frames,match_about_blank,world})),[
      {matches:["https://*/*"],run_at:"document_start",all_frames:false,match_about_blank:false,world:undefined},
      {matches:["https://*/*"],run_at:"document_start",all_frames:false,match_about_blank:false,world:"MAIN"},
    ]);
    assert.equal("web_accessible_resources" in manifest,false);
    assert.equal("optional_host_permissions" in manifest,false);
    assert.deepEqual(manifest.host_permissions,["https://*/*"]);
    assert.equal(manifest.content_security_policy.extension_pages,"script-src 'self'; object-src 'self'; connect-src https://evm.ynxweb4.com");
    assert.equal(manifest.host_permissions.includes("http://*/*"),false);
    assert.equal(manifest.host_permissions.some((pattern)=>pattern.startsWith("file:")),false);
    assert.equal("update_url" in manifest, false);
  }
});

test("HTTPS DApp injection is automatic with an explicit activeTab repair fallback",async()=>{
  const worker=await import("node:fs/promises").then(({readFile})=>readFile(new URL("../extension/service-worker.js",import.meta.url),"utf8"));
  assert.match(worker,/tabs\.query\(\{active:true,currentWindow:true\}\)/);
  assert.match(worker,/activeTabInjectionPlans\(context\.tabId\)/);
  assert.match(worker,/code:"ACTIVE_TAB_REQUIRED"/);
});

test("extension source never opens a top-level ynxwallet navigation",async()=>{
  const sources=await Promise.all(["../extension/page-provider.js","../extension/content-script.js","../extension/service-worker.js","../public/app.js"].map(item=>import("node:fs/promises").then(({readFile})=>readFile(new URL(item,import.meta.url),"utf8"))));
  for(const source of sources){assert.doesNotMatch(source,/window\.open\s*\(/u);assert.doesNotMatch(source,/(?:window\.)?location(?:\.href)?\s*=\s*[`'"]ynxwallet:\/\//u)}
});

test("unsigned Chromium package stays honest about identity and minimum runtime", () => {
  assert.equal(chromiumManifest.minimum_chrome_version, "120");
  assert.equal("key" in chromiumManifest, false);
  assert.equal("browser_specific_settings" in chromiumManifest, false);
});

test("Firefox package has a stable declared add-on id but remains unsigned", () => {
  assert.equal(firefoxManifest.browser_specific_settings.gecko.id, "wallet-testnet@ynxweb4.com");
  assert.equal(firefoxManifest.browser_specific_settings.gecko.strict_min_version, "128.0");
  assert.equal("key" in firefoxManifest, false);
});
