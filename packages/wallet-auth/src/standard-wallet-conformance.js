import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { METAMASK_EVM_CHAIN } from "./metamask-evm-adapter.js";
import { createStandardWalletConnectState, reduceStandardWalletConnectState, STANDARD_WALLET_CONNECT_STATUS, STANDARD_WALLET_PRIVATE_SERVICE } from "./standard-wallet-connect-state.js";
import { STANDARD_WALLET_CHAIN_ID } from "./standard-wallet-connect-state.js";

export const STANDARD_WALLET_CONFORMANCE_VERSION = "standardWalletConformance@1.0.0-p0.0";
export const STANDARD_WALLET_EVM_CHAIN_ID = 6423;
export const STANDARD_WALLET_EIP1193_METHODS = Object.freeze([
  "eth_chainId",
  "eth_accounts",
  "eth_requestAccounts",
  "wallet_addEthereumChain",
  "wallet_switchEthereumChain",
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
]);
export const STANDARD_WALLET_INTEROP_FIXTURE_VERSION = "standardWalletInteropFixture@1.0.0-p0.0";
export const STANDARD_WALLET_INTEROP_EVENT_SEQUENCE = Object.freeze(["ACCOUNTS_CHANGED", "CHAIN_CHANGED", "CHAIN_CHANGED", "ACCOUNTS_CHANGED", "PROVIDER_DISCONNECT"]);

// These are protocol profiles, not claims that the named external DApps were
// opened or approved in a browser. They keep the shared fixture honest while
// product owners gather independent public evidence.
export const STANDARD_WALLET_CONFORMANCE_PROFILES = Object.freeze([
  Object.freeze({ id: "ynx-first-party", class: "first-party", transport: "eip1193", requires: Object.freeze(["accounts", "chain", "events", "degraded-private-service"]) }),
  Object.freeze({ id: "uniswap-interface-reference", class: "external-reference", transport: "eip1193", requires: Object.freeze(["accounts", "chain", "transaction", "events"]) }),
  Object.freeze({ id: "opensea-reference", class: "external-reference", transport: "eip1193", requires: Object.freeze(["accounts", "siwe", "eip712", "events"]) }),
  Object.freeze({ id: "safe-reference", class: "external-reference", transport: "eip1193", requires: Object.freeze(["accounts", "chain", "eip712", "transaction", "events"]) }),
  Object.freeze({ id: "walletconnect-v2-reference", class: "transport-reference", transport: "walletconnect-eip1193", requires: Object.freeze(["accounts", "chain", "events"]) }),
]);

export function createStandardWalletSiweMessage(input) {
  exactFields(input, ["address", "domain", "issuedAt", "nonce", "statement", "uri"], "Standard Wallet SIWE message");
  const address = account(input.address), domain = hostname(input.domain), uri = httpsUrl(input.uri);
  const nonce = token(input.nonce, "SIWE nonce"), issuedAt = iso(input.issuedAt, "SIWE issuedAt"), statement = text(input.statement, "SIWE statement", 1, 180);
  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n${statement}\n\nURI: ${uri}\nVersion: 1\nChain ID: ${STANDARD_WALLET_EVM_CHAIN_ID}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}

export function createStandardWalletTypedData(input) {
  exactFields(input, ["account", "nonce", "origin", "purpose"], "Standard Wallet EIP-712 request");
  const accountValue = account(input.account), nonce = token(input.nonce, "typed-data nonce"), origin = httpsUrl(input.origin), purpose = text(input.purpose, "typed-data purpose", 1, 180);
  return deepFreeze({
    domain: { name: "YNX Wallet Standard Connection", version: "1", chainId: STANDARD_WALLET_EVM_CHAIN_ID },
    primaryType: "ConnectionIntent",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" },
      ],
      ConnectionIntent: [
        { name: "account", type: "address" }, { name: "origin", type: "string" }, { name: "purpose", type: "string" }, { name: "nonce", type: "string" },
      ],
    },
    message: { account: accountValue, origin, purpose, nonce },
  });
}

export function createStandardWalletTransactionRequest(input) {
  exactFields(input, ["from", "to", "value"], "Standard Wallet transaction request");
  return deepFreeze({ from: account(input.from), to: account(input.to), value: quantity(input.value) });
}

/**
 * Executes the normative sequence against an explicitly synthetic Provider.
 * `testHarness:true` is deliberate: this function is a source conformance
 * gate, not a route to invoke a user's real Wallet, signature or transaction.
 */
export async function runStandardWalletConformance(input) {
  exactFields(input, ["profileId", "provider", "siwe", "testHarness", "transaction", "typedData"], "Standard Wallet conformance input");
  if (input.testHarness !== true) fail("CONFORMANCE_HARNESS_REQUIRED", "Standard Wallet conformance may run only against an explicit test harness");
  const profile = STANDARD_WALLET_CONFORMANCE_PROFILES.find((item) => item.id === input.profileId);
  if (!profile) fail("UNKNOWN_CONFORMANCE_PROFILE", "Standard Wallet conformance profile is unknown");
  const provider = eip1193Provider(input.provider);
  const initialChain = chain(await request(provider, "eth_chainId"));
  const knownAccounts = accounts(await request(provider, "eth_accounts"));
  const approved = accounts(await request(provider, "eth_requestAccounts"));
  if (approved.length === 0) fail("NO_APPROVED_ACCOUNT", "Provider returned no approved account");
  const selectedAccount = approved[0];
  const chainId = chain(await request(provider, "eth_chainId"));
  if (chainId !== STANDARD_WALLET_CHAIN_ID) fail("WRONG_NETWORK", "Provider did not report YNX Testnet after approval");
  const siwe = createStandardWalletSiweMessage(input.siwe);
  const typedData = createStandardWalletTypedData({ ...input.typedData, account: selectedAccount });
  const transaction = createStandardWalletTransactionRequest({ ...input.transaction, from: selectedAccount });
  const personalSignature = signature(await request(provider, "personal_sign", [siwe, selectedAccount]));
  const typedSignature = signature(await request(provider, "eth_signTypedData_v4", [selectedAccount, canonicalJSON(typedData)]));
  const transactionHash = hash(await request(provider, "eth_sendTransaction", [transaction]));
  return deepFreeze({
    version: STANDARD_WALLET_CONFORMANCE_VERSION,
    profileId: profile.id,
    profileClass: profile.class,
    transport: profile.transport,
    initialChainId: initialChain,
    knownAccountCount: knownAccounts.length,
    selectedAccount,
    chainId,
    siwe: { message: siwe, signature: personalSignature },
    eip712: { typedData, signature: typedSignature },
    transaction: { request: transaction, hash: transactionHash },
    realWalletAuthority: false,
    externalDappRuntimeVerified: false,
    productConnectionVerified: false,
  });
}

/**
 * A stricter synthetic interop fixture. It proves the entire common EVM
 * sequence without contacting a browser profile, WalletConnect relay, or
 * Product Session. A caller must supply an explicit harness and event driver.
 */
export async function runStandardWalletInteropFixture(input) {
  exactFields(input, ["driveEvents", "profileId", "provider", "siwe", "testHarness", "transaction", "typedData"], "Standard Wallet interop fixture input");
  if (input.testHarness !== true) fail("CONFORMANCE_HARNESS_REQUIRED", "Standard Wallet interop fixture may run only against an explicit test harness");
  if (typeof input.driveEvents !== "function") fail("INTEROP_EVENT_DRIVER_REQUIRED", "Standard Wallet interop fixture requires an explicit event driver");
  const profile = STANDARD_WALLET_CONFORMANCE_PROFILES.find((item) => item.id === input.profileId);
  if (!profile) fail("UNKNOWN_CONFORMANCE_PROFILE", "Standard Wallet conformance profile is unknown");
  const provider = eip1193Provider(input.provider);
  const initialChainId = chain(await request(provider, "eth_chainId"));
  const knownAccounts = accounts(await request(provider, "eth_accounts"));
  const approved = accounts(await request(provider, "eth_requestAccounts"));
  if (approved.length === 0) fail("NO_APPROVED_ACCOUNT", "Provider returned no approved account");
  const selectedAccount = approved[0];
  const switched = await addAndSwitchFixtureChain(provider, initialChainId);
  const chainId = chain(await request(provider, "eth_chainId"));
  if (chainId !== STANDARD_WALLET_CHAIN_ID) fail("WRONG_NETWORK", "Provider did not report YNX Testnet after add/switch");
  const restoredAccounts = accounts(await request(provider, "eth_accounts"));
  if (restoredAccounts.length === 0 || restoredAccounts[0] !== selectedAccount) fail("RESTART_RESTORE_FAILED", "Provider did not restore the approved account");
  const siwe = createStandardWalletSiweMessage(input.siwe);
  const typedData = createStandardWalletTypedData({ ...input.typedData, account: selectedAccount });
  const transaction = createStandardWalletTransactionRequest({ ...input.transaction, from: selectedAccount });
  const personalSignature = signature(await request(provider, "personal_sign", [siwe, selectedAccount]));
  const typedSignature = signature(await request(provider, "eth_signTypedData_v4", [selectedAccount, canonicalJSON(typedData)]));
  const transactionHash = hash(await request(provider, "eth_sendTransaction", [transaction]));
  let state = reduceStandardWalletConnectState(createStandardWalletConnectState(), { type: "BEGIN", pendingIntent: "interop_fixture_connect_20260822" });
  state = reduceStandardWalletConnectState(state, { type: "PROVIDER_SELECTED", providerKind: profile.transport === "walletconnect-eip1193" ? "walletconnect" : "metamask" });
  state = reduceStandardWalletConnectState(state, { type: "ACCOUNT_APPROVED", account: selectedAccount });
  state = reduceStandardWalletConnectState(state, { type: "CHAIN_CONFIRMED", chainId });
  state = reduceStandardWalletConnectState(state, { type: "PRIVATE_SESSION_DEGRADED", code: "GATEWAY_UNAVAILABLE" });
  if (state.status !== STANDARD_WALLET_CONNECT_STATUS.CONNECTED || state.privateService !== STANDARD_WALLET_PRIVATE_SERVICE.DEGRADED) fail("PRIVATE_SERVICE_ISOLATION_FAILED", "Product Session degradation changed Standard Wallet connection");
  const eventTypes = [];
  await input.driveEvents((event) => {
    state = reduceStandardWalletConnectState(state, event);
    eventTypes.push(event.type);
  });
  if (eventTypes.length !== STANDARD_WALLET_INTEROP_EVENT_SEQUENCE.length || eventTypes.some((type, index) => type !== STANDARD_WALLET_INTEROP_EVENT_SEQUENCE[index])) fail("INVALID_INTEROP_EVENT_TRACE", "Standard Wallet interop event trace is incomplete");
  if (state.status !== STANDARD_WALLET_CONNECT_STATUS.DISCONNECTED || state.standardPermissions.length !== 0) fail("PERMISSION_REVOCATION_FAILED", "Standard Wallet permissions were not revoked after account removal/disconnect");
  return deepFreeze({
    version: STANDARD_WALLET_INTEROP_FIXTURE_VERSION,
    profileId: profile.id,
    profileClass: profile.class,
    transport: profile.transport,
    initialChainId,
    chainRecovery: switched,
    selectedAccount,
    chainId,
    restartRestore: { account: restoredAccounts[0], chainId },
    signatures: { personalSign: personalSignature, typedData: typedSignature },
    transaction: { request: transaction, hash: transactionHash },
    eventTrace: eventTypes,
    finalStatus: state.status,
    permissionsRevoked: true,
    privateServiceDegradedPreservedLayer1: true,
    realWalletAuthority: false,
    externalDappRuntimeVerified: false,
    walletConnectRelayVerified: false,
    productSessionUsed: false,
  });
}

async function addAndSwitchFixtureChain(provider, initialChainId) {
  if (initialChainId === STANDARD_WALLET_CHAIN_ID) fail("INTEROP_CHAIN_RECOVERY_NOT_EXERCISED", "Interop fixture must exercise canonical add/switch recovery");
  try { await rawRequest(provider, "wallet_switchEthereumChain", [{ chainId: STANDARD_WALLET_CHAIN_ID }]); }
  catch (error) {
    if (providerErrorCode(error) !== 4902) fail("CONFORMANCE_PROVIDER_ERROR", "Provider rejected chain switch outside the canonical missing-chain path");
    await request(provider, "wallet_addEthereumChain", [METAMASK_EVM_CHAIN]);
    await request(provider, "wallet_switchEthereumChain", [{ chainId: STANDARD_WALLET_CHAIN_ID }]);
    return "added-after-4902";
  }
  return "switched-existing-chain";
}

async function request(provider, method, params) {
  try { return await rawRequest(provider, method, params); }
  catch { fail("CONFORMANCE_PROVIDER_ERROR", "Standard Wallet test Provider failed closed"); }
}
async function rawRequest(provider, method, params) { return provider.request(params === undefined ? { method } : { method, params }); }
function providerErrorCode(error) { const value = safe(() => error?.code); return value === 4902 || value === "4902" ? 4902 : null; }
function eip1193Provider(value) { if (typeof value !== "object" || value === null || typeof safe(() => value.request) !== "function") fail("INVALID_STANDARD_WALLET_PROVIDER", "Standard Wallet conformance Provider is invalid"); return value; }
function accounts(value) { if (!Array.isArray(value) || value.length > 1024) fail("INVALID_WALLET_RESPONSE", "Provider returned an invalid account list"); return value.map(account); }
function account(value) { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) fail("INVALID_WALLET_RESPONSE", "Provider returned an invalid EVM account"); return value.toLowerCase(); }
function chain(value) { if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) fail("INVALID_WALLET_RESPONSE", "Provider returned an invalid chain quantity"); return value.toLowerCase(); }
function quantity(value) { if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) fail("INVALID_TRANSACTION_REQUEST", "Transaction value must be canonical quantity"); return value.toLowerCase(); }
function signature(value) { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value)) fail("INVALID_WALLET_RESPONSE", "Provider returned an invalid signature"); return value.toLowerCase(); }
function hash(value) { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail("INVALID_WALLET_RESPONSE", "Provider returned an invalid transaction hash"); return value.toLowerCase(); }
function hostname(value) { if (typeof value !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value)) fail("INVALID_SIWE_MESSAGE", "SIWE domain is invalid"); return value; }
function httpsUrl(value) { try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port || url.pathname !== "/" || url.search) throw new Error(); return url.origin; } catch { fail("INVALID_STANDARD_WALLET_ORIGIN", "Standard Wallet origin must be canonical HTTPS origin"); } }
function iso(value, label) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) fail("INVALID_STANDARD_WALLET_TIME", `Standard Wallet ${label} is invalid`); return value; }
function token(value, label) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) fail("INVALID_STANDARD_WALLET_TOKEN", `Standard Wallet ${label} is invalid`); return value; }
function text(value, label, min, max) { if (typeof value !== "string" || value.length < min || value.length > max || value.trim() !== value || /[\r\n\u0000]/.test(value)) fail("INVALID_STANDARD_WALLET_TEXT", `Standard Wallet ${label} is invalid`); return value; }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); } return value; }
function safe(read) { try { return read(); } catch { return undefined; } }
function fail(code, message) { throw new WalletAuthError(code, message); }
