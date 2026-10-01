import assert from "node:assert/strict";
import { test } from "node:test";
import { WalletConnectTransport, WALLETCONNECT_CHAIN, WALLETCONNECT_METHODS, WALLETCONNECT_EVENTS } from "../src/walletconnect-transport.mjs";
import { createECDH } from "node:crypto";
import { createProductSessionRequest, encodeRequestDeepLink } from "@ynx-chain/wallet-auth";
import { PRODUCT_SESSION_REGISTRY } from "../src/wallet-auth-contract.mjs";

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
async function fixture({ sessions = [session("topic-a"), session("topic-b", ACCOUNT_B)], pendingRequests = [],pendingProposals=[],pair=async()=>{},pairDeadlineMs=30000,store = storage(), disconnect = async () => {}, handlers: callbacks = {} } = {}) {
  const active = Object.fromEntries(sessions.map(value => [value.topic, value]));
  const handlers = new Map(), responses = [], events = [], approvals = [];
  const kit = {
    core: { storage: store, relayer: { connected: false },pairing:{getPairings:()=>[{topic:"c".repeat(64),expiry:NOW/1000+600}],disconnect:async()=>{}} },
    pair,rejectSession:async()=>{},getPendingSessionProposals:()=>pendingProposals,
    on(name, callback) { handlers.set(name, callback); },
    getActiveSessions() { return active; },
    getPendingSessionRequests() { return pendingRequests; },
    disconnectSession: disconnect,
    async respondSessionRequest(response) { responses.push(response); },
    async emitSessionEvent(event) { events.push(event); },
    async approveSession(input) { approvals.push(input); const approved = { ...session("approved-topic"), namespaces: input.namespaces }; active[approved.topic] = approved; return approved; }
  };
  const transport = new WalletConnectTransport({ projectId: "synthetic-project-id", metadata: { name: "Synthetic Wallet", url: "https://wallet.example" }, walletKitFactory: async () => kit, clock: () => NOW,pairDeadlineMs });
  await transport.start(callbacks);
  return { transport, kit, active, handlers, responses, events, approvals, store };
}
function code(expected) { return error => error?.code === expected; }

test("native Product Session requires the approved method, exact peer origin and selected session account",async()=>{
  const device=createECDH("prime256v1");device.setPrivateKey(Buffer.alloc(32,0x42));
  const product=createProductSessionRequest(PRODUCT_SESSION_REGISTRY,{productId:"creator-studio",platform:"web",deviceId:"pair-binding-test",deviceKey:device.getPublicKey(null,"compressed").toString("base64url"),nonce:"nonce_abcdefghijklmnopqrstuvwxyz12",state:"state_abcdefghijklmnopqrstuvwxyz12",scopes:["creator:account"],purpose:"Sign in to Creator Studio."},new Date(NOW));
  const approved=session("native-topic");approved.peer.metadata.url=product.origin;
  const {transport}=await fixture({sessions:[approved]});
  const event={topic:"native-topic",id:1,params:{chainId:WALLETCONNECT_CHAIN,request:{method:"ynx_requestProductSessionV2",params:[encodeRequestDeepLink(product)]}}};
  assert.equal(transport.authorizeRequest(event,ACCOUNT_A).origin,product.origin);
  assert.throws(()=>transport.authorizeRequest(event,ACCOUNT_B),code("UNAUTHORIZED_WALLETCONNECT_ACCOUNT"));
  approved.peer.metadata.url=ORIGIN;
  const wrong=await fixture({sessions:[approved]});
  assert.throws(()=>wrong.transport.authorizeRequest(event,ACCOUNT_A),code("PRODUCT_SESSION_ORIGIN_MISMATCH"));
  approved.peer.metadata.url=product.origin;approved.namespaces.eip155.methods=["personal_sign"];
  const notGranted=await fixture({sessions:[approved]});
  assert.throws(()=>notGranted.transport.authorizeRequest(event,ACCOUNT_A),code("UNAUTHORIZED_WALLETCONNECT_METHOD"));
});

test("cold startup reoffers SDK pending requests for fresh review without executing or approving", async () => {
  const pending = request("topic-a", "personal_sign", ACCOUNT_A);
  pending.params.request.expiryTimestamp = NOW / 1000 + 60;
  const received = [], { approvals, responses } = await fixture({ pendingRequests: [pending], handlers: { onSessionRequest: event => received.push(event) } });
  assert.equal(received.length, 1); assert.equal(received[0].restored, true);
  assert.deepEqual(received[0].params, pending.params);
  assert.deepEqual(approvals, []); assert.deepEqual(responses, []);
});

test("all signing methods require the requested account in this topic and selected in the Wallet", async () => {
  const { transport } = await fixture();
  for (const method of ["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"]) {
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
  return { id, verifyContext:{verified:{validation:"UNKNOWN",origin:"",verifyUrl:"",isScam:false}},params: {id,pairingTopic:"c".repeat(64),expiryTimestamp: NOW / 1000 + 600, proposer: { metadata: { name: "Synthetic DApp", url: ORIGIN } }, requiredNamespaces, optionalNamespaces } };
}

test("optional-only EIP155 proposals show and grant only supported Testnet permissions", async () => {
  const visible = [];
  const { transport, handlers, approvals } = await fixture({ sessions: [], handlers: { onSessionProposal: value => visible.push(value.id) } });
  await transport.pair(`wc:${"c".repeat(64)}@2?relay-protocol=irn&symKey=${"d".repeat(64)}`);
  await handlers.get("session_proposal")(proposal(101, {}, { eip155: { chains: ["eip155:1", WALLETCONNECT_CHAIN], methods: ["personal_sign", "eth_sign", "eth_sendTransaction"], events: ["accountsChanged", "unsupported-event"] }, solana: { chains: ["solana:mainnet"], methods: ["solana_signMessage"], events: [] } }));
  assert.deepEqual(visible, [101]);
  const review = transport.proposalPermissions(101);
  assert.deepEqual(review, { chains: [WALLETCONNECT_CHAIN], methods: ["personal_sign", "eth_sendTransaction"], events: ["accountsChanged"] });
  await transport.bindProposalAccount(101,ACCOUNT_A);await transport.approveSession(101, ACCOUNT_A);
  assert.deepEqual(approvals[0].namespaces.eip155, { ...review, accounts: [`${WALLETCONNECT_CHAIN}:${ACCOUNT_A}`] });
});

test("chain-qualified optional namespace is supported without widening required permissions", async () => {
  const { transport, handlers } = await fixture({ sessions: [] });
  await transport.pair(`wc:${"c".repeat(64)}@2?relay-protocol=irn&symKey=${"d".repeat(64)}`);
  await handlers.get("session_proposal")(proposal(102, {}, { [WALLETCONNECT_CHAIN]: { methods: ["personal_sign"], events: [] } }));
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
  ]) await handlers.get("session_proposal")(value);
  assert.deepEqual(visible, []);
  assert.deepEqual(invalid, Array(4).fill("UNSUPPORTED_WALLETCONNECT_NAMESPACE"));
});
const pairUri=topic=>`wc:${topic}@2?relay-protocol=irn&symKey=${"d".repeat(64)}`;
test("Desktop hung SDK Pair is bounded and cancel/late relay response cannot revive an old approval",async()=>{
 const deferred=Promise.withResolvers(),visible=[],f=await fixture({pair:()=>deferred.promise,pairDeadlineMs:8,handlers:{onSessionProposal:value=>visible.push(value)}});
 await assert.rejects(f.transport.pair(pairUri("c".repeat(64))),code("WALLETCONNECT_PAIR_TIMEOUT"));assert.equal(f.transport.status().pairing,false);assert.equal(f.transport.status().pair.phase,"timed-out");assert.equal(f.transport.sessions().length,2);
 await f.handlers.get("session_proposal")(proposal(501,{}, {eip155:{chains:[WALLETCONNECT_CHAIN],methods:["personal_sign"],events:[]}}));assert.deepEqual(visible,[]);
 deferred.resolve();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.transport.status().pair.phase,"timed-out");
 const next=Promise.withResolvers();f.kit.pair=()=>next.promise;const attempting=f.transport.pair(pairUri("e".repeat(64)));await new Promise(resolve=>setTimeout(resolve,0));f.transport.cancelPair();await assert.rejects(attempting,code("WALLETCONNECT_PAIR_CANCELED"));next.resolve();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.transport.status().pair.phase,"canceled");
});
test("Desktop original proposal survives lock/reopen for the same account, rejection stays terminal and a new QR can retry",async()=>{
 const store=storage(),f=await fixture({store,sessions:[]}),value=proposal(601,{}, {eip155:{chains:[WALLETCONNECT_CHAIN],methods:["personal_sign"],events:[]}});await f.transport.pair(pairUri("c".repeat(64)));await f.handlers.get("session_proposal")(value);await f.transport.bindProposalAccount(601,ACCOUNT_A);f.transport.cancelPair(true);
 const visible=[],cold=await fixture({store,sessions:[],pendingProposals:[value.params],handlers:{onSessionProposal:item=>visible.push(item)}});assert.equal(visible.length,1);await cold.transport.bindProposalAccount(601,ACCOUNT_A);assert.equal(cold.approvals.length,0);await cold.transport.rejectSession(601);
 const after=[],again=await fixture({store,sessions:[],pendingProposals:[value.params],handlers:{onSessionProposal:item=>after.push(item)}});assert.deepEqual(after,[]);assert.equal(again.approvals.length,0);
 await again.transport.pair(pairUri("e".repeat(64)));const retry=proposal(602,{}, {eip155:{chains:[WALLETCONNECT_CHAIN],methods:["personal_sign"],events:[]}});retry.params.pairingTopic="e".repeat(64);await again.handlers.get("session_proposal")(retry);assert.equal(after.length,1);await again.transport.bindProposalAccount(602,ACCOUNT_A);await again.transport.approveSession(602,ACCOUNT_A);assert.equal(again.approvals.length,1);
});
test("Desktop cold unknown/quarantined, missing/conflicting expiry and unsafe verification never approve",async()=>{
 const valid=proposal(701,{}, {eip155:{chains:[WALLETCONNECT_CHAIN],methods:["personal_sign"],events:[]}}),seen=[];await fixture({sessions:[],pendingProposals:[valid.params],handlers:{onSessionProposal:value=>seen.push(value)}});assert.deepEqual(seen,[]);
 const f=await fixture({sessions:[],handlers:{onSessionProposal:value=>seen.push(value)}});await f.transport.pair(pairUri("c".repeat(64)));for(const change of ["missing","conflict","invalid","scam"]){const value=structuredClone(valid);if(change==="missing")delete value.params.expiryTimestamp;if(change==="conflict")value.expiryTimestamp=value.params.expiryTimestamp+1;if(change==="invalid")value.verifyContext.verified.validation="INVALID";if(change==="scam")value.verifyContext.verified.isScam=true;await f.handlers.get("session_proposal")(value);}assert.deepEqual(seen,[]);assert.equal(f.approvals.length,0);
});
test("Desktop approval arriving after lock retires that exact session and cannot become current",async()=>{
 const f=await fixture({sessions:[]}),value=proposal(801,{}, {eip155:{chains:[WALLETCONNECT_CHAIN],methods:["personal_sign"],events:[]}});await f.transport.pair(pairUri("c".repeat(64)));await f.handlers.get("session_proposal")(value);await f.transport.bindProposalAccount(801,ACCOUNT_A);await f.transport.decideProposal(801,ACCOUNT_A);
 const deferred=Promise.withResolvers();f.kit.approveSession=()=>deferred.promise;let locked=false;const approving=f.transport.approveSession(801,ACCOUNT_A,()=>{if(locked)throw new Error("locked");});locked=true;deferred.resolve({...session("late-approved"),namespaces:{eip155:{accounts:[`${WALLETCONNECT_CHAIN}:${ACCOUNT_A}`],methods:["personal_sign"],events:[]}}});await assert.rejects(approving,/locked/);assert.throws(()=>f.transport.sessionOrigin("late-approved"));
});
