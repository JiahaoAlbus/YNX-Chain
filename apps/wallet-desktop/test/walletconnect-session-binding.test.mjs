import assert from "node:assert/strict";
import { test } from "node:test";
import { WalletConnectTransport, WALLETCONNECT_CHAIN, WALLETCONNECT_METHODS, WALLETCONNECT_EVENTS } from "../src/walletconnect-transport.mjs";

// Public synthetic addresses only; these tests never initialize a key or contact a relay.
const ACCOUNT_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ACCOUNT_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ORIGIN = "https://dapp.example";
const NOW = 2_000_000_000_000;

function session(topic, account = ACCOUNT_A) {
  return {
    topic, expiry: NOW / 1000 + 3600,
    peer: { metadata: { name: "Synthetic DApp", url: ORIGIN } },
    namespaces: { eip155: { accounts: [`${WALLETCONNECT_CHAIN}:${account}`], methods: [...WALLETCONNECT_METHODS], events: [...WALLETCONNECT_EVENTS] } }
  };
}
function request(topic, method, account, id = 1) {
  const params = method === "personal_sign" ? ["0x01", account]
    : method === "eth_signTypedData_v4" ? [account, '{"domain":{"chainId":6423},"types":{},"primaryType":"Message","message":{}}']
      : [{ from: account, to: ACCOUNT_A, value: "0x0" }];
  return { topic, id, params: { chainId: WALLETCONNECT_CHAIN, request: { method, params } } };
}
function storage() {
  const records = new Map();
  return { records, async getItem(key) { return structuredClone(records.get(key)); }, async setItem(key, value) { records.set(key, structuredClone(value)); } };
}
async function fixture({ sessions = [session("topic-a"), session("topic-b", ACCOUNT_B)], store = storage(), disconnect = async () => {}, handlers: callbacks = {} } = {}) {
  const active = Object.fromEntries(sessions.map(value => [value.topic, value]));
  const handlers = new Map(), responses = [], events = [], approvals = [];
  const kit = {
    core: { storage: store, relayer: { connected: false } },
    on(name, callback) { handlers.set(name, callback); },
    getActiveSessions() { return active; },
    disconnectSession: disconnect,
    async respondSessionRequest(response) { responses.push(response); },
    async emitSessionEvent(event) { events.push(event); },
    async approveSession(input) { approvals.push(input); const approved = { ...session("approved-topic"), namespaces: input.namespaces }; active[approved.topic] = approved; return approved; }
  };
  const transport = new WalletConnectTransport({ projectId: "synthetic-project-id", metadata: { name: "Synthetic Wallet", url: "https://wallet.example" }, walletKitFactory: async () => kit, clock: () => NOW });
  await transport.start(callbacks);
  return { transport, kit, active, handlers, responses, events, approvals, store };
}
function code(expected) { return error => error?.code === expected; }

test("all signing methods require the requested account in this topic and selected in the Wallet", async () => {
  const { transport } = await fixture();
  for (const method of WALLETCONNECT_METHODS) {
    assert.throws(() => transport.authorizeRequest(request("topic-a", method, ACCOUNT_B), ACCOUNT_B), code("UNAUTHORIZED_WALLETCONNECT_ACCOUNT"));
    assert.throws(() => transport.authorizeRequest(request("topic-a", method, ACCOUNT_A), ACCOUNT_B), code("UNAUTHORIZED_WALLETCONNECT_ACCOUNT"));
    assert.equal(transport.authorizeRequest(request("topic-b", method, ACCOUNT_B), ACCOUNT_B).topic, "topic-b");
    assert.throws(() => transport.authorizeRequest(request("topic-a", method, ACCOUNT_A)), code("INVALID_WALLETCONNECT_ACCOUNT"));
  }
});

test("even a multi-account namespace cannot sign as an account other than the selected one", async () => {
  const value = session("multi-account-topic");
  value.namespaces.eip155.accounts.push(`${WALLETCONNECT_CHAIN}:${ACCOUNT_B}`);
  const { transport } = await fixture({ sessions: [value] });
  assert.throws(() => transport.authorizeRequest(request(value.topic, "personal_sign", ACCOUNT_A), ACCOUNT_B), code("UNAUTHORIZED_WALLETCONNECT_ACCOUNT"));
  assert.equal(transport.authorizeRequest(request(value.topic, "personal_sign", ACCOUNT_B), ACCOUNT_B).topic, value.topic);
});

test("EVM account comparison accepts case variants without accepting a different address", async () => {
  const mixed = `0x${"Aa".repeat(20)}`;
  const { transport } = await fixture({ sessions: [session("mixed-account-topic", mixed)] });
  assert.equal(transport.authorizeRequest(request("mixed-account-topic", "personal_sign", ACCOUNT_A), mixed).topic, "mixed-account-topic");
});

test("malformed or omitted signing accounts fail before a request can reach approval UI", async () => {
  const { transport } = await fixture();
  for (const [method, params] of [["personal_sign", ["0x01"]], ["personal_sign", ["0x01", "0x1234"]], ["eth_signTypedData_v4", [ACCOUNT_A]], ["eth_sendTransaction", [{}]], ["eth_sendTransaction", [[ACCOUNT_A]]]]) {
    const event = { topic: "topic-a", id: 1, params: { chainId: WALLETCONNECT_CHAIN, request: { method, params } } };
    assert.throws(() => transport.authorizeRequest(event, ACCOUNT_A), error => ["INVALID_WALLETCONNECT_ACCOUNT", "INVALID_WALLETCONNECT_REQUEST"].includes(error.code));
  }
});

test("disconnect tombstones a topic immediately and keeps it revoked when the remote call fails", async () => {
  const remote = Promise.withResolvers(), requested = Promise.withResolvers();
  const { transport } = await fixture({ disconnect: async () => { requested.resolve(); return remote.promise; } });
  const disconnecting = transport.disconnectSession("topic-a");
  const failed = assert.rejects(disconnecting, /synthetic relay failure/);
  assert.throws(() => transport.authorizeRequest(request("topic-a", "personal_sign", ACCOUNT_A), ACCOUNT_A), code("WALLETCONNECT_SESSION_DISCONNECTED"));
  assert.deepEqual(transport.sessions().map(value => value.topic), ["topic-b"]);
  assert.equal(transport.status().activeSessionCount, 1);
  await requested.promise;
  remote.reject(new Error("synthetic relay failure"));
  await failed;
  assert.throws(() => transport.authorizeRequest(request("topic-a", "personal_sign", ACCOUNT_B), ACCOUNT_B), code("WALLETCONNECT_SESSION_DISCONNECTED"));
  assert.equal(transport.authorizeRequest(request("topic-b", "personal_sign", ACCOUNT_B), ACCOUNT_B).origin, ORIGIN);
});

test("locally disconnected topics stay revoked across restart even when WalletKit retains the remote session", async () => {
  const store = storage();
  const first = await fixture({ store, disconnect: async () => { throw new Error("synthetic relay failure"); } });
  await assert.rejects(first.transport.disconnectSession("topic-a"), /synthetic relay failure/);
  const restored = [];
  const second = await fixture({ store, handlers: { onSessionRestore: value => restored.push(value.topic) } });
  assert.deepEqual(restored, ["topic-b"]);
  assert.equal(second.transport.status().activeSessionCount, 1);
  assert.throws(() => second.transport.authorizeRequest(request("topic-a", "personal_sign", ACCOUNT_A), ACCOUNT_A), code("WALLETCONNECT_SESSION_DISCONNECTED"));
  assert.equal(second.transport.authorizeRequest(request("topic-b", "personal_sign", ACCOUNT_B), ACCOUNT_B).topic, "topic-b");
});

test("session_delete revokes before an asynchronous local cleanup handler finishes", async () => {
  const cleanup = Promise.withResolvers();
  const { transport, handlers } = await fixture({ handlers: { onSessionDelete: () => cleanup.promise } });
  const deleting = handlers.get("session_delete")({ topic: "topic-a" });
  assert.throws(() => transport.authorizeRequest(request("topic-a", "personal_sign", ACCOUNT_A), ACCOUNT_A), code("WALLETCONNECT_SESSION_DISCONNECTED"));
  cleanup.resolve(); await deleting;
});

test("revoked topics cannot send successful results or account events, but may send rejection errors", async () => {
  const { transport, responses } = await fixture();
  await assert.rejects(transport.emitAccountAndChainChanged("topic-a", ACCOUNT_B), code("UNAUTHORIZED_WALLETCONNECT_ACCOUNT"));
  await transport.disconnectSession("topic-a");
  await assert.rejects(transport.respond("topic-a", 1, { status: "success", result: "synthetic-result" }), code("WALLETCONNECT_SESSION_DISCONNECTED"));
  await assert.rejects(transport.emitAccountAndChainChanged("topic-a", ACCOUNT_A), code("WALLETCONNECT_SESSION_DISCONNECTED"));
  assert.deepEqual(responses, []);
  await transport.respond("topic-a", 1, { status: "error", code: 4100, message: "Disconnected" });
  assert.equal(responses[0].response.error.code, 4100);
});

test("failed persistence still revokes locally and malformed saved revocations fail closed on startup", async () => {
  const broken = { async getItem() { return undefined; }, async setItem() { throw new Error("synthetic storage failure"); } };
  const { transport } = await fixture({ store: broken });
  await assert.rejects(transport.disconnectSession("topic-a"), code("WALLETCONNECT_SESSION_STORAGE_UNAVAILABLE"));
  assert.throws(() => transport.authorizeRequest(request("topic-a", "personal_sign", ACCOUNT_A), ACCOUNT_A), code("WALLETCONNECT_SESSION_DISCONNECTED"));
  await assert.rejects(fixture({ store: { async getItem() { return { version: 1, topics: [null] }; }, async setItem() {} } }), code("INVALID_WALLETCONNECT_SESSION_STORAGE"));
});

function proposal(id, requiredNamespaces, optionalNamespaces = {}) {
  return { id, expiryTimestamp: NOW / 1000 + 600, params: { proposer: { metadata: { name: "Synthetic DApp", url: ORIGIN } }, requiredNamespaces, optionalNamespaces } };
}

test("optional-only EIP155 proposals show and grant only supported Testnet permissions", async () => {
  const visible = [];
  const { transport, handlers, approvals } = await fixture({ sessions: [], handlers: { onSessionProposal: value => visible.push(value.id) } });
  handlers.get("session_proposal")(proposal(101, {}, { eip155: { chains: ["eip155:1", WALLETCONNECT_CHAIN], methods: ["personal_sign", "eth_sign", "eth_sendTransaction"], events: ["accountsChanged", "unsupported-event"] }, solana: { chains: ["solana:mainnet"], methods: ["solana_signMessage"], events: [] } }));
  assert.deepEqual(visible, [101]);
  const review = transport.proposalPermissions(101);
  assert.deepEqual(review, { chains: [WALLETCONNECT_CHAIN], methods: ["personal_sign", "eth_sendTransaction"], events: ["accountsChanged"] });
  await transport.approveSession(101, ACCOUNT_A);
  assert.deepEqual(approvals[0].namespaces.eip155, { ...review, accounts: [`${WALLETCONNECT_CHAIN}:${ACCOUNT_A}`] });
});

test("chain-qualified optional namespace is supported without widening required permissions", async () => {
  const { transport, handlers } = await fixture({ sessions: [] });
  handlers.get("session_proposal")(proposal(102, {}, { [WALLETCONNECT_CHAIN]: { methods: ["personal_sign"], events: [] } }));
  assert.deepEqual(transport.proposalPermissions(102), { chains: [WALLETCONNECT_CHAIN], methods: ["personal_sign"], events: [] });
});

test("unsupported required namespaces and proposals without Testnet never reach approval UI", async () => {
  const visible = [], invalid = [];
  const { handlers } = await fixture({ sessions: [], handlers: { onSessionProposal: value => visible.push(value.id), onProposalInvalid: value => invalid.push(value.code) } });
  for (const value of [
    proposal(201, { eip155: { chains: [WALLETCONNECT_CHAIN], methods: ["eth_sign"], events: [] } }),
    proposal(202, { solana: { chains: ["solana:mainnet"], methods: [], events: [] } }, { eip155: { chains: [WALLETCONNECT_CHAIN], methods: ["personal_sign"], events: [] } }),
    proposal(203, {}, { eip155: { chains: ["eip155:1"], methods: ["personal_sign"], events: [] } }),
    proposal(204, { eip155: { chains: [], methods: [], events: [] } }),
  ]) handlers.get("session_proposal")(value);
  assert.deepEqual(visible, []);
  assert.deepEqual(invalid, Array(4).fill("UNSUPPORTED_WALLETCONNECT_NAMESPACE"));
});
