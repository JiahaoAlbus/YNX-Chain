import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Android is an installable WebView app with isolated identity and exact callback", async () => {
  const manifest = await read("../android/app/src/main/AndroidManifest.xml");
  const activity = await read("../android/app/src/main/java/com/ynxweb4/browser/MainActivity.java");
  const privateActivity = await read("../android/app/src/main/java/com/ynxweb4/browser/PrivateActivity.java");
  const locales = await read("../android/app/src/main/java/com/ynxweb4/browser/LocaleCatalog.java");
  assert.match(manifest, /com\.ynxweb4\.browser/);
  assert.match(manifest, /ynxbrowser/);
  assert.match(manifest, /allowBackup="false"/);
  assert.match(manifest, /android:process=":private"/);
  assert.match(activity, /new WebView\(this\)/);
  assert.match(activity, /AndroidKeyStore/);
  assert.match(activity, /putBoolean\("used:"/);
  assert.match(activity, /replayed response/);
  assert.match(privateActivity, /setDataDirectorySuffix\("private"\)/);
  assert.match(privateActivity, /deleteAllData/);
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"]) {
    assert.match(locales, new RegExp(`"${locale}"`));
  }
});

test("iOS is a native WKWebView project with Keychain P-256 identity and private store", async () => {
  const project = await read("../ios/YNXBrowser.xcodeproj/project.pbxproj");
  const model = await read("../ios/YNXBrowser/BrowserModel.swift");
  const web = await read("../ios/YNXBrowser/BrowserWebView.swift");
  assert.match(project, /com\.ynxweb4\.browser\.ios/);
  assert.match(web, /WKWebView/);
  assert.match(web, /nonPersistent/);
  assert.match(model, /P256\.Signing\.PrivateKey/);
  assert.match(model, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  assert.doesNotMatch(model, /String\(repeating:"A"/);
});

test("desktop apps expose mature engine, recovery, files, permissions and Wallet/update boundaries", async () => {
  const mac = await read("../native/Sources/YNXBrowserNative/main.swift");
  const macPersistence = await read("../native/Sources/YNXBrowserCore/DownloadPersistence.swift");
  const macWallet = await read("../native/Sources/YNXBrowserCore/WalletCallbackPolicy.swift");
  const windows = await read("../windows/YNXBrowser.Windows/MainWindow.xaml.cs");
  const wallet = await read("../windows/YNXBrowser.Windows/WalletRequestBuilder.cs");
  const readme = await read("../windows/README.md");

  for (const token of ["WKWebView", "isRestorable = false", "runOpenPanelWith", "WKDownloadDelegate", "requestMediaCapturePermissionFor", "Signed update boundary"]) {
    assert.ok(mac.includes(token), `macOS host omits ${token}`);
  }
  for (const token of ["clearLegacyWindowFrames()", "minimumWindowSize = NSSize(width: 920, height: 620)", "addTab.translatesAutoresizingMaskIntoConstraints = false", "privateTab.translatesAutoresizingMaskIntoConstraints = false", "YNX_BROWSER_WINDOW_EVIDENCE_FILE"]) {
    assert.ok(mac.includes(token), `macOS window usability gate omits ${token}`);
  }
  assert.match(mac, /downloadContexts\[ObjectIdentifier\(download\)\]/);
  assert.match(mac, /BrowserDownloadPersistence\.persistFinishedDownload\(context: context, defaults: defaults\)/);
  assert.match(mac, /no YNX Downloads record was written/);
  assert.match(macPersistence, /guard context\.isPrivate == false/);
  assert.match(macPersistence, /source: context\.source/);
  assert.match(macPersistence, /defaults\.set\(data, forKey: defaultsKey\)/);
  assert.doesNotMatch(mac, /DownloadRecord\(filename:"User-selected file",source:activeWebView/);
  assert.match(mac, /BrowserWalletCallbackPolicy\.persistPending/);
  assert.match(mac, /BrowserWalletCallbackPolicy\.validateAndConsume/);
  assert.match(mac, /BrowserWalletCallbackPolicy\.clearPending/);
  assert.match(mac, /SecRandomCopyBytes\(kSecRandomDefault, count, &bytes\) == errSecSuccess/);
  assert.match(mac, /Only HTTPS\/HTTP navigation and the exact Wallet callback route are accepted/);
  assert.match(mac, /Logger\(subsystem: "com\.ynxweb4\.browser\.macos", category: "security-boundary"\)/);
  assert.match(mac, /wallet_callback_rejected code=\\\(error\.code, privacy: \.public\)/);
  const auditMessages = [...mac.matchAll(/auditLogger\.(?:notice|error)\("([^"]*)"/g)].map(match => match[1]);
  assert.ok(auditMessages.length >= 6);
  for (const message of auditMessages) assert.doesNotMatch(message, /(?:nonce|url|response|filename|source)=/i);
  assert.doesNotMatch(mac, /defaults\.set\(nonce, forKey:\s*"walletPendingNonce"\)/);
  assert.doesNotMatch(mac, /queryItems\?\.first\(where:\s*\{\s*\$0\.name == "url"\s*\}\)/);
  for (const token of ["pendingDefaultsKey", "signature(for:", "values.count == 1", "duplicateQueryField", "strictTopLevelObjectFields", "Set(fields) == responseFields", "Set(fields) == pendingFields", "pendingTampered", "requestExpired", "no Product Session was created locally"]) {
    assert.ok(macWallet.includes(token), `macOS Wallet callback policy omits ${token}`);
  }

  for (const token of ["WebView2", "PermissionRequested", "DownloadStarting", "ClearBrowsingDataAsync", "ProcessFailed", "OnKeyDown", "WalletRequestBuilder.CreateAuthorizationUri", "WalletRequestBuilder.ValidateCallback"]) {
    assert.ok(windows.includes(token), `Windows host omits ${token}`);
  }
  for (const token of ["ynx-browser-windows", "p256-sha256", "CngAlgorithm.ECDsaP256", "CngExportPolicies.None", "SignData", "VerifyData", "UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow", "no Product Session was created locally"]) {
    assert.ok(wallet.includes(token), `Windows Wallet builder omits ${token}`);
  }
  assert.match(readme, /does not claim a built or signed Windows package/);
});
