import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  WALLET_AUTHORIZE_REQUEST_PARAMETER,
  WALLET_AUTHORIZE_ROUTE,
  WALLET_CALLBACK_RESPONSE_PARAMETER,
} from "../src/index.js";

const contract = JSON.parse(await readFile(new URL("../integration/canonical-wallet-authorize-v1.json", import.meta.url), "utf8"));

test("frozen canonical authorize contract matches exported route constants", () => {
  assert.equal(contract.contractId, "YNX-CANONICAL-WALLET-AUTHORIZE-V1");
  assert.equal(contract.authorizeTransport.routeBase, WALLET_AUTHORIZE_ROUTE);
  assert.equal(contract.authorizeTransport.soleQueryParameter, WALLET_AUTHORIZE_REQUEST_PARAMETER);
  assert.equal(contract.callbackTransport.soleQueryParameter, WALLET_CALLBACK_RESPONSE_PARAMETER);
  assert.equal(contract.authorizeTransport.bareRouteAllowed, false);
  assert.equal(contract.authorizeTransport.emptyRequestAllowed, false);
});

test("contract preserves standard Wallet choices and all direct runtime gates remain false", () => {
  assert.deepEqual(contract.independentConnections.standardWallet, ["EIP-1193", "EIP-6963", "WalletConnect", "SIWE"]);
  assert.equal(contract.independentConnections.productSessionFailureMayDisableStandardWallet, false);
  for (const gate of [
    "sdkConsumed",
    "androidConsumed",
    "iosConsumed",
    "desktopConsumed",
    "walletVisibleReviewVerified",
    "approveCallbackDeviceVerified",
    "rejectCallbackDeviceVerified",
    "coldStartRecoveryDeviceVerified",
    "browserRoundTripVerified",
    "deployedPublic",
    "integratedCentral",
    "productionSigned",
    "storeReleased",
  ]) assert.equal(contract.truth[gate], false, `${gate} must remain false`);
  assert.equal(contract.truth.productMigrations, "0/12");
});
