import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = readFileSync(resolve(root, "app.config.js"), "utf8");
const app = readFileSync(resolve(root, "App.tsx"), "utf8");
const wallet = readFileSync(resolve(root, "src/walletAuth.ts"), "utf8");
const launcher = readFileSync(resolve(root, "src/walletLauncher.ts"), "utf8");
const launcherCore = readFileSync(
  resolve(root, "src/walletLauncherCore.ts"),
  "utf8",
);
const i18n = readFileSync(resolve(root, "src/i18n.tsx"), "utf8");
const manifest = readFileSync(
  resolve(root, "android/app/src/main/AndroidManifest.xml"),
  "utf8",
);
const androidLauncher = readFileSync(
  resolve(root, "android/app/src/main/java/com/ynx/social/WalletLauncherModule.kt"),
  "utf8",
);
assert.match(config, /bundleIdentifier:\s*"com\.ynx\.social"/);
assert.match(config, /package:\s*"com\.ynx\.social"/);
assert.match(config, /scheme:\s*"ynxsocial"/);
assert.match(manifest, /ynxsocial/);
for (const forbidden of [
  'label="Wallet"',
  'label="Pay"',
  'label="Exchange"',
  'label="Shop"',
  'label="Network"',
])
  assert.equal(
    app.includes(forbidden),
    false,
    `forbidden navigation ${forbidden}`,
  );
assert.match(app, /Sign in with YNX Wallet/);
assert.match(app, /Wallet addresses are never accepted/);
assert.match(
  app,
  /No recovery key|never creates, imports, or receives your recovery key/i,
);
assert.match(wallet, /encodeRequestDeepLink\(request\)/);
assert.doesNotMatch(wallet, /`ynxwallet:\/\/authorize\?request=/);
assert.match(launcher, /YNXWalletLauncher/);
assert.match(launcherCore, /WALLET_NOT_INSTALLED/);
assert.match(app, /Download YNX Wallet/);
assert.match(app, /Use MetaMask Mobile/);
for (const required of [
  "resolveActivity",
  "queryIntentActivities",
  "com.ynxweb4.wallet",
  "com.ynxweb4.wallet.MainActivity",
  "WALLET_NOT_INSTALLED",
  "SCHEME_NOT_REGISTERED",
  "component = ComponentName",
])
  assert.match(androidLauncher, new RegExp(required));
assert.match(manifest, /android:scheme="ynxwallet" android:host="authorize"/);
assert.match(wallet, /ynx-social:\/\/com\.ynx\.social/);
assert.doesNotMatch(wallet, /searchParams\.get\("assertion"\)/);
assert.match(app, /CameraView/);
assert.match(manifest, /android\.permission\.CAMERA/);
for (const locale of [
  "en",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt",
  "ru",
  "ar",
  "id",
])
  assert.match(i18n, new RegExp(`"${locale}"`));
console.log(
  "YNX Social package smoke passed: canonical Wallet envelope, identity, camera QR, 12 locales, recovery-key, discovery, and navigation boundaries.",
);
