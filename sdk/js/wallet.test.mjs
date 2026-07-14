import assert from "node:assert/strict";
import {test} from "node:test";
import {YNXWalletError, ensureYNXTestnet, ynxTestnetAddEthereumChainParameter} from "./wallet.js";
import {ynxTestnet} from "./ynx-testnet.js";

test("builds the bounded EIP-3085 payload", () => {
  assert.deepEqual(ynxTestnetAddEthereumChainParameter(), {
    blockExplorerUrls: ["https://explorer.ynxweb4.com"],
    chainId: "0x1917",
    chainName: "YNX Testnet",
    nativeCurrency: {decimals: 18, name: "YNXT", symbol: "YNXT"},
    rpcUrls: ["https://evm.ynxweb4.com"],
  });
});

test("does nothing when YNX Testnet is already selected", async () => {
  const provider = scriptedProvider([{method: "eth_chainId", result: ynxTestnet.chainId}]);
  assert.deepEqual(await ensureYNXTestnet(provider), {added: false, chainId: "0x1917", switched: false});
  provider.assertComplete();
});

test("switches an already known chain and verifies the result", async () => {
  const provider = scriptedProvider([
    {method: "eth_chainId", result: "0x1"},
    {method: "wallet_switchEthereumChain", params: [{chainId: "0x1917"}], result: null},
    {method: "eth_chainId", result: "0x1917"},
  ]);
  assert.deepEqual(await ensureYNXTestnet(provider), {added: false, chainId: "0x1917", switched: true});
  provider.assertComplete();
});

test("adds an unknown chain, explicitly switches, and verifies the result", async () => {
  const provider = scriptedProvider([
    {method: "eth_chainId", result: "0x1"},
    {method: "wallet_switchEthereumChain", error: providerError(4902, "unknown chain")},
    {method: "wallet_addEthereumChain", params: [ynxTestnetAddEthereumChainParameter()], result: null},
    {method: "wallet_switchEthereumChain", params: [{chainId: "0x1917"}], result: null},
    {method: "eth_chainId", result: "0x1917"},
  ]);
  assert.deepEqual(await ensureYNXTestnet(provider), {added: true, chainId: "0x1917", switched: true});
  provider.assertComplete();
});

test("preserves user rejection and unsupported-method errors", async () => {
  for (const [code, pattern] of [[4001, /user rejected/], [-32601, /does not support/]]) {
    const provider = scriptedProvider([
      {method: "eth_chainId", result: "0x1"},
      {method: "wallet_switchEthereumChain", error: providerError(code, "provider failure")},
    ]);
    await assert.rejects(ensureYNXTestnet(provider), (error) => error instanceof YNXWalletError && error.code === code && pattern.test(error.message));
    provider.assertComplete();
  }
});

test("fails closed when the wallet reports the wrong chain after switching", async () => {
  const provider = scriptedProvider([
    {method: "eth_chainId", result: "0x1"},
    {method: "wallet_switchEthereumChain", result: null},
    {method: "eth_chainId", result: "0x2"},
  ]);
  await assert.rejects(ensureYNXTestnet(provider), (error) => error instanceof YNXWalletError && error.code === "CHAIN_MISMATCH");
});

test("rejects a missing provider without requesting any account capability", async () => {
  await assert.rejects(ensureYNXTestnet(null), (error) => error instanceof YNXWalletError && error.code === "PROVIDER_REQUIRED");
});

function scriptedProvider(steps) {
  let index = 0;
  return {
    async request(request) {
      assert.notEqual(request.method, "eth_requestAccounts");
      assert.notEqual(request.method, "eth_sendTransaction");
      const step = steps[index++];
      assert.ok(step, `unexpected provider request ${request.method}`);
      assert.equal(request.method, step.method);
      if (step.params) assert.deepEqual(request.params, step.params);
      if (step.error) throw step.error;
      return step.result;
    },
    assertComplete() {
      assert.equal(index, steps.length);
    },
  };
}

function providerError(code, message) {
  return Object.assign(new Error(message), {code});
}
