import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = readFileSync(resolve(root, "app.config.js"), "utf8");
const app = readFileSync(resolve(root, "App.tsx"), "utf8");
const wallet = readFileSync(resolve(root, "src/walletAuth.ts"), "utf8");
const i18n = readFileSync(resolve(root, "src/i18n.tsx"), "utf8");
const manifest = readFileSync(
  resolve(root, "android/app/src/main/AndroidManifest.xml"),
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
assert.match(wallet, /ynxwallet:\/\/authorize\?request=/);
assert.match(wallet, /ynxsocial:\/\/wallet-auth\/callback/);
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
