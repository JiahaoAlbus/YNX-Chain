import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DAPP_COMPATIBILITY_PROFILES, assertRealWalletConnectAdapter, executeDappCompatibilityOperation } from "../frontend/src/dapp/standard-wallet-dapp-profiles.ts";

const account = "0x1111111111111111111111111111111111111111";

test("compatibility lab names a first-party profile and three external standard DApp profiles without treating fixtures as runtime", () => {
  assert.equal(DAPP_COMPATIBILITY_PROFILES.filter((profile) => profile.audience === "First-party").length, 1);
  assert.ok(DAPP_COMPATIBILITY_PROFILES.filter((profile) => profile.audience === "External standard DApp").length >= 4);
  assert.ok(DAPP_COMPATIBILITY_PROFILES.some((profile) => profile.operation === "personal_sign"));
  assert.ok(DAPP_COMPATIBILITY_PROFILES.some((profile) => profile.operation === "eip712"));
  assert.ok(DAPP_COMPATIBILITY_PROFILES.some((profile) => profile.operation === "send_transaction"));
  assert.ok(DAPP_COMPATIBILITY_PROFILES.some((profile) => profile.operation === "walletconnect"));
  assert.throws(() => assertRealWalletConnectAdapter({}), /fixture cannot be used as runtime evidence/);
});

test("each real-provider profile emits only its standard EIP-1193 request and validates a testnet transaction locally first", async () => {
  const calls = [];
  const provider = { async request(input) { calls.push(input); return `response:${input.method}`; } };
  await assert.doesNotReject(() => executeDappCompatibilityOperation(provider, "ynx-first-party", account));
  await executeDappCompatibilityOperation(provider, "uniswap-interface-reference", account);
  await executeDappCompatibilityOperation(provider, "opensea-reference", account);
  await executeDappCompatibilityOperation(provider, "safe-reference", account, { to: account, value: "0x0", data: "0x" });
  assert.deepEqual(calls.map((call) => call.method), ["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"]);
  assert.equal(calls[1].params[0], account);
  assert.equal(JSON.parse(calls[1].params[1]).domain.chainId, 6423);
  assert.equal(calls[2].params[0].from, account);
  await assert.rejects(() => executeDappCompatibilityOperation(provider, "safe-reference", account, { to: "not-an-address", value: "1" }), /Provide a 20-byte recipient/);
  await assert.rejects(() => executeDappCompatibilityOperation(provider, "walletconnect-v2-bridge", account), /does not simulate sessions/);
});

test("the visible lab and chooser keep YNX Wallet and MetaMask identities separate without custom navigation", async () => {
  const [lab, profiles, identityMark, panel] = await Promise.all([
    readFile(new URL("../frontend/src/dapp/StandardWalletDappCompatibilityLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/dapp/standard-wallet-dapp-profiles.ts", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/wallet/WalletIdentityMark.tsx", import.meta.url), "utf8"),
    readFile(new URL("../frontend/src/chain/ChainPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(lab, /YNX Wallet and MetaMask are independently discovered/);
  assert.match(lab, /MetaMask marker is an original neutral identifier/);
  assert.match(lab, /WalletIdentityMark/);
  assert.match(panel, /WalletIdentityMark kind=\{choice\.kind\}/);
  assert.match(panel, /WalletIdentityMark kind=\{webWalletConnectionDetails\.providerKind\}/);
  assert.match(panel, /const webWalletConnectionDetails = webWalletConnection\?\.chooserOpen/);
  assert.match(identityMark, /YNX Wallet identity mark/);
  assert.match(identityMark, /MetaMask identity mark/);
  assert.match(identityMark, /not a copied third-party logo/);
  assert.match(lab, /Standard Wallet identity reference/);
  assert.match(lab, /com\.ynx\.wallet/);
  assert.match(lab, /isMetaMask=true/);
  assert.match(lab, /No fixture, QR placeholder, or simulated session/);
  assert.match(lab, /accountsChanged, chainChanged, and disconnect/);
  assert.match(profiles, /personal_sign/);
  assert.match(profiles, /eth_signTypedData_v4/);
  assert.match(profiles, /eth_sendTransaction/);
  assert.doesNotMatch(lab + profiles + panel, /ynxwallet:\/\/authorize|window\.open\s*\(|<iframe|target="_blank"/);
});
