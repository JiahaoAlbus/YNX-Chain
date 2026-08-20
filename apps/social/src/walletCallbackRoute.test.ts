import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BUNDLE_ID, CALLBACK } from "./walletAuth";
import { YNX_WALLET_DOWNLOAD_URL } from "./walletLauncherCore";

const manifest = readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const appConfig = readFileSync(new URL("../app.config.js", import.meta.url), "utf8");

test("Social registers the exact canonical Wallet callback, not a lookalike scheme", () => {
  assert.equal(CALLBACK, "ynx-social://com.ynx.social");
  assert.equal(BUNDLE_ID, "com.ynx.social");
  assert.match(manifest, /<data android:scheme="ynx-social" android:host="com\.ynx\.social"\/>/);
  assert.match(appConfig, /scheme: "ynxsocial"/);
  assert.match(manifest, /<data android:scheme="ynxsocial"\/>/);
});

test("Social's no-Wallet recovery directs users to the current official Wallet APK", () => {
  assert.equal(
    YNX_WALLET_DOWNLOAD_URL,
    "https://www.ynxweb4.com/downloads/wallet/sha256-66a0954f7955d800af4b205680ce879c786568cbf6af8a71307cddad31c216a0/ynx-wallet-1.0.2-testnet-preview-1f8820c5-local-test-signed.apk",
  );
});
