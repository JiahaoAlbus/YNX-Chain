import { canonicalJSON, digestHex, isPlainObject, WalletAuthError } from "./canonical.js";

export const WALLETCONNECT_PROTOCOL_VERSION = 2;
export const WALLETCONNECT_NAMESPACE = "eip155";
export const WALLETCONNECT_CHAIN = "eip155:6423";
export const WALLETCONNECT_CHAIN_QUANTITY = "0x1917";
export const WALLETCONNECT_SESSION_METHODS = Object.freeze([
  "eth_accounts", "eth_requestAccounts", "eth_chainId", "personal_sign", "eth_signTypedData_v4",
  "eth_sendTransaction", "wallet_switchEthereumChain", "wallet_addEthereumChain",
]);
export const WALLETCONNECT_SESSION_EVENTS = Object.freeze(["accountsChanged", "chainChanged"]);
export const WALLETCONNECT_REJECTION = Object.freeze({
  USER_REJECTED: Object.freeze({ code: 5000, message: "User rejected the session" }),
  UNSUPPORTED_CHAINS: Object.freeze({ code: 5100, message: "Requested chains are not supported" }),
  UNSUPPORTED_METHODS: Object.freeze({ code: 5101, message: "Requested methods are not supported" }),
  UNSUPPORTED_EVENTS: Object.freeze({ code: 5102, message: "Requested events are not supported" }),
  UNSUPPORTED_ACCOUNTS: Object.freeze({ code: 5103, message: "Requested accounts are not supported" }),
  UNSUPPORTED_NAMESPACE: Object.freeze({ code: 5104, message: "Requested namespace is not supported" }),
});

const HEX_32 = /^[0-9a-f]{64}$/;
const EVM_ACCOUNT = /^0x[0-9a-f]{40}$/;
const MAX_URI_BYTES = 2048;
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const MAX_REQUEST_LIFETIME_SECONDS = 5 * 60;

export function parseWalletConnectRuntimeConfig(input) {
  const value = record(input, ["projectId"], ["relayUrl"], "WalletConnect runtime configuration");
  const projectId = text(value.projectId, "projectId", /^[0-9a-f]{32}$/);
  const relayUrl = Object.hasOwn(value, "relayUrl") ? canonicalURL(value.relayUrl, "relayUrl", ["wss:"]) : "wss://relay.walletconnect.com";
  return Object.freeze({ projectId, relayUrl });
}

export function parseWalletConnectPairingUri(input, at = new Date()) {
  authorityTime(at);
  if (typeof input !== "string" || input.length < 1 || utf8Length(input) > MAX_URI_BYTES || input.trim() !== input) fail("INVALID_WALLETCONNECT_URI", "WalletConnect pairing URI is invalid");
  const match = /^wc:([0-9a-f]{64})@([0-9]+)\?([^#]+)$/.exec(input);
  if (!match || Number(match[2]) !== WALLETCONNECT_PROTOCOL_VERSION) fail("UNSUPPORTED_WALLETCONNECT_VERSION", "WalletConnect pairing URI must use protocol version 2");
  const searchParams = new URLSearchParams(match[3]);
  if (searchParams.toString() !== match[3]) fail("INVALID_WALLETCONNECT_URI", "WalletConnect pairing URI must be canonical");
  const entries = [...searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) fail("INVALID_WALLETCONNECT_URI", "WalletConnect pairing URI has duplicate parameters");
  const allowed = new Set(["relay-protocol", "symKey", "expiryTimestamp"]);
  if (entries.some(([key]) => !allowed.has(key)) || !searchParams.has("relay-protocol") || !searchParams.has("symKey")) fail("INVALID_WALLETCONNECT_URI", "WalletConnect pairing URI parameters are invalid");
  if (searchParams.get("relay-protocol") !== "irn") fail("UNSUPPORTED_WALLETCONNECT_RELAY", "WalletConnect pairing URI requires the irn relay protocol");
  const symKey = text(searchParams.get("symKey"), "symKey", HEX_32);
  const expiryTimestamp = searchParams.has("expiryTimestamp") ? unixSeconds(searchParams.get("expiryTimestamp"), "expiryTimestamp") : null;
  if (expiryTimestamp !== null && expiryTimestamp <= Math.floor(at.getTime() / 1000)) fail("EXPIRED_WALLETCONNECT_PAIRING", "WalletConnect pairing URI has expired");
  return Object.freeze({ topic: match[1], version: 2, relayProtocol: "irn", symKey, expiryTimestamp });
}

/** Convert an SDK session_proposal event into a frozen user-review draft.
 * The result is never an approval and cannot be passed as an active session. */
export function reviewWalletConnectSessionProposal(input, options) {
  const now = authorityTime(options?.now);
  const account = evmAccount(options?.account);
  const event = record(input, ["id", "params", "verifyContext"], [], "WalletConnect session proposal");
  const id = positiveId(event.id, "proposal id");
  const verification = verifyContext(event.verifyContext);
  const params = record(event.params, ["id", "expiryTimestamp", "relays", "proposer", "requiredNamespaces", "optionalNamespaces", "pairingTopic"], ["expiry", "sessionProperties", "scopedProperties", "attestation", "encryptedId", "requests"], "WalletConnect proposal parameters");
  if (params.id !== id) fail("WALLETCONNECT_ID_MISMATCH", "WalletConnect proposal event and payload IDs do not match");
  text(params.pairingTopic, "pairingTopic", HEX_32);
  if (Object.hasOwn(params, "expiry") && unixSeconds(params.expiry, "expiry") !== params.expiryTimestamp) fail("INVALID_WALLETCONNECT_EXPIRY", "WalletConnect proposal expiry fields do not match");
  if (Object.hasOwn(params, "sessionProperties")) stringRecord(params.sessionProperties, "sessionProperties");
  if (Object.hasOwn(params, "scopedProperties")) bounded(safeJSON(params.scopedProperties, "scopedProperties"));
  if (Object.hasOwn(params, "attestation")) boundedText(params.attestation, "attestation", 4096);
  if (Object.hasOwn(params, "encryptedId")) boundedText(params.encryptedId, "encryptedId", 4096);
  if (Object.hasOwn(params, "requests")) fail("WALLETCONNECT_UNSUPPORTED_METHODS", "WalletConnect authentication and wallet-pay proposal requests are not supported");
  const expiryTimestamp = unixSeconds(params.expiryTimestamp, "expiryTimestamp");
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (expiryTimestamp <= nowSeconds || expiryTimestamp - nowSeconds > MAX_SESSION_LIFETIME_SECONDS) fail("INVALID_WALLETCONNECT_EXPIRY", "WalletConnect proposal expiry must be in the future and no more than seven days away");
  const relays = relayProtocols(params.relays);
  const peer = proposer(params.proposer);
  if (verification.validation === "VALID" && new URL(peer.metadata.url).origin !== verification.origin) fail("UNSAFE_WALLETCONNECT_ORIGIN", "WalletConnect verified origin does not match peer metadata");
  const required = namespaces(params.requiredNamespaces, true);
  const optional = Object.hasOwn(params, "optionalNamespaces") ? namespaces(params.optionalNamespaces, false) : emptyNamespaceSet();
  const methods = sortedUnique([...required.methods, ...optional.methods]);
  const events = sortedUnique([...required.events, ...optional.events]);
  const chains = sortedUnique([...required.chains, ...optional.chains]);
  if (!chains.includes(WALLETCONNECT_CHAIN)) fail("WALLETCONNECT_UNSUPPORTED_CHAINS", "WalletConnect proposal does not request YNX Testnet eip155:6423");
  const namespacesValue = Object.freeze({
    eip155: Object.freeze({ chains: Object.freeze([WALLETCONNECT_CHAIN]), methods: Object.freeze(methods), events: Object.freeze(events), accounts: Object.freeze([`${WALLETCONNECT_CHAIN}:${account}`]) }),
  });
  const review = {
    kind: "walletconnect_session_review", protocolVersion: 2, proposalId: id, expiryTimestamp,
    peer, verification, relays, namespaces: namespacesValue, account, requiresUserApproval: true,
  };
  return Object.freeze({ ...review, proposalDigest: digestHex("YNX_WALLETCONNECT_SESSION_PROPOSAL_V1", review) });
}

/** Requires a separate explicit UI decision. Merely reviewing cannot create a session. */
export function createWalletConnectSessionApproval(reviewInput, decision, at = new Date()) {
  const now = authorityTime(at);
  const review = parseSessionReview(reviewInput);
  const choice = record(decision, ["approved", "topic"], [], "WalletConnect session decision");
  if (choice.approved !== true) fail("WALLETCONNECT_USER_REJECTED", "WalletConnect session was not explicitly approved");
  const topic = text(choice.topic, "topic", HEX_32);
  if (review.expiryTimestamp <= Math.floor(now.getTime() / 1000)) fail("EXPIRED_WALLETCONNECT_SESSION", "WalletConnect session proposal has expired");
  const approval = {
    kind: "walletconnect_session_approval", protocolVersion: 2, topic, proposalId: review.proposalId,
    proposalDigest: review.proposalDigest, peer: review.peer, verification: review.verification, relays: review.relays,
    namespaces: review.namespaces, account: review.account, approvedAt: now.toISOString(), expiresAt: new Date(review.expiryTimestamp * 1000).toISOString(),
  };
  return Object.freeze({ ...approval, sessionBinding: digestHex("YNX_WALLETCONNECT_SESSION_APPROVAL_V1", approval) });
}

/** Parse and bind one session_request. Every supported method returns review
 * material only; this layer never signs, submits, switches or exposes accounts. */
export function createWalletConnectRequestReview(input, options) {
  const now = authorityTime(options?.now);
  const session = parseSessionApproval(options?.session);
  const replayStore = options?.replayStore;
  if (!(replayStore instanceof WalletConnectRequestReplayStore)) fail("WALLETCONNECT_REPLAY_STORE_REQUIRED", "A durable WalletConnect request replay store is required");
  const event = record(input, ["topic", "id", "params", "verifyContext"], [], "WalletConnect session request");
  const topic = text(event.topic, "topic", HEX_32);
  const id = positiveId(event.id, "request id");
  const verification = verifyContext(event.verifyContext);
  if (session.verification.validation !== verification.validation || session.verification.origin !== verification.origin) fail("UNSAFE_WALLETCONNECT_ORIGIN", "WalletConnect request origin does not match the approved session");
  const paramsEnvelope = record(event.params, ["chainId", "request"], [], "WalletConnect request parameters");
  const request = record(paramsEnvelope.request, ["method", "params"], ["expiryTimestamp"], "WalletConnect JSON-RPC request");
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const sessionExpiry = Math.floor(Date.parse(session.expiresAt) / 1000);
  const expiryTimestamp = Object.hasOwn(request, "expiryTimestamp") ? unixSeconds(request.expiryTimestamp, "expiryTimestamp") : Math.min(sessionExpiry, nowSeconds + MAX_REQUEST_LIFETIME_SECONDS);
  const expirySource = Object.hasOwn(request, "expiryTimestamp") ? "request" : "bounded-default";
  if (session.topic !== topic) fail("WALLETCONNECT_TOPIC_MISMATCH", "WalletConnect request topic does not match the approved session");
  if (session.expiresAt <= now.toISOString()) fail("EXPIRED_WALLETCONNECT_SESSION", "WalletConnect session has expired");
  if (expiryTimestamp <= nowSeconds || expiryTimestamp - nowSeconds > MAX_REQUEST_LIFETIME_SECONDS || new Date(expiryTimestamp * 1000).toISOString() > session.expiresAt) fail("INVALID_WALLETCONNECT_EXPIRY", "WalletConnect request expiry is invalid or exceeds its approved session");
  if (paramsEnvelope.chainId !== WALLETCONNECT_CHAIN) fail("WALLETCONNECT_UNSUPPORTED_CHAINS", "WalletConnect request must target eip155:6423");
  const method = text(request.method, "method", /^[A-Za-z][A-Za-z0-9_]{1,63}$/);
  if (!session.namespaces.eip155.methods.includes(method) || !WALLETCONNECT_SESSION_METHODS.includes(method)) fail("WALLETCONNECT_UNSUPPORTED_METHODS", "WalletConnect request method was not approved for this session");
  const params = methodParams(method, request.params, session.account);
  const review = {
    kind: "walletconnect_request_review", protocolVersion: 2, topic, requestId: id,
    sessionBinding: session.sessionBinding, chainId: WALLETCONNECT_CHAIN, account: session.account,
    peer: session.peer, verification, method, params, expirySource, expiresAt: new Date(expiryTimestamp * 1000).toISOString(), requiresUserApproval: true,
  };
  bounded(review);
  const frozen = Object.freeze({ ...review, requestDigest: digestHex("YNX_WALLETCONNECT_REQUEST_REVIEW_V1", review) });
  replayStore.reserve(frozen, now);
  return frozen;
}

export function finalizeWalletConnectRequestReview(reviewInput, decision, replayStore, at = new Date()) {
  const now = authorityTime(at);
  if (!(replayStore instanceof WalletConnectRequestReplayStore)) fail("WALLETCONNECT_REPLAY_STORE_REQUIRED", "A durable WalletConnect request replay store is required");
  const review = parseRequestReview(reviewInput);
  const choice = record(decision, ["approved"], [], "WalletConnect request decision");
  if (typeof choice.approved !== "boolean") fail("INVALID_WALLETCONNECT_DECISION", "WalletConnect request decision must be explicit");
  if (review.expiresAt <= now.toISOString()) fail("EXPIRED_WALLETCONNECT_REQUEST", "WalletConnect request has expired");
  replayStore.consume(review, now);
  return Object.freeze({
    kind: "walletconnect_request_decision", requestDigest: review.requestDigest, topic: review.topic, requestId: review.requestId,
    approved: choice.approved, decidedAt: now.toISOString(),
    // Approval authorizes the application to proceed to its separate signer or
    // chain adapter. This object contains no signature or transaction result.
    executionAuthorized: choice.approved,
  });
}

export class WalletConnectRequestReplayStore {
  constructor(snapshot = []) {
    if (!Array.isArray(snapshot) || snapshot.length > 10_000) fail("INVALID_WALLETCONNECT_REPLAY_STATE", "WalletConnect replay snapshot is invalid");
    this.records = new Map();
    for (const entry of snapshot) {
      const value = record(entry, ["key", "requestDigest", "expiresAt", "status"], [], "WalletConnect replay record");
      if (!/^[0-9a-f]{64}:[1-9][0-9]{0,15}$/.test(value.key) || !HEX_32.test(value.requestDigest) || !["reserved", "consumed"].includes(value.status)) fail("INVALID_WALLETCONNECT_REPLAY_STATE", "WalletConnect replay record is invalid");
      timestamp(value.expiresAt, "expiresAt");
      if (this.records.has(value.key)) fail("INVALID_WALLETCONNECT_REPLAY_STATE", "WalletConnect replay snapshot contains duplicates");
      this.records.set(value.key, Object.freeze({ ...value }));
    }
  }
  reserve(review, at = new Date()) {
    authorityTime(at); this.prune(at);
    const value = parseRequestReview(review), key = requestKey(value);
    if (this.records.has(key)) fail("WALLETCONNECT_REPLAY", "WalletConnect request was already reviewed");
    this.records.set(key, Object.freeze({ key, requestDigest: value.requestDigest, expiresAt: value.expiresAt, status: "reserved" }));
  }
  consume(review, at = new Date()) {
    authorityTime(at); this.prune(at);
    const value = parseRequestReview(review), key = requestKey(value), existing = this.records.get(key);
    if (!existing || existing.status !== "reserved" || existing.requestDigest !== value.requestDigest) fail("WALLETCONNECT_REPLAY", "WalletConnect request is missing, changed or already consumed");
    this.records.set(key, Object.freeze({ ...existing, status: "consumed" }));
  }
  prune(at = new Date()) {
    const iso = authorityTime(at).toISOString();
    for (const [key, value] of this.records) if (value.expiresAt <= iso) this.records.delete(key);
  }
  snapshot() { return Object.freeze([...this.records.values()].sort((a, b) => a.key.localeCompare(b))); }
}

export function walletConnectRejection(error) {
  const code = error instanceof WalletAuthError ? error.code : "";
  const value = code === "WALLETCONNECT_UNSUPPORTED_CHAINS" ? WALLETCONNECT_REJECTION.UNSUPPORTED_CHAINS
    : code === "WALLETCONNECT_UNSUPPORTED_METHODS" ? WALLETCONNECT_REJECTION.UNSUPPORTED_METHODS
      : code === "WALLETCONNECT_UNSUPPORTED_EVENTS" ? WALLETCONNECT_REJECTION.UNSUPPORTED_EVENTS
        : code === "WALLETCONNECT_UNSUPPORTED_ACCOUNTS" ? WALLETCONNECT_REJECTION.UNSUPPORTED_ACCOUNTS
          : code === "WALLETCONNECT_UNSUPPORTED_NAMESPACE" ? WALLETCONNECT_REJECTION.UNSUPPORTED_NAMESPACE
            : WALLETCONNECT_REJECTION.USER_REJECTED;
  return Object.freeze({ ...value });
}

function namespaces(input, required) {
  if (!isPlainObject(input)) fail("INVALID_WALLETCONNECT_NAMESPACES", "WalletConnect namespaces must be a JSON object");
  const keys = Object.keys(input);
  if (keys.length > 1) fail("WALLETCONNECT_UNSUPPORTED_NAMESPACE", "Only the eip155 namespace is supported");
  if (keys.length === 0) {
    if (required) return emptyNamespaceSet();
    return emptyNamespaceSet();
  }
  const key = keys[0];
  if (key !== WALLETCONNECT_NAMESPACE && key !== WALLETCONNECT_CHAIN) fail(key.startsWith("eip155:") ? "WALLETCONNECT_UNSUPPORTED_CHAINS" : "WALLETCONNECT_UNSUPPORTED_NAMESPACE", "Only YNX Testnet eip155:6423 is supported");
  const value = record(input[key], ["methods", "events"], ["chains"], "WalletConnect eip155 namespace");
  let chains = Object.hasOwn(value, "chains") ? stringArray(value.chains, "chains", /^eip155:[1-9][0-9]*$/, 8) : [key];
  if (key === WALLETCONNECT_NAMESPACE && !Object.hasOwn(value, "chains")) fail("WALLETCONNECT_UNSUPPORTED_CHAINS", "The eip155 namespace must declare eip155:6423");
  if (chains.some(chain => chain !== WALLETCONNECT_CHAIN)) fail("WALLETCONNECT_UNSUPPORTED_CHAINS", "Only YNX Testnet eip155:6423 is supported");
  chains = sortedUnique(chains);
  const methods = sortedUnique(stringArray(value.methods, "methods", /^[A-Za-z][A-Za-z0-9_]{1,63}$/, 32, 0));
  const events = sortedUnique(stringArray(value.events, "events", /^[A-Za-z][A-Za-z0-9_]{1,63}$/, 16, 0));
  if (methods.some(method => !WALLETCONNECT_SESSION_METHODS.includes(method))) fail("WALLETCONNECT_UNSUPPORTED_METHODS", "WalletConnect proposal requests an unsupported method");
  if (events.some(event => !WALLETCONNECT_SESSION_EVENTS.includes(event))) fail("WALLETCONNECT_UNSUPPORTED_EVENTS", "WalletConnect proposal requests an unsupported event");
  return { chains, methods, events };
}

function methodParams(method, input, account) {
  input = safeArray(input, "WalletConnect request parameters", 0, 8);
  if (["eth_accounts", "eth_requestAccounts", "eth_chainId"].includes(method)) { if (input.length !== 0) fail("INVALID_WALLETCONNECT_PARAMS", `${method} does not accept parameters`); return Object.freeze([]); }
  if (method === "personal_sign") {
    if (input.length !== 2 || !hexData(input[0], 64 * 1024) || evmAccount(input[1]) !== account) fail("WALLETCONNECT_ACCOUNT_MISMATCH", "personal_sign must bind the reviewed message to the approved account");
    return Object.freeze([input[0].toLowerCase(), account]);
  }
  if (method === "eth_signTypedData_v4") {
    if (input.length !== 2 || evmAccount(input[0]) !== account || typeof input[1] !== "string" || utf8Length(input[1]) > MAX_REQUEST_BYTES) fail("WALLETCONNECT_ACCOUNT_MISMATCH", "Typed-data signing must bind to the approved account");
    let typed; try { typed = JSON.parse(input[1]); } catch { fail("INVALID_WALLETCONNECT_TYPED_DATA", "Typed data is not valid JSON"); }
    if (!isPlainObject(typed) || !isPlainObject(typed.domain) || ![6423, "6423", WALLETCONNECT_CHAIN_QUANTITY].includes(typed.domain.chainId)) fail("WALLETCONNECT_UNSUPPORTED_CHAINS", "Typed-data domain must bind to YNX Testnet chain 6423");
    bounded(typed);
    return Object.freeze([account, input[1]]);
  }
  if (method === "eth_sendTransaction") {
    if (input.length !== 1) fail("INVALID_WALLETCONNECT_TRANSACTION", "eth_sendTransaction requires one transaction");
    const tx = record(input[0], ["from", "to"], ["value", "data", "gas", "gasPrice", "nonce", "chainId"], "WalletConnect transaction");
    if (evmAccount(tx.from) !== account) fail("WALLETCONNECT_ACCOUNT_MISMATCH", "Transaction sender does not match the approved account");
    const normalized = { from: account, to: evmAccount(tx.to) };
    for (const key of ["value", "gas", "gasPrice", "nonce"]) if (Object.hasOwn(tx, key)) normalized[key] = quantity(tx[key], key);
    if (Object.hasOwn(tx, "data")) { if (!hexData(tx.data, 64 * 1024)) fail("INVALID_WALLETCONNECT_TRANSACTION", "Transaction data is invalid"); normalized.data = tx.data.toLowerCase(); }
    if (Object.hasOwn(tx, "chainId")) { if (tx.chainId !== WALLETCONNECT_CHAIN_QUANTITY) fail("WALLETCONNECT_UNSUPPORTED_CHAINS", "Transaction chainId must be 0x1917"); normalized.chainId = WALLETCONNECT_CHAIN_QUANTITY; }
    return Object.freeze([Object.freeze(normalized)]);
  }
  if (method === "wallet_switchEthereumChain") {
    const value = singleRecord(input, ["chainId"], [], method);
    if (value.chainId !== WALLETCONNECT_CHAIN_QUANTITY) fail("WALLETCONNECT_UNSUPPORTED_CHAINS", "Wallet may only switch to YNX Testnet 0x1917");
    return Object.freeze([Object.freeze({ chainId: WALLETCONNECT_CHAIN_QUANTITY })]);
  }
  if (method === "wallet_addEthereumChain") {
    const value = singleRecord(input, ["chainId", "chainName", "nativeCurrency", "rpcUrls", "blockExplorerUrls"], [], method);
    const currency = record(value.nativeCurrency, ["name", "symbol", "decimals"], [], "WalletConnect native currency");
    if (value.chainId !== WALLETCONNECT_CHAIN_QUANTITY || value.chainName !== "YNX Testnet" || currency.name !== "YNX Testnet" || currency.symbol !== "YNXT" || currency.decimals !== 18) fail("WALLETCONNECT_UNSUPPORTED_CHAINS", "Added network metadata must exactly identify YNX Testnet");
    const rpcUrls = stringArray(value.rpcUrls, "rpcUrls", /^https:\/\//, 4).map(url => canonicalURL(url, "rpcUrl", ["https:"]));
    if (!rpcUrls.includes("https://rpc-testnet.ynxweb4.com")) fail("WALLETCONNECT_UNSUPPORTED_CHAINS", "YNX Testnet canonical RPC URL is required");
    const explorers = stringArray(value.blockExplorerUrls, "blockExplorerUrls", /^https:\/\//, 4).map(url => canonicalURL(url, "blockExplorerUrl", ["https:"]));
    return Object.freeze([Object.freeze({ chainId: WALLETCONNECT_CHAIN_QUANTITY, chainName: "YNX Testnet", nativeCurrency: Object.freeze({ name: "YNX Testnet", symbol: "YNXT", decimals: 18 }), rpcUrls: Object.freeze(rpcUrls), blockExplorerUrls: Object.freeze(explorers) })]);
  }
  fail("WALLETCONNECT_UNSUPPORTED_METHODS", "WalletConnect request method is unsupported");
}

function parseSessionReview(input) {
  const value = record(input, ["kind", "protocolVersion", "proposalId", "expiryTimestamp", "peer", "verification", "relays", "namespaces", "account", "requiresUserApproval", "proposalDigest"], [], "WalletConnect session review");
  if (value.kind !== "walletconnect_session_review" || value.protocolVersion !== 2 || value.requiresUserApproval !== true) fail("INVALID_WALLETCONNECT_REVIEW", "WalletConnect session review is invalid");
  positiveId(value.proposalId, "proposal id"); unixSeconds(value.expiryTimestamp, "expiryTimestamp");
  normalizedPeer(value.peer); normalizedVerification(value.verification); normalizedRelays(value.relays);
  const account = evmAccount(value.account); normalizedNamespaces(value.namespaces, account);
  text(value.proposalDigest, "proposalDigest", HEX_32);
  const unsigned = { ...value }; delete unsigned.proposalDigest;
  if (value.proposalDigest !== digestHex("YNX_WALLETCONNECT_SESSION_PROPOSAL_V1", unsigned)) fail("INVALID_WALLETCONNECT_REVIEW", "WalletConnect session review digest does not match");
  return value;
}
function parseSessionApproval(input) {
  const value = record(input, ["kind", "protocolVersion", "topic", "proposalId", "proposalDigest", "peer", "verification", "relays", "namespaces", "account", "approvedAt", "expiresAt", "sessionBinding"], [], "WalletConnect session approval");
  if (value.kind !== "walletconnect_session_approval" || value.protocolVersion !== 2) fail("INVALID_WALLETCONNECT_SESSION", "WalletConnect session approval is invalid");
  text(value.topic, "topic", HEX_32); positiveId(value.proposalId, "proposal id"); text(value.proposalDigest, "proposalDigest", HEX_32);
  normalizedPeer(value.peer); normalizedVerification(value.verification); normalizedRelays(value.relays);
  const account = evmAccount(value.account); normalizedNamespaces(value.namespaces, account);
  const approvedAt = timestamp(value.approvedAt, "approvedAt"), expiresAt = timestamp(value.expiresAt, "expiresAt");
  if (expiresAt <= approvedAt) fail("INVALID_WALLETCONNECT_EXPIRY", "WalletConnect session expiry must follow approval");
  text(value.sessionBinding, "sessionBinding", HEX_32);
  const unsigned = { ...value }; delete unsigned.sessionBinding;
  if (value.sessionBinding !== digestHex("YNX_WALLETCONNECT_SESSION_APPROVAL_V1", unsigned)) fail("INVALID_WALLETCONNECT_SESSION", "WalletConnect session binding does not match");
  return value;
}
function parseRequestReview(input) {
  const value = record(input, ["kind", "protocolVersion", "topic", "requestId", "sessionBinding", "chainId", "account", "peer", "verification", "method", "params", "expirySource", "expiresAt", "requiresUserApproval", "requestDigest"], [], "WalletConnect request review");
  if (value.kind !== "walletconnect_request_review" || value.protocolVersion !== 2 || value.chainId !== WALLETCONNECT_CHAIN || value.requiresUserApproval !== true) fail("INVALID_WALLETCONNECT_REVIEW", "WalletConnect request review is invalid");
  text(value.topic, "topic", HEX_32); positiveId(value.requestId, "request id"); text(value.sessionBinding, "sessionBinding", HEX_32);
  const account = evmAccount(value.account); normalizedPeer(value.peer); normalizedVerification(value.verification);
  const method = text(value.method, "method", /^[A-Za-z][A-Za-z0-9_]{1,63}$/);
  if (!WALLETCONNECT_SESSION_METHODS.includes(method)) fail("WALLETCONNECT_UNSUPPORTED_METHODS", "WalletConnect request method is unsupported");
  methodParams(method, value.params, account);
  if (!["request", "bounded-default"].includes(value.expirySource)) fail("INVALID_WALLETCONNECT_EXPIRY", "WalletConnect request expiry source is invalid");
  timestamp(value.expiresAt, "expiresAt"); text(value.requestDigest, "requestDigest", HEX_32);
  const unsigned = { ...value }; delete unsigned.requestDigest;
  if (value.requestDigest !== digestHex("YNX_WALLETCONNECT_REQUEST_REVIEW_V1", unsigned)) fail("INVALID_WALLETCONNECT_REVIEW", "WalletConnect request review digest does not match");
  return value;
}
function proposer(input) {
  const value = record(input, ["publicKey", "metadata"], [], "WalletConnect proposer");
  const metadata = record(value.metadata, ["name", "description", "url", "icons"], ["verifyUrl", "redirect"], "WalletConnect peer metadata");
  if (Object.hasOwn(metadata, "verifyUrl")) canonicalURL(metadata.verifyUrl, "peer verifyUrl", ["https:"]);
  if (Object.hasOwn(metadata, "redirect")) redirectMetadata(metadata.redirect);
  const result = { publicKey: text(value.publicKey, "proposer publicKey", HEX_32), metadata: Object.freeze({
    name: boundedText(metadata.name, "peer name", 128), description: boundedText(metadata.description, "peer description", 512),
    url: canonicalURL(metadata.url, "peer url", ["https:"]), icons: Object.freeze(stringArray(metadata.icons, "peer icons", /^https:\/\//, 8).map(url => canonicalURL(url, "peer icon", ["https:"]))),
  }) };
  return Object.freeze(result);
}
function relayProtocols(input) {
  const array = safeArray(input, "WalletConnect proposal relay list", 1, 4);
  const values = array.map(item => { const value = record(item, ["protocol"], ["data"], "WalletConnect relay"); if (value.protocol !== "irn") fail("UNSUPPORTED_WALLETCONNECT_RELAY", "Only the irn WalletConnect relay is supported"); if (Object.hasOwn(value, "data")) boundedText(value.data, "relay data", 512); return "irn"; });
  return Object.freeze(sortedUnique(values));
}
function normalizedPeer(input) {
  const value = record(input, ["publicKey", "metadata"], [], "WalletConnect reviewed peer");
  text(value.publicKey, "peer publicKey", HEX_32);
  const metadata = record(value.metadata, ["name", "description", "url", "icons"], [], "WalletConnect reviewed peer metadata");
  boundedText(metadata.name, "peer name", 128); boundedText(metadata.description, "peer description", 512);
  canonicalURL(metadata.url, "peer url", ["https:"]); stringArray(metadata.icons, "peer icons", /^https:\/\//, 8).forEach(url => canonicalURL(url, "peer icon", ["https:"]));
}
function normalizedVerification(input) {
  const value = record(input, ["origin", "validation", "verifyUrl", "isScam"], [], "WalletConnect reviewed verification");
  if (!["UNKNOWN", "VALID"].includes(value.validation) || value.isScam !== false) fail("INVALID_WALLETCONNECT_VERIFY_CONTEXT", "WalletConnect reviewed verification is invalid");
  if (value.origin === "") { if (value.validation !== "UNKNOWN") fail("INVALID_WALLETCONNECT_VERIFY_CONTEXT", "Verified origin is missing"); } else canonicalOrigin(value.origin, "verified origin");
  if (value.verifyUrl !== "") canonicalURL(value.verifyUrl, "verified verifyUrl", ["https:"]);
}
function normalizedRelays(input) { const values = stringArray(input, "relays", /^irn$/, 4); if (values.length !== 1 || values[0] !== "irn") fail("UNSUPPORTED_WALLETCONNECT_RELAY", "Only one irn relay is supported"); }
function normalizedNamespaces(input, account) {
  const root = record(input, ["eip155"], [], "WalletConnect reviewed namespaces");
  const value = record(root.eip155, ["chains", "methods", "events", "accounts"], [], "WalletConnect reviewed eip155 namespace");
  const chains = stringArray(value.chains, "chains", /^eip155:[1-9][0-9]*$/, 1);
  if (chains.length !== 1 || chains[0] !== WALLETCONNECT_CHAIN) fail("WALLETCONNECT_UNSUPPORTED_CHAINS", "Only YNX Testnet eip155:6423 is supported");
  const methods = stringArray(value.methods, "methods", /^[A-Za-z][A-Za-z0-9_]{1,63}$/, 32, 0);
  if (methods.some(method => !WALLETCONNECT_SESSION_METHODS.includes(method))) fail("WALLETCONNECT_UNSUPPORTED_METHODS", "WalletConnect namespace includes an unsupported method");
  const events = stringArray(value.events, "events", /^[A-Za-z][A-Za-z0-9_]{1,63}$/, 16, 0);
  if (events.some(event => !WALLETCONNECT_SESSION_EVENTS.includes(event))) fail("WALLETCONNECT_UNSUPPORTED_EVENTS", "WalletConnect namespace includes an unsupported event");
  const accounts = stringArray(value.accounts, "accounts", /^eip155:6423:0x[0-9a-f]{40}$/, 1);
  if (accounts.length !== 1 || accounts[0] !== `${WALLETCONNECT_CHAIN}:${account}`) fail("WALLETCONNECT_UNSUPPORTED_ACCOUNTS", "WalletConnect namespace account does not match the approved account");
}
function verifyContext(input) {
  const context = record(input, ["verified"], [], "WalletConnect verification context");
  const verified = record(context.verified, ["origin", "validation", "verifyUrl"], ["isScam"], "WalletConnect verified origin");
  if (!["UNKNOWN", "VALID", "INVALID"].includes(verified.validation) || typeof verified.isScam !== "undefined" && typeof verified.isScam !== "boolean") fail("INVALID_WALLETCONNECT_VERIFY_CONTEXT", "WalletConnect verification context is invalid");
  if (verified.validation === "INVALID" || verified.isScam === true) fail("UNSAFE_WALLETCONNECT_ORIGIN", "WalletConnect Verify flagged this origin as invalid or a scam");
  const origin = verified.origin === "" && verified.validation === "UNKNOWN" ? "" : canonicalOrigin(verified.origin, "verified origin");
  const verifyUrl = verified.verifyUrl === "" ? "" : canonicalURL(verified.verifyUrl, "verified verifyUrl", ["https:"]);
  return Object.freeze({ origin, validation: verified.validation, verifyUrl, isScam: verified.isScam === true });
}
function redirectMetadata(input) {
  const value = record(input, [], ["native", "universal", "linkMode"], "WalletConnect redirect metadata");
  if (Object.hasOwn(value, "native")) canonicalRedirect(value.native, "native redirect");
  if (Object.hasOwn(value, "universal")) canonicalURL(value.universal, "universal redirect", ["https:"]);
  if (Object.hasOwn(value, "linkMode") && typeof value.linkMode !== "boolean") fail("INVALID_WALLETCONNECT_URL", "WalletConnect linkMode must be boolean");
}
function stringRecord(input, label) {
  if (!isPlainObject(input) || Reflect.ownKeys(input).some(key => typeof key !== "string") || Reflect.ownKeys(input).length !== Object.keys(input).length || Object.keys(input).length > 64) fail("INVALID_WALLETCONNECT_FIELD", `${label} is invalid`);
  for (const key of Object.keys(input)) { const descriptor = Object.getOwnPropertyDescriptor(input, key); if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("INVALID_SHAPE", `${label} cannot contain accessors`); text(key, label, /^[A-Za-z0-9._:-]{1,128}$/); boundedText(descriptor.value, label, 1024); }
}
function emptyNamespaceSet() { return { chains: [], methods: [], events: [] }; }
function requestKey(value) { return `${value.topic}:${value.requestId}`; }
function singleRecord(input, required, optional, label) { if (!Array.isArray(input) || input.length !== 1) fail("INVALID_WALLETCONNECT_PARAMS", `${label} requires one parameter`); return record(input[0], required, optional, label); }
function record(value, required, optional, label) {
  if (!isPlainObject(value)) fail("INVALID_SHAPE", `${label} must be a JSON object`);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== "string") || keys.length !== Object.keys(value).length) fail("INVALID_SHAPE", `${label} contains hidden fields`);
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !allowed.has(key))) fail("UNKNOWN_OR_MISSING_FIELD", `${label} fields do not match the protocol schema`);
  const out = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("INVALID_SHAPE", `${label} cannot contain accessors`); out[key] = descriptor.value; }
  return out;
}
function text(value, label, pattern) { if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) fail("INVALID_WALLETCONNECT_FIELD", `${label} is invalid`); return value; }
function boundedText(value, label, max) { if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > max) fail("INVALID_WALLETCONNECT_FIELD", `${label} is invalid`); return value; }
function evmAccount(value) { return text(value, "account", EVM_ACCOUNT); }
function positiveId(value, label) { if (!Number.isSafeInteger(value) || value < 1) fail("INVALID_WALLETCONNECT_ID", `${label} must be a positive safe integer`); return value; }
function unixSeconds(value, label) { const number = typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : value; if (!Number.isSafeInteger(number) || number < 1 || number > 9_999_999_999) fail("INVALID_WALLETCONNECT_EXPIRY", `${label} is invalid`); return number; }
function timestamp(value, label) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("INVALID_WALLETCONNECT_TIME", `${label} is invalid`); return value; }
function authorityTime(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "A valid authority time is required"); return new Date(value.getTime()); }
function canonicalURL(value, label, protocols) { let url; try { url = new URL(value); } catch { fail("INVALID_WALLETCONNECT_URL", `${label} is invalid`); } const exact = url.toString() === value || url.origin === value && url.pathname === "/" && !url.search; if (!protocols.includes(url.protocol) || url.username || url.password || url.hash || !exact) fail("INVALID_WALLETCONNECT_URL", `${label} must be canonical`); return value; }
function canonicalOrigin(value, label) { let url; try { url = new URL(value); } catch { fail("INVALID_WALLETCONNECT_URL", `${label} is invalid`); } if (url.protocol !== "https:" || url.origin !== value || url.username || url.password) fail("INVALID_WALLETCONNECT_URL", `${label} must be an exact HTTPS origin`); return value; }
function canonicalRedirect(value, label) { let url; try { url = new URL(value); } catch { fail("INVALID_WALLETCONNECT_URL", `${label} is invalid`); } if (!/^[a-z][a-z0-9+.-]*:$/.test(url.protocol) || ["javascript:", "data:", "file:"].includes(url.protocol) || url.username || url.password || url.hash || url.toString() !== value) fail("INVALID_WALLETCONNECT_URL", `${label} must be canonical`); return value; }
function stringArray(value, label, pattern, maximum, minimum = 1) { const array = safeArray(value, label, minimum, maximum); const out = array.map(item => text(item, label, pattern)); if (new Set(out).size !== out.length) fail("INVALID_WALLETCONNECT_FIELD", `${label} contains duplicates`); return out; }
function sortedUnique(value) { return [...new Set(value)].sort(); }
function quantity(value, label) { if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) fail("INVALID_WALLETCONNECT_TRANSACTION", `${label} must be a canonical hexadecimal quantity`); return value; }
function hexData(value, maximumBytes) { return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(value) && (value.length - 2) / 2 <= maximumBytes; }
function bounded(value) { if (utf8Length(canonicalJSON(value)) > MAX_REQUEST_BYTES) fail("WALLETCONNECT_REQUEST_TOO_LARGE", "WalletConnect request exceeds 128 KiB"); }
function utf8Length(value) { let bytes = 0; for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); if (code < 0x80) bytes++; else if (code < 0x800) bytes += 2; else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; } else bytes += 3; } return bytes; }
function safeArray(value, label, minimum = 0, maximum = 1024) { if (!Array.isArray(value) || value.length < minimum || value.length > maximum || Reflect.ownKeys(value).some(key => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)))) fail("INVALID_WALLETCONNECT_FIELD", `${label} is invalid`); const out = []; for (let index = 0; index < value.length; index++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("INVALID_SHAPE", `${label} cannot contain holes or accessors`); out.push(descriptor.value); } return out; }
function safeJSON(value, label, seen = new Set()) { if (value === null || typeof value === "string" || typeof value === "boolean" || Number.isSafeInteger(value)) return value; if (seen.has(value)) fail("INVALID_SHAPE", `${label} contains a cycle`); seen.add(value); if (Array.isArray(value)) { const out = safeArray(value, label).map(item => safeJSON(item, label, seen)); seen.delete(value); return out; } if (!isPlainObject(value) || Reflect.ownKeys(value).some(key => typeof key !== "string") || Reflect.ownKeys(value).length !== Object.keys(value).length) fail("INVALID_SHAPE", `${label} is not plain JSON`); const out = {}; for (const key of Object.keys(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("INVALID_SHAPE", `${label} cannot contain accessors`); out[key] = safeJSON(descriptor.value, label, seen); } seen.delete(value); return out; }
function fail(code, message) { throw new WalletAuthError(code, message); }
