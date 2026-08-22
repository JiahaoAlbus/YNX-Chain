import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createStandardWalletSiweMessage,
  createStandardWalletTransactionRequest,
  createStandardWalletTypedData,
  runStandardWalletConformance,
  STANDARD_WALLET_CONFORMANCE_PROFILES,
  STANDARD_WALLET_CONFORMANCE_VERSION,
  STANDARD_WALLET_EIP1193_METHODS,
  WalletAuthError,
} from "../src/index.js";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef12345678";
const OTHER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const SIGNATURE = `0x${"11".repeat(65)}`;
const HASH = `0x${"22".repeat(32)}`;
const input = () => ({
  testHarness: true,
  siwe: { domain: "dapp.example", uri: "https://dapp.example/", address: ACCOUNT, statement: "Sign in to the YNX Testnet reference fixture.", nonce: "siwe_nonce_20260822", issuedAt: "2026-08-22T00:00:00.000Z" },
  typedData: { account: OTHER, origin: "https://dapp.example/", purpose: "Verify standard Wallet conformance.", nonce: "typed_nonce_20260822" },
  transaction: { from: OTHER, to: OTHER, value: "0x0" },
});

function fixture(calls) {
  return {
    async request(value) {
      calls.push(value);
      if (value.method === "eth_chainId") return "0x1917";
      if (value.method === "eth_accounts") return [];
      if (value.method === "eth_requestAccounts") return [ACCOUNT];
      if (value.method === "personal_sign" || value.method === "eth_signTypedData_v4") return SIGNATURE;
      if (value.method === "eth_sendTransaction") return HASH;
      throw new Error("unexpected test method");
    },
  };
}

test("conformance freezes one explicit source-only profile for first party, three external EVM references and WalletConnect transport", () => {
  assert.equal(STANDARD_WALLET_CONFORMANCE_VERSION, "standardWalletConformance@1.0.0-p0.0");
  assert.deepEqual(STANDARD_WALLET_CONFORMANCE_PROFILES.map(({ id }) => id), [
    "ynx-first-party", "uniswap-interface-reference", "opensea-reference", "safe-reference", "walletconnect-v2-reference",
  ]);
  assert.deepEqual(STANDARD_WALLET_EIP1193_METHODS, [
    "eth_chainId", "eth_accounts", "eth_requestAccounts", "wallet_addEthereumChain", "wallet_switchEthereumChain", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction",
  ]);
  for (const profile of STANDARD_WALLET_CONFORMANCE_PROFILES.filter(({ class: kind }) => kind === "external-reference")) assert.equal(profile.transport, "eip1193");
});

test("fixture conformance executes canonical EIP-1193, SIWE, EIP-712 and transaction boundaries without claiming a real Wallet", async () => {
  for (const { id } of STANDARD_WALLET_CONFORMANCE_PROFILES) {
    const calls = [], result = await runStandardWalletConformance({ ...input(), profileId: id, provider: fixture(calls) });
    assert.equal(result.profileId, id);
    assert.equal(result.chainId, "0x1917");
    assert.equal(result.selectedAccount, ACCOUNT);
    assert.equal(result.realWalletAuthority, false);
    assert.equal(result.externalDappRuntimeVerified, false);
    assert.equal(result.productConnectionVerified, false);
    assert.match(result.siwe.message, /Chain ID: 6423/);
    assert.equal(result.eip712.typedData.message.account, ACCOUNT);
    assert.deepEqual(calls.map(({ method }) => method), ["eth_chainId", "eth_accounts", "eth_requestAccounts", "eth_chainId", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"]);
    assert.deepEqual(calls[4].params, [result.siwe.message, ACCOUNT]);
    assert.deepEqual(calls[6].params, [{ from: ACCOUNT, to: OTHER, value: "0x0" }]);
  }
});

test("SIWE, typed data and transaction constructors bind exact account, YNX Testnet and canonical HTTPS origin", () => {
  const siwe = createStandardWalletSiweMessage(input().siwe);
  assert.match(siwe, /^dapp\.example wants you to sign in with your Ethereum account:/);
  assert.match(siwe, /URI: https:\/\/dapp\.example/);
  const typed = createStandardWalletTypedData({ ...input().typedData, account: ACCOUNT });
  assert.equal(Object.isFrozen(typed), true);
  assert.equal(typed.domain.chainId, 6423);
  assert.equal(typed.message.account, ACCOUNT);
  assert.deepEqual(createStandardWalletTransactionRequest({ from: ACCOUNT, to: OTHER, value: "0x0" }), { from: ACCOUNT, to: OTHER, value: "0x0" });
});

test("conformance fails closed before any Provider request without an explicit harness or canonical action data", async () => {
  const calls = [], provider = fixture(calls);
  await assert.rejects(runStandardWalletConformance({ ...input(), profileId: "ynx-first-party", provider, testHarness: false }), code("CONFORMANCE_HARNESS_REQUIRED"));
  assert.deepEqual(calls, []);
  await assert.rejects(runStandardWalletConformance({ ...input(), profileId: "unknown", provider, testHarness: true }), code("UNKNOWN_CONFORMANCE_PROFILE"));
  assert.throws(() => createStandardWalletSiweMessage({ ...input().siwe, uri: "http://dapp.example/" }), code("INVALID_STANDARD_WALLET_ORIGIN"));
  assert.throws(() => createStandardWalletTypedData({ ...input().typedData, origin: "https://dapp.example/path" }), code("INVALID_STANDARD_WALLET_ORIGIN"));
  assert.throws(() => createStandardWalletTransactionRequest({ ...input().transaction, value: "1" }), code("INVALID_TRANSACTION_REQUEST"));
});

test("provider rejection and malformed signatures or transaction hashes never become conformance success", async () => {
  const provider = fixture([]);
  provider.request = async ({ method }) => {
    if (method === "eth_chainId") return "0x1917";
    if (method === "eth_accounts") return [];
    if (method === "eth_requestAccounts") throw Object.assign(new Error("rejected"), { code: 4001 });
    return null;
  };
  await assert.rejects(runStandardWalletConformance({ ...input(), profileId: "ynx-first-party", provider }), code("CONFORMANCE_PROVIDER_ERROR"));
  const malformed = fixture([]);
  malformed.request = async ({ method }) => method === "eth_chainId" ? "0x1917" : method === "eth_accounts" ? [] : method === "eth_requestAccounts" ? [ACCOUNT] : "0x01";
  await assert.rejects(runStandardWalletConformance({ ...input(), profileId: "safe-reference", provider: malformed }), code("INVALID_WALLET_RESPONSE"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
