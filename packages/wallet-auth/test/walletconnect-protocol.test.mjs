import assert from "node:assert/strict";
import test from "node:test";
import {
  WALLETCONNECT_CHAIN, WALLETCONNECT_SESSION_EVENTS, WALLETCONNECT_SESSION_METHODS,
  WalletConnectRequestReplayStore, createWalletConnectRequestReview,
  createWalletConnectSessionApproval, finalizeWalletConnectRequestReview,
  parseWalletConnectPairingUri, parseWalletConnectRuntimeConfig,
  reviewWalletConnectSessionProposal, walletConnectRejection,
} from "../src/index.js";

const NOW = new Date("2026-09-20T10:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const ACCOUNT = "0x" + "12".repeat(20);
const TOPIC = "ab".repeat(32);
const KEY = "cd".repeat(32);
const PROPOSER_KEY = "ef".repeat(32);

function proposal(patch = {}) {
  const base = {
    id: 1726912800000,
    verifyContext: { verified: { origin: "https://dapp.example", validation: "VALID", verifyUrl: "https://verify.walletconnect.com/", isScam: false } },
    params: {
      id: 1726912800000,
      expiryTimestamp: NOW_SECONDS + 3600,
      relays: [{ protocol: "irn" }],
      proposer: { publicKey: PROPOSER_KEY, metadata: { name: "Example DApp", description: "Review-only test DApp", url: "https://dapp.example/", icons: ["https://dapp.example/icon.png"] } },
      requiredNamespaces: { eip155: { chains: [WALLETCONNECT_CHAIN], methods: ["personal_sign", "eth_sendTransaction"], events: [...WALLETCONNECT_SESSION_EVENTS] } },
      optionalNamespaces: { eip155: { chains: [WALLETCONNECT_CHAIN], methods: ["eth_chainId"], events: [] } },
      pairingTopic: "99".repeat(32),
    },
  };
  return { ...base, ...patch, params: { ...base.params, ...(patch.params ?? {}) } };
}

function session(methods = ["personal_sign", "eth_sendTransaction", "eth_chainId"]) {
  const value = proposal({ params: { requiredNamespaces: { eip155: { chains: [WALLETCONNECT_CHAIN], methods, events: [...WALLETCONNECT_SESSION_EVENTS] } }, optionalNamespaces: {} } });
  const review = reviewWalletConnectSessionProposal(value, { account: ACCOUNT, now: NOW });
  return createWalletConnectSessionApproval(review, { approved: true, topic: TOPIC }, new Date(NOW_SECONDS * 1000 + 1000));
}

function request(method, params, patch = {}) {
  const base = { topic: TOPIC, id: 1726912800001, verifyContext: { verified: { origin: "https://dapp.example", validation: "VALID", verifyUrl: "https://verify.walletconnect.com/" } }, params: { chainId: WALLETCONNECT_CHAIN, request: { method, params, expiryTimestamp: NOW_SECONDS + 120 } } };
  const value = { ...base, ...patch };
  if (patch.chainId) { value.params = { ...value.params, chainId: patch.chainId }; delete value.chainId; }
  if (patch.expiryTimestamp) { value.params = { ...value.params, request: { ...value.params.request, expiryTimestamp: patch.expiryTimestamp } }; delete value.expiryTimestamp; }
  return value;
}

test("runtime config and canonical v2 pairing URI are strict and credential-free", () => {
  assert.deepEqual(parseWalletConnectRuntimeConfig({ projectId: "01".repeat(16) }), { projectId: "01".repeat(16), relayUrl: "wss://relay.walletconnect.com" });
  assert.deepEqual(parseWalletConnectRuntimeConfig({ projectId: "01".repeat(16), relayUrl: "wss://relay.example/ws" }), { projectId: "01".repeat(16), relayUrl: "wss://relay.example/ws" });
  const uri = `wc:${TOPIC}@2?relay-protocol=irn&symKey=${KEY}&expiryTimestamp=${NOW_SECONDS + 60}`;
  assert.deepEqual(parseWalletConnectPairingUri(uri, NOW), { topic: TOPIC, version: 2, relayProtocol: "irn", symKey: KEY, expiryTimestamp: NOW_SECONDS + 60 });
  for (const invalid of [
    uri.replace("@2", "@1"), uri.replace("relay-protocol=irn", "relay-protocol=waku"),
    `${uri}&symKey=${KEY}`, `${uri}&evil=1`, uri.replace(KEY, KEY.toUpperCase()),
    ` ${uri}`, uri.replace(String(NOW_SECONDS + 60), String(NOW_SECONDS)),
  ]) assert.throws(() => parseWalletConnectPairingUri(invalid, NOW));
  assert.throws(() => parseWalletConnectRuntimeConfig({ projectId: "public-placeholder" }));
  assert.throws(() => parseWalletConnectRuntimeConfig({ projectId: "01".repeat(16), apiSecret: "must-not-be-here" }));
});

test("proposal normalizes exact eip155:6423 capabilities into review-only material", () => {
  const review = reviewWalletConnectSessionProposal(proposal(), { account: ACCOUNT, now: NOW });
  assert.equal(review.kind, "walletconnect_session_review");
  assert.equal(review.requiresUserApproval, true);
  assert.deepEqual(review.namespaces.eip155.chains, [WALLETCONNECT_CHAIN]);
  assert.deepEqual(review.namespaces.eip155.accounts, [`${WALLETCONNECT_CHAIN}:${ACCOUNT}`]);
  assert.deepEqual(review.namespaces.eip155.methods, ["eth_chainId", "eth_sendTransaction", "personal_sign"]);
  assert.match(review.proposalDigest, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(review, "approved"), false);
  assert.equal(Object.hasOwn(review, "signature"), false);
});

test("cross-chain, unknown namespace, method, event and expiry proposals fail closed with SDK reasons", () => {
  const variants = [
    [proposal({ params: { requiredNamespaces: { eip155: { chains: ["eip155:1"], methods: ["personal_sign"], events: [] } } } }), 5100],
    [proposal({ params: { requiredNamespaces: { cosmos: { chains: ["cosmos:cosmoshub-4"], methods: ["cosmos_signDirect"], events: [] } } } }), 5104],
    [proposal({ params: { requiredNamespaces: { eip155: { chains: [WALLETCONNECT_CHAIN], methods: ["eth_sign"], events: [] } } } }), 5101],
    [proposal({ params: { requiredNamespaces: { eip155: { chains: [WALLETCONNECT_CHAIN], methods: ["personal_sign"], events: ["message"] } } } }), 5102],
    [proposal({ params: { expiryTimestamp: NOW_SECONDS } }), 5000],
  ];
  for (const [input, rejectionCode] of variants) {
    let error; try { reviewWalletConnectSessionProposal(input, { account: ACCOUNT, now: NOW }); } catch (caught) { error = caught; }
    assert.ok(error); assert.equal(walletConnectRejection(error).code, rejectionCode);
  }
  assert.ok(WALLETCONNECT_SESSION_METHODS.includes("personal_sign"));
  assert.ok(!WALLETCONNECT_SESSION_METHODS.includes("eth_sign"));
});

test("session activation requires explicit approval and a relay-produced topic", () => {
  const review = reviewWalletConnectSessionProposal(proposal(), { account: ACCOUNT, now: NOW });
  assert.throws(() => createWalletConnectSessionApproval(review, { approved: false, topic: TOPIC }, NOW), { code: "WALLETCONNECT_USER_REJECTED" });
  assert.throws(() => createWalletConnectSessionApproval(review, { approved: true, topic: "bad" }, NOW));
  const approved = createWalletConnectSessionApproval(review, { approved: true, topic: TOPIC }, NOW);
  assert.equal(approved.topic, TOPIC);
  assert.match(approved.sessionBinding, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(approved, "signature"), false);
});

test("real 2.25 proposal optional fields and metadata are accepted but unsupported bundled requests fail closed", () => {
  const input = proposal({ params: {
    expiry: NOW_SECONDS + 3600,
    sessionProperties: { capability: "testnet" }, scopedProperties: { eip155: { mode: "review" } },
    attestation: "attestation_123", encryptedId: "encrypted_123",
    proposer: { publicKey: PROPOSER_KEY, metadata: { name: "Example DApp", description: "Review-only test DApp", url: "https://dapp.example/", icons: ["https://dapp.example/icon.png"], verifyUrl: "https://verify.example/", redirect: { native: "examplewallet://return", universal: "https://dapp.example/return", linkMode: true } } },
  } });
  assert.equal(reviewWalletConnectSessionProposal(input, { account: ACCOUNT, now: NOW }).verification.validation, "VALID");
  assert.throws(() => reviewWalletConnectSessionProposal(proposal({ params: { requests: { authentication: [] } } }), { account: ACCOUNT, now: NOW }), { code: "WALLETCONNECT_UNSUPPORTED_METHODS" });
  assert.throws(() => reviewWalletConnectSessionProposal(proposal({ params: { id: 999 } }), { account: ACCOUNT, now: NOW }), { code: "WALLETCONNECT_ID_MISMATCH" });
});

test("Verify Context is preserved for review and blocks INVALID or scam origins", () => {
  const unknown = proposal(); unknown.verifyContext = { verified: { origin: "", validation: "UNKNOWN", verifyUrl: "" } };
  assert.deepEqual(reviewWalletConnectSessionProposal(unknown, { account: ACCOUNT, now: NOW }).verification, { origin: "", validation: "UNKNOWN", verifyUrl: "", isScam: false });
  for (const verified of [
    { origin: "https://dapp.example", validation: "INVALID", verifyUrl: "https://verify.walletconnect.com/" },
    { origin: "https://dapp.example", validation: "VALID", verifyUrl: "https://verify.walletconnect.com/", isScam: true },
  ]) assert.throws(() => reviewWalletConnectSessionProposal({ ...proposal(), verifyContext: { verified } }, { account: ACCOUNT, now: NOW }), { code: "UNSAFE_WALLETCONNECT_ORIGIN" });
  assert.throws(() => reviewWalletConnectSessionProposal({ ...proposal(), verifyContext: { verified: { origin: "https://other.example", validation: "VALID", verifyUrl: "https://verify.walletconnect.com/" } } }, { account: ACCOUNT, now: NOW }), { code: "UNSAFE_WALLETCONNECT_ORIGIN" });
});

test("personal_sign is account-bound, review-only, expiring and single-consumption", () => {
  const store = new WalletConnectRequestReplayStore();
  const message = "0x68656c6c6f";
  const review = createWalletConnectRequestReview(request("personal_sign", [message, ACCOUNT]), { session: session(), now: NOW, replayStore: store });
  assert.equal(review.requiresUserApproval, true);
  assert.equal(review.method, "personal_sign");
  assert.deepEqual(review.params, [message, ACCOUNT]);
  assert.equal(Object.hasOwn(review, "signature"), false);
  assert.equal(store.snapshot()[0].status, "reserved");
  assert.throws(() => createWalletConnectRequestReview(request("personal_sign", [message, ACCOUNT]), { session: session(), now: NOW, replayStore: store }), { code: "WALLETCONNECT_REPLAY" });
  const decision = finalizeWalletConnectRequestReview(review, { approved: true }, store, new Date(NOW.getTime() + 1000));
  assert.deepEqual({ approved: decision.approved, executionAuthorized: decision.executionAuthorized }, { approved: true, executionAuthorized: true });
  assert.equal(Object.hasOwn(decision, "signature"), false);
  assert.throws(() => finalizeWalletConnectRequestReview(review, { approved: true }, store, new Date(NOW.getTime() + 2000)), { code: "WALLETCONNECT_REPLAY" });
});

test("request binds topic, chain, approved method, account, lifetime and session digest", () => {
  const cases = [
    request("personal_sign", ["0x00", ACCOUNT], { topic: "11".repeat(32) }),
    request("personal_sign", ["0x00", ACCOUNT], { chainId: "eip155:1" }),
    request("personal_sign", ["0x00", "0x" + "34".repeat(20)]),
    request("personal_sign", [ACCOUNT, "0x00"]),
    request("eth_sign", [ACCOUNT, "0x00"]),
    request("personal_sign", ["0x00", ACCOUNT], { expiryTimestamp: NOW_SECONDS + 301 }),
  ];
  for (const [index, input] of cases.entries()) assert.throws(() => createWalletConnectRequestReview({ ...input, id: input.id + index }, { session: session(), now: NOW, replayStore: new WalletConnectRequestReplayStore() }));
  const validSession = session();
  const tampered = { ...validSession, account: "0x" + "34".repeat(20) };
  assert.throws(() => createWalletConnectRequestReview(request("personal_sign", ["0x00", ACCOUNT]), { session: tampered, now: NOW, replayStore: new WalletConnectRequestReplayStore() }), { code: "WALLETCONNECT_UNSUPPORTED_ACCOUNTS" });
});

test("real 2.25 request nesting, matching IDs and bounded default expiry are enforced", () => {
  const value = request("eth_chainId", [], { id: 700 });
  delete value.params.request.expiryTimestamp;
  const review = createWalletConnectRequestReview(value, { session: session(), now: NOW, replayStore: new WalletConnectRequestReplayStore() });
  assert.equal(review.expirySource, "bounded-default");
  assert.equal(review.expiresAt, new Date((NOW_SECONDS + 300) * 1000).toISOString());
  const invalid = request("eth_chainId", [], { id: 701 }); invalid.params.id = 702;
  assert.throws(() => createWalletConnectRequestReview(invalid, { session: session(), now: NOW, replayStore: new WalletConnectRequestReplayStore() }));
  const scam = request("eth_chainId", [], { id: 702 }); scam.verifyContext.verified.isScam = true;
  assert.throws(() => createWalletConnectRequestReview(scam, { session: session(), now: NOW, replayStore: new WalletConnectRequestReplayStore() }), { code: "UNSAFE_WALLETCONNECT_ORIGIN" });
  const substituted = request("eth_chainId", [], { id: 703 }); substituted.verifyContext.verified.origin = "https://other.example";
  assert.throws(() => createWalletConnectRequestReview(substituted, { session: session(), now: NOW, replayStore: new WalletConnectRequestReplayStore() }), { code: "UNSAFE_WALLETCONNECT_ORIGIN" });
});

test("transaction draft binds sender and exact canonical transaction fields without executing", () => {
  const store = new WalletConnectRequestReplayStore();
  const tx = { from: ACCOUNT, to: "0x" + "34".repeat(20), value: "0x1", gas: "0x5208", gasPrice: "0x1", nonce: "0x0", chainId: "0x1917", data: "0x" };
  const review = createWalletConnectRequestReview(request("eth_sendTransaction", [tx]), { session: session(), now: NOW, replayStore: store });
  assert.deepEqual(review.params, [tx]);
  assert.equal(review.requiresUserApproval, true);
  assert.equal(Object.hasOwn(review, "transactionHash"), false);
  for (const [index, bad] of [
    { ...tx, from: "0x" + "56".repeat(20) }, { ...tx, chainId: "0x1" }, { ...tx, value: "0x01" },
    { ...tx, maxFeePerGas: "0x1" }, { ...tx, to: undefined },
  ].entries()) assert.throws(() => createWalletConnectRequestReview(request("eth_sendTransaction", [bad], { id: index + 2 }), { session: session(), now: NOW, replayStore: new WalletConnectRequestReplayStore() }));
});

test("typed data, chain switching and add-chain requests remain pinned to YNX Testnet", () => {
  const methods = ["eth_signTypedData_v4", "wallet_switchEthereumChain", "wallet_addEthereumChain"];
  const approved = session(methods);
  const typed = JSON.stringify({ domain: { name: "Example", chainId: 6423 }, types: {}, primaryType: "Message", message: {} });
  const values = [
    request(methods[0], [ACCOUNT, typed], { id: 11 }),
    request(methods[1], [{ chainId: "0x1917" }], { id: 12 }),
    request(methods[2], [{ chainId: "0x1917", chainName: "YNX Testnet", nativeCurrency: { name: "YNX Testnet", symbol: "YNXT", decimals: 18 }, rpcUrls: ["https://rpc-testnet.ynxweb4.com"], blockExplorerUrls: ["https://explorer.ynxweb4.com"] }], { id: 13 }),
  ];
  for (const value of values) assert.equal(createWalletConnectRequestReview(value, { session: approved, now: NOW, replayStore: new WalletConnectRequestReplayStore() }).requiresUserApproval, true);
  assert.throws(() => createWalletConnectRequestReview(request(methods[0], [ACCOUNT, JSON.stringify({ domain: { chainId: 1 } })], { id: 14 }), { session: approved, now: NOW, replayStore: new WalletConnectRequestReplayStore() }), { code: "WALLETCONNECT_UNSUPPORTED_CHAINS" });
  assert.throws(() => createWalletConnectRequestReview(request(methods[1], [{ chainId: "0x1" }], { id: 15 }), { session: approved, now: NOW, replayStore: new WalletConnectRequestReplayStore() }), { code: "WALLETCONNECT_UNSUPPORTED_CHAINS" });
});

test("hidden, accessor, oversized and non-plain inputs are rejected before review", () => {
  const input = proposal(); Object.defineProperty(input, "hidden", { value: true });
  assert.throws(() => reviewWalletConnectSessionProposal(input, { account: ACCOUNT, now: NOW }), /hidden/);
  let reads = 0; const accessor = proposal(); Object.defineProperty(accessor.params.proposer.metadata, "name", { enumerable: true, get() { reads++; return "evil"; } });
  assert.throws(() => reviewWalletConnectSessionProposal(accessor, { account: ACCOUNT, now: NOW }), /accessors/); assert.equal(reads, 0);
  const inherited = Object.assign(Object.create({ injected: true }), proposal());
  assert.throws(() => reviewWalletConnectSessionProposal(inherited, { account: ACCOUNT, now: NOW }), /JSON object/);
  const huge = "0x" + "00".repeat(64 * 1024 + 1);
  assert.throws(() => createWalletConnectRequestReview(request("personal_sign", [huge, ACCOUNT]), { session: session(), now: NOW, replayStore: new WalletConnectRequestReplayStore() }));
});

test("replay snapshot persists reservations and consumed requests across restarts", () => {
  const first = new WalletConnectRequestReplayStore();
  const review = createWalletConnectRequestReview(request("eth_chainId", [], { id: 444 }), { session: session(), now: NOW, replayStore: first });
  const restored = new WalletConnectRequestReplayStore(first.snapshot());
  assert.throws(() => createWalletConnectRequestReview(request("eth_chainId", [], { id: 444 }), { session: session(), now: NOW, replayStore: restored }), { code: "WALLETCONNECT_REPLAY" });
  finalizeWalletConnectRequestReview(review, { approved: false }, restored, new Date(NOW.getTime() + 1000));
  const again = new WalletConnectRequestReplayStore(restored.snapshot());
  assert.equal(again.snapshot()[0].status, "consumed");
  assert.throws(() => finalizeWalletConnectRequestReview(review, { approved: false }, again, new Date(NOW.getTime() + 2000)), { code: "WALLETCONNECT_REPLAY" });
});
