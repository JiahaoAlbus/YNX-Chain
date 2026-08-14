export const extensionVersion = "0.1.0";
export const extensionHomepage = "https://www.ynxweb4.com/";

const sharedManifest = {
  manifest_version: 3,
  name: "YNX Wallet Testnet Companion",
  version: extensionVersion,
  description: "Run fail-closed YNX Testnet wallet actions against the active DApp tab.",
  homepage_url: extensionHomepage,
  permissions: ["activeTab", "scripting", "storage"],
  host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
  content_scripts: [{
    matches: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
    js: ["content-script.js"],
    run_at: "document_start",
    all_frames: false,
  }],
  web_accessible_resources: [{
    resources: ["page-provider.js"],
    matches: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
  }],
  action: {default_popup: "index.html", default_title: "YNX Wallet"},
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
