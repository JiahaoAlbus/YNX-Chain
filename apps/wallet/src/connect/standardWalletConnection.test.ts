import assert from "node:assert/strict";
import test from "node:test";
import { Eip1193Error, StandardWalletConnection, YNX_EVM_CHAIN_HEX } from "./standardWalletConnection";

const account = "0x1111111111111111111111111111111111111111";
const signature = `0x${"a".repeat(130)}`;
const hash = `0x${"b".repeat(64)}`;

function wallet() {
  return new StandardWalletConnection({
    async requestAccount() { return account; },
    async signPersonalMessage() { return signature; },
    async signTypedDataV4() { return signature; },
    async sendTransaction() { return hash; },
  });
}

test("standard EIP-1193 connection remains usable when Product Session is degraded", async () => {
  const provider = wallet();
  assert.deepEqual(await provider.request({ method: "eth_accounts" }), []);
  assert.deepEqual(await provider.request({ method: "eth_requestAccounts" }), [account]);
  provider.markPrivateServiceDegraded();
  assert.equal(provider.status(), "PRIVATE_SERVICE_DEGRADED");
  assert.deepEqual(await provider.request({ method: "eth_accounts" }), [account]);
  assert.equal(await provider.request({ method: "eth_chainId" }), YNX_EVM_CHAIN_HEX);
  assert.equal(await provider.request({ method: "personal_sign", params: ["0xdeadbeef", account] }), signature);
  assert.equal(await provider.request({ method: "eth_sendTransaction", params: [{ from: account, to: "0x2222222222222222222222222222222222222222", value: "0x0" }] }), hash);
});

test("provider emits standard connection events and does not turn Gateway state into a disconnect", async () => {
  const provider = wallet();
  const events: unknown[][] = [];
  provider.on("accountsChanged", (...args) => events.push(["accountsChanged", ...args]));
  provider.on("connect", (...args) => events.push(["connect", ...args]));
  provider.on("disconnect", (...args) => events.push(["disconnect", ...args]));
  await provider.request({ method: "eth_requestAccounts" });
  provider.markPrivateServiceDegraded();
  assert.equal(events.some((event) => event[0] === "disconnect"), false);
  provider.disconnect("user revoked");
  assert.deepEqual(events[0], ["accountsChanged", [account]]);
  assert.deepEqual(events[1], ["connect", { chainId: YNX_EVM_CHAIN_HEX }]);
  assert.deepEqual(events[2], ["accountsChanged", []]);
  assert.equal((events[3]?.[1] as Eip1193Error).code, 4900);
});

test("provider enforces approved account and YNX Testnet chain only", async () => {
  const provider = wallet();
  await assert.rejects(() => provider.request({ method: "personal_sign", params: ["hello", account] }), (error: unknown) => error instanceof Eip1193Error && error.code === 4100);
  await assert.rejects(() => provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }), (error: unknown) => error instanceof Eip1193Error && error.code === 4902);
  await provider.request({ method: "eth_requestAccounts" });
  await assert.rejects(() => provider.request({ method: "eth_signTypedData_v4", params: [account, "not-json"] }), (error: unknown) => error instanceof Eip1193Error && error.code === 4200);
  await assert.rejects(() => provider.request({ method: "eth_sendTransaction", params: [{ from: "0x2222222222222222222222222222222222222222" }] }), (error: unknown) => error instanceof Eip1193Error && error.code === 4100);
});
