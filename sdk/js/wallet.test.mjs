import assert from "node:assert/strict";
import {test} from "node:test";
import {
  YNXWalletError,
  ensureYNXTestnet,
  observeYNXWalletConnection,
  readYNXWalletConnection,
  requestYNXWalletConnection,
  ynxTestnetAddEthereumChainParameter,
} from "./wallet.js";
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

test("reads an unapproved provider without opening an account prompt or Product Session", async () => {
  const calls = [];
  const provider = {
    async request({method}) {
      calls.push(method);
      if (method === "eth_accounts") return [];
      if (method === "eth_chainId") return "0x1917";
      throw new Error(`unexpected method ${method}`);
    },
  };
  assert.deepEqual(await readYNXWalletConnection(provider), {
    account: null,
    chainId: "0x1917",
    connected: false,
    state: "NO_APPROVED_ACCOUNT",
  });
  assert.deepEqual(calls.sort(), ["eth_accounts", "eth_chainId"]);
});

test("requests an account only through the explicit standard Wallet action", async () => {
  const calls = [];
  const provider = {
    async request({method}) {
      calls.push(method);
      if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
      if (method === "eth_chainId") return "0x1917";
      throw new Error(`unexpected method ${method}`);
    },
  };
  assert.deepEqual(await requestYNXWalletConnection(provider), {
    account: "0x1111111111111111111111111111111111111111",
    chainId: "0x1917",
    connected: true,
    state: "CONNECTED",
  });
  assert.deepEqual(calls, ["eth_requestAccounts", "eth_chainId"]);
});

test("observes refresh, account disconnect, chain mismatch, and provider disconnect without reopening approval", async () => {
  const provider = eventedProvider({
    accounts: ["0x1111111111111111111111111111111111111111"],
    chainId: "0x1917",
  });
  const states = [];
  const observer = observeYNXWalletConnection(provider, (state) => states.push(state));
  await observer.ready;
  assert.deepEqual(states.at(-1), {
    account: "0x1111111111111111111111111111111111111111",
    chainId: "0x1917",
    connected: true,
    reason: "initial",
    state: "CONNECTED",
  });

  provider.state.accounts = [];
  provider.emit("accountsChanged", []);
  await settle();
  assert.equal(states.at(-1).state, "NO_APPROVED_ACCOUNT");
  assert.equal(states.at(-1).reason, "accountsChanged");

  provider.state.accounts = ["0x2222222222222222222222222222222222222222"];
  provider.state.chainId = "0x1";
  provider.emit("chainChanged", "0x1");
  await settle();
  assert.equal(states.at(-1).state, "WRONG_CHAIN");
  assert.equal(states.at(-1).account, "0x2222222222222222222222222222222222222222");

  provider.emit("disconnect", {code: 4900});
  assert.equal(states.at(-1).state, "PROVIDER_DISCONNECTED");
  assert.equal(states.at(-1).connected, false);
  assert.ok(provider.calls.every((method) => method === "eth_accounts" || method === "eth_chainId"));

  const countBeforeStop = states.length;
  observer.stop();
  provider.emit("accountsChanged", ["0x3333333333333333333333333333333333333333"]);
  await settle();
  assert.equal(states.length, countBeforeStop);
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

function eventedProvider(state) {
  const listeners = new Map();
  const provider = {
    calls: [],
    state,
    async request({method}) {
      provider.calls.push(method);
      if (method === "eth_accounts") return [...state.accounts];
      if (method === "eth_chainId") return state.chainId;
      throw new Error(`unexpected method ${method}`);
    },
    on(event, listener) {
      listeners.set(event, listener);
    },
    removeListener(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
    emit(event, value) {
      listeners.get(event)?.(value);
    },
  };
  return provider;
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
