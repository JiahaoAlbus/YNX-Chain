import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {parseWalletDeepLink, WALLET_AUTHORIZE_ROUTE, WalletAuthError} from "@ynx-chain/wallet-auth";
import {PRODUCT_REGISTRY} from "./registry";

test("a bare authorize route is rejected before Wallet review state can be created", () => {
  assert.throws(
    () => parseWalletDeepLink(WALLET_AUTHORIZE_ROUTE, "android", {now:new Date("2026-08-21T00:00:00.000Z"),registry:PRODUCT_REGISTRY}),
    (error:unknown) => error instanceof WalletAuthError && error.code === "MISSING_AUTHORIZATION_REQUEST",
  );
});

test("Wallet receiver displays a security error and never a blank approval sheet for invalid routes", () => {
  const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.match(app, /setAuthorization\(null\);setAuthorizationError\(localizeError\(locale,caught\)\)/);
  assert.match(app, /authorizationError\?<View style=\{styles\.bannerError\}>/);
  assert.match(app, /authorization&&manifest&&selected\?<AuthorizationModal/);
  assert.match(app, /await incomingAuthorizations\.capture\(parsed\.request\);setAuthorization\(parsed\.request\)/);
});
