import assert from "node:assert/strict";
import test from "node:test";
import { SOCIAL_WALLET_CHOICES, socialWalletChoice } from "./walletChoices";

test("Social chooser keeps YNX Wallet and MetaMask identities distinct", () => {
  assert.deepEqual(
    SOCIAL_WALLET_CHOICES.map(({ id, name, action }) => ({ id, name, action })),
    [
      { id: "ynx-wallet", name: "YNX Wallet", action: "sign-in" },
      { id: "metamask", name: "MetaMask", action: "open-mobile" },
    ],
  );
  assert.equal(socialWalletChoice("ynx-wallet").chainQuantity, "0x1917");
  assert.equal(socialWalletChoice("metamask").chainId, 6423);
});

test("Social chooser does not expose a non-6423 network", () => {
  for (const choice of SOCIAL_WALLET_CHOICES) {
    assert.equal(choice.chainId, 6423);
    assert.equal(choice.chainQuantity, "0x1917");
  }
});
