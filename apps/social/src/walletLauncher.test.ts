import assert from "node:assert/strict";
import test from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { createWalletRequest, encodeBase64URL } from "./walletAuth";
import {
  openWalletAuthorizationWithAdapter,
  type WalletLauncherAdapter,
} from "./walletLauncherCore";

const request = createWalletRequest(
  "nonce_social_launcher_contract_00001",
  encodeBase64URL(p256.getPublicKey(new Uint8Array(32).fill(0x42), true)),
  new Date("2026-08-15T00:00:00.000Z"),
);
function adapter(result: unknown): WalletLauncherAdapter & { urls: string[] } {
  const urls: string[] = [];
  return {
    platform: "android",
    urls,
    android: {
      async openCanonicalWallet(url) {
        urls.push(url);
        return result as never;
      },
    },
    async canOpenURL() {
      throw new Error("Android must use the native exact resolver");
    },
    async openURL() {
      throw new Error("Android must not use raw Linking.openURL");
    },
  };
}

test("opens only through the Android exact resolver with the shared canonical builder", async () => {
  const target = adapter({ opened: true });
  assert.deepEqual(await openWalletAuthorizationWithAdapter(request, target), { opened: true });
  assert.match(target.urls[0] ?? "", /^ynxwallet:\/\/authorize\?request=[A-Za-z0-9_-]+$/);
});

test("missing, unregistered, or invalid native handlers fail closed without raw activity errors", async () => {
  for (const result of [
    { opened: false, code: "WALLET_NOT_INSTALLED" },
    { opened: false, code: "SCHEME_NOT_REGISTERED" },
    { opened: false, code: "NO_ACTIVITY_FOUND" },
  ]) {
    const target = adapter(result);
    const actual = await openWalletAuthorizationWithAdapter(request, target);
    assert.equal(actual.opened, false);
    assert.equal(
      actual.opened ? null : actual.code,
      result.code === "WALLET_NOT_INSTALLED"
        ? "WALLET_NOT_INSTALLED"
        : "SCHEME_NOT_REGISTERED",
    );
  }
});
