import assert from "node:assert/strict";
import test from "node:test";
import {chromiumManifest, extensionHomepage, extensionVersion, firefoxManifest} from "../src/extension-manifest.js";

test("extension packages expose truthful install metadata without hosted-update claims", () => {
  for (const manifest of [chromiumManifest, firefoxManifest]) {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, extensionVersion);
    assert.equal(manifest.homepage_url, extensionHomepage);
    assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
    assert.equal(manifest.action.default_popup, "index.html");
    assert.deepEqual(manifest.content_scripts[0].js,["content-script.js"]);
    assert.equal(manifest.content_scripts[0].run_at,"document_start");
    assert.deepEqual(manifest.web_accessible_resources[0].resources,["page-provider.js"]);
    assert.deepEqual(manifest.host_permissions,["https://*/*","http://localhost/*","http://127.0.0.1/*"]);
    assert.equal(manifest.content_security_policy.extension_pages,"script-src 'self'; object-src 'self'; connect-src https://evm.ynxweb4.com");
    assert.equal(manifest.host_permissions.includes("http://*/*"),false);
    assert.equal(manifest.host_permissions.some((pattern)=>pattern.startsWith("file:")),false);
    assert.equal("update_url" in manifest, false);
  }
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
