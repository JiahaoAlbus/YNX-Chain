export const extensionVersion = "0.1.0";
export const extensionHomepage = "https://www.ynxweb4.com/";

const sharedManifest = {
  manifest_version: 3,
  name: "YNX Wallet",
  version: extensionVersion,
  description: "Independent YNX Testnet wallet provider for approved DApp connections and transactions.",
  homepage_url: extensionHomepage,
  permissions: ["activeTab", "scripting", "storage"],
  content_security_policy: {extension_pages: "script-src 'self'; object-src 'self'; connect-src https://evm.ynxweb4.com"},
  host_permissions: ["https://*/*"],
  content_scripts: [
    {matches:["https://*/*"],js:["content-script.js"],run_at:"document_start",all_frames:false,match_about_blank:false},
    {matches:["https://*/*"],js:["page-provider.js"],run_at:"document_start",all_frames:false,match_about_blank:false,world:"MAIN"},
  ],
  action: {default_popup: "index.html", default_title: "YNX Wallet"},
  options_ui: {page: "vault.html", open_in_tab: true},
  commands: {"_execute_action": {suggested_key: {default: "Ctrl+Shift+Y", mac: "MacCtrl+Shift+Y"}, description: "Open YNX Wallet for the active DApp"}},
  icons: {"128": "ynx-logo.png"},
};

export const chromiumManifest = {
  ...sharedManifest,
  minimum_chrome_version: "120",
  background: {service_worker: "service-worker.js", type: "module"},
};

export const firefoxManifest = {
  ...sharedManifest,
  background: {scripts: ["service-worker.js"], type: "module"},
  browser_specific_settings: {
    gecko: {id: "wallet-testnet@ynxweb4.com", strict_min_version: "128.0"},
  },
};
