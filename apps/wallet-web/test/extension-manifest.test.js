import assert from "node:assert/strict";
import test from "node:test";
import {chromiumManifest, extensionHomepage, extensionVersion, firefoxManifest} from "../src/extension-manifest.js";

test("extension packages expose truthful install metadata without hosted-update claims", () => {
  for (const manifest of [chromiumManifest, firefoxManifest]) {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, extensionVersion);
    assert.equal(manifest.homepage_url, extensionHomepage);
    assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
    assert.equal(manifest.permissions.includes("alarms"),false);
    assert.equal(manifest.action.default_popup, "index.html");
    assert.deepEqual(manifest.commands._execute_action.suggested_key,{default:"Ctrl+Shift+Y",mac:"MacCtrl+Shift+Y"});
    assert.equal(manifest.commands._execute_action.description,"Open YNX Wallet for the active DApp");
    assert.equal("content_scripts" in manifest,false);
    assert.equal("web_accessible_resources" in manifest,false);
    assert.equal("optional_host_permissions" in manifest,false);
    assert.deepEqual(manifest.host_permissions,["https://rpc.ynxweb4.com/*"]);
    assert.equal(manifest.content_security_policy.extension_pages,"script-src 'self'; object-src 'self'; connect-src https://rpc.ynxweb4.com");
    assert.equal(manifest.host_permissions.includes("http://*/*"),false);
    assert.equal(manifest.host_permissions.some((pattern)=>pattern.startsWith("file:")),false);
    assert.equal("update_url" in manifest, false);
  }
});

test("DApp injection is bound to an explicit activeTab user gesture",async()=>{
  const worker=await import("node:fs/promises").then(({readFile})=>readFile(new URL("../extension/service-worker.js",import.meta.url),"utf8"));
  assert.match(worker,/tabs\.query\(\{active:true,currentWindow:true\}\)/);
  assert.match(worker,/activeTabInjectionPlans\(context\.tabId\)/);
  assert.match(worker,/code:"ACTIVE_TAB_REQUIRED"/);
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
