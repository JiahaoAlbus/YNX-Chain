import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSocialWalletChain,
  isSocialEvmChain,
  SOCIAL_EVM_CHAIN_ID,
  SOCIAL_EVM_CHAIN_QUANTITY,
  SOCIAL_NATIVE_CHAIN_ID,
} from "./walletNetwork";

test("Social wallet network is canonical YNX 6423", () => {
  assert.equal(SOCIAL_NATIVE_CHAIN_ID, "ynx_6423-1");
  assert.equal(SOCIAL_EVM_CHAIN_ID, 6423);
  assert.equal(SOCIAL_EVM_CHAIN_QUANTITY, "0x1917");
  assert.doesNotThrow(() => assertSocialWalletChain("ynx_6423-1"));
  assert.equal(isSocialEvmChain("0x1917"), true);
});

test("Social wallet rejects retired 9102 and alternate chain quantities", () => {
  assert.throws(() => assertSocialWalletChain("ynx_9102-1"), /6423/);
  assert.throws(() => assertSocialWalletChain("0x238e"), /6423/);
  assert.throws(() => assertSocialWalletChain(9102), /6423/);
  assert.equal(isSocialEvmChain("0x238e"), false);
  assert.equal(isSocialEvmChain(9102), false);
});
