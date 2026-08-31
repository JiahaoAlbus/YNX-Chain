import assert from "node:assert/strict";
import test from "node:test";
import { discoverWalletProviders, providerErrorCode, selectedAccount } from "./eip1193";

test("discovers EIP-6963 providers and labels a legacy provider only from explicit flags", () => {
  const originalWindow = globalThis.window;
  const listeners = new Map<string, (event: Event) => void>();
  const provider = { request: async () => [] };
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { origin: "https://monitor.example" }, ethereum: { request: async () => [], isMetaMask: true },
    addEventListener: (name: string, listener: (event: Event) => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name), dispatchEvent: () => true,
  } });
  try {
    let providers: Array<{ name: string }> = [];
    const stop = discoverWalletProviders((next) => { providers = next; });
    listeners.get("eip6963:announceProvider")?.({ detail: { info: { uuid: "ynx", name: "YNX Wallet", icon: "https://wallet.example/logo.svg", rdns: "com.ynx.wallet" }, provider } } as unknown as Event);
    assert.deepEqual(providers.map((item) => item.name), ["MetaMask", "YNX Wallet"]);
    stop();
  } finally { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); }
});

test("validates accounts and classifies rejected-wallet errors", () => {
  assert.equal(selectedAccount(["0x" + "a".repeat(40)]), "0x" + "a".repeat(40));
  assert.throws(() => selectedAccount([]), /did not return/);
  assert.equal(providerErrorCode(Object.assign(new Error("declined"), { code: 4001 })), "wallet_rejected");
});
