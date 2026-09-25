import test from "node:test";
import assert from "node:assert/strict";
import { StandardWalletConnection } from "../src/standard-wallet-connection.js";

const config = provider => ({ provider, origin: "https://finance.ynxweb4.com", metadata: { name: "YNX Finance", url: "https://finance.ynxweb4.com" } });
const unavailable = () => Object.assign(new Error("untrusted provider detail"), { code: "PROVIDER_ACCOUNT_UNAVAILABLE", data: { secret: "must not propagate" } });

test("only the YNX extension account request carries a fixed, non-secret vault recovery hint", async () => {
  const provider = { __ynxCompanion: true, isYNXWallet: true, isMetaMask: false, providerInfo: { rdns: "com.ynx.wallet" }, request: async () => { throw unavailable(); } };
  const wallet = new StandardWalletConnection(config(provider));
  await assert.rejects(wallet.connect(), error => {
    assert.equal(error.code, 4900);
    assert.deepEqual(error.data, { walletCode: "PROVIDER_ACCOUNT_UNAVAILABLE", stage: "eth_requestAccounts", recovery: "open-wallet-vault" });
    assert.equal(error.message.includes("untrusted provider detail"), false);
    assert.equal(JSON.stringify(error).includes("secret"), false);
    return true;
  });
  await assert.rejects(wallet.request({ method: "eth_chainId" }), error => error.code === 4900 && error.data === undefined);
});

test("foreign and MetaMask providers cannot create a YNX vault recovery hint", async () => {
  for (const foreign of [{ isMetaMask: true }, { isYNXWallet: true, isMetaMask: false, providerInfo: { rdns: "com.ynx.wallet" } }]) {
    const wallet = new StandardWalletConnection(config({ ...foreign, request: async () => { throw unavailable(); } }));
    await assert.rejects(wallet.connect(), error => error.code === 4900 && error.data === undefined && error.message === "EIP-1193 provider request failed");
  }
});

test("throwing provider identity and error getters fail closed to the generic EIP-1193 error", async () => {
  const hostileProvider = { request: async () => { throw unavailable(); }, get __ynxCompanion() { throw new Error("hostile getter"); } };
  await assert.rejects(new StandardWalletConnection(config(hostileProvider)).connect(), error =>
    error.code === 4900 && error.data === undefined && error.message === "EIP-1193 provider request failed");
  const hostileErrorProvider = { __ynxCompanion: true, isYNXWallet: true, isMetaMask: false, providerInfo: { rdns: "com.ynx.wallet" }, request: async () => { throw Object.defineProperty(new Error("untrusted"), "code", { get() { throw new Error("hostile code"); } }); } };
  await assert.rejects(new StandardWalletConnection(config(hostileErrorProvider)).connect(), error =>
    error.code === 4900 && error.data === undefined && error.message === "EIP-1193 provider request failed");
});
