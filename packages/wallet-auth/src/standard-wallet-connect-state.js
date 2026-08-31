import { WalletAuthError } from "./canonical.js";

export const STANDARD_WALLET_CHAIN_ID = "0x1917";
export const STANDARD_WALLET_CONNECT_STATUS = Object.freeze({
  IDLE: "idle",
  DISCOVERING: "discovering",
  AWAITING_ACCOUNT: "awaiting-account",
  SWITCHING_CHAIN: "switching-chain",
  CONNECTED: "connected",
  WRONG_CHAIN: "wrong-chain",
  DISCONNECTED: "disconnected",
  FAILED: "failed",
});
export const STANDARD_WALLET_PRIVATE_SERVICE = Object.freeze({
  NOT_REQUESTED: "not-requested",
  CONNECTING: "connecting",
  READY: "ready",
  DEGRADED: "degraded",
});
export const STANDARD_WALLET_RPC_PROBE = Object.freeze({
  NOT_RUN: "not-run",
  READY: "ready",
  DEGRADED: "degraded",
});
export const STANDARD_WALLET_RPC_PROBE_TRANSPORT = "accepted-cors-safe";

const CONNECTED_ACTIONS = Object.freeze(["disconnect", "switch-account", "close"]);
const EMPTY = Object.freeze([]);

export function createStandardWalletConnectState() {
  return state({ status: STANDARD_WALLET_CONNECT_STATUS.IDLE });
}

/**
 * Sole product-consumable reducer for the Standard Wallet chooser lifecycle.
 * It owns no UI and never navigates. A product renders chooserOpen/mode and
 * restores focus to focusRestoreTarget after a terminal transition.
 */
export function reduceStandardWalletConnectState(current, event) {
  const previous = parseState(current);
  if (!object(event) || typeof event.type !== "string") fail("INVALID_STANDARD_WALLET_EVENT", "Standard Wallet transition event is invalid");
  switch (event.type) {
    case "BEGIN": {
      const pendingIntent = token(event.pendingIntent, "pendingIntent");
      return state({ status: STANDARD_WALLET_CONNECT_STATUS.DISCOVERING, chooserOpen: true, chooserMode: "connect", pendingIntent });
    }
    case "PROVIDER_SELECTED": {
      requirePending(previous);
      return state({ ...previous, status: STANDARD_WALLET_CONNECT_STATUS.AWAITING_ACCOUNT, providerKind: providerKind(event.providerKind) });
    }
    case "ACCOUNT_APPROVED": {
      if (previous.status !== STANDARD_WALLET_CONNECT_STATUS.AWAITING_ACCOUNT || previous.providerKind === null) fail("INVALID_STANDARD_WALLET_TRANSITION", "Account approval requires one selected provider");
      return state({ ...previous, status: STANDARD_WALLET_CONNECT_STATUS.SWITCHING_CHAIN, account: account(event.account) });
    }
    case "CHAIN_CONFIRMED": {
      if (previous.status !== STANDARD_WALLET_CONNECT_STATUS.SWITCHING_CHAIN || previous.providerKind === null || previous.account === null) fail("INVALID_STANDARD_WALLET_TRANSITION", "Chain confirmation requires an approved account");
      const chainId = chain(event.chainId);
      if (chainId !== STANDARD_WALLET_CHAIN_ID) return state({ ...previous, status: STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN, chainId, chooserOpen: true, chooserMode: "wrong-chain" });
      return connected(previous.providerKind, previous.account, previous.privateService);
    }
    case "RESTORE": {
      const kind = providerKind(event.providerKind), accounts = accountList(event.accounts), chainId = chain(event.chainId);
      if (accounts.length === 0) return disconnected("accounts-empty");
      if (chainId !== STANDARD_WALLET_CHAIN_ID) return state({ status: STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN, providerKind: kind, account: accounts[0], chainId, chooserOpen: false, chooserMode: "closed", focusRestoreTarget: "wallet-connect-trigger" });
      return connected(kind, accounts[0], STANDARD_WALLET_PRIVATE_SERVICE.NOT_REQUESTED);
    }
    case "OPEN_CHOOSER":
      if (previous.status === STANDARD_WALLET_CONNECT_STATUS.CONNECTED) return state({ ...previous, chooserOpen: true, chooserMode: "connection-details", chooserActions: CONNECTED_ACTIONS });
      return state({ ...previous, chooserOpen: true, chooserMode: previous.status === STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN ? "wrong-chain" : "connect" });
    case "CLOSE_CHOOSER":
      return state({ ...previous, chooserOpen: false, chooserMode: "closed", focusRestoreTarget: "wallet-connect-trigger" });
    case "PRIVATE_SESSION_CONNECTING":
      requireConnected(previous);
      return state({ ...previous, privateService: STANDARD_WALLET_PRIVATE_SERVICE.CONNECTING });
    case "PRIVATE_SESSION_READY":
      requireConnected(previous);
      return state({ ...previous, privateService: STANDARD_WALLET_PRIVATE_SERVICE.READY, privateServiceCode: null });
    case "PRIVATE_SESSION_DEGRADED":
      requireConnected(previous);
      return state({ ...previous, privateService: STANDARD_WALLET_PRIVATE_SERVICE.DEGRADED, privateServiceCode: safeCode(event.code), chooserOpen: false, chooserMode: "closed" });
    case "RPC_PROBE_READY":
      requireConnected(previous);
      requireAcceptedRpcProbe(event);
      return state({ ...previous, rpcProbe: STANDARD_WALLET_RPC_PROBE.READY, rpcProbeCode: null });
    case "RPC_PROBE_DEGRADED":
      requireConnected(previous);
      requireAcceptedRpcProbe(event);
      return state({ ...previous, rpcProbe: STANDARD_WALLET_RPC_PROBE.DEGRADED, rpcProbeCode: safeCode(event.code), chooserOpen: false, chooserMode: "closed" });
    case "ACCOUNTS_CHANGED": {
      const accounts = accountList(event.accounts);
      if (accounts.length === 0) return disconnected("accounts-empty");
      if (previous.status !== STANDARD_WALLET_CONNECT_STATUS.CONNECTED && previous.status !== STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN) fail("INVALID_STANDARD_WALLET_TRANSITION", "Account changes require a prior Wallet connection");
      return state({ ...previous, account: accounts[0] });
    }
    case "CHAIN_CHANGED": {
      if (previous.providerKind === null || previous.account === null) fail("INVALID_STANDARD_WALLET_TRANSITION", "Chain changes require a prior Wallet connection");
      const chainId = chain(event.chainId);
      // A connected provider that changes away from YNX Testnet must re-enter
      // the actionable switch-required state.  Silently closing the chooser
      // strands the user in a permissionless state with no canonical recovery
      // surface; it must never preserve Standard Wallet authority instead.
      if (chainId !== STANDARD_WALLET_CHAIN_ID) return state({ ...previous, status: STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN, chainId, standardPermissions: EMPTY, productAccess: "guest-or-public-only", chooserOpen: true, chooserMode: "wrong-chain", focusRestoreTarget: null });
      return connected(previous.providerKind, previous.account, previous.privateService);
    }
    case "PROVIDER_DISCONNECT":
    case "DISCONNECT":
      return disconnected(event.type === "PROVIDER_DISCONNECT" ? "provider-disconnect" : "user-disconnect");
    case "FAIL":
      return state({ status: STANDARD_WALLET_CONNECT_STATUS.FAILED, chooserOpen: true, chooserMode: "error", errorCode: safeCode(event.code), focusRestoreTarget: null });
    default:
      fail("INVALID_STANDARD_WALLET_EVENT", "Standard Wallet transition event is unknown");
  }
}

function connected(kind, approvedAccount, privateService) {
  return state({
    status: STANDARD_WALLET_CONNECT_STATUS.CONNECTED,
    providerKind: kind,
    account: approvedAccount,
    chainId: STANDARD_WALLET_CHAIN_ID,
    chooserOpen: false,
    chooserMode: "closed",
    chooserActions: CONNECTED_ACTIONS,
    pendingIntent: null,
    focusRestoreTarget: "wallet-connect-trigger",
    privateService,
    standardPermissions: Object.freeze(["account:read", "chain:read"]),
    productAccess: "standard-wallet-connected",
  });
}
function disconnected(reason) { return state({ status: STANDARD_WALLET_CONNECT_STATUS.DISCONNECTED, disconnectReason: reason, focusRestoreTarget: "wallet-connect-trigger" }); }
function state(input) {
  return Object.freeze({
    status: input.status,
    chooserOpen: input.chooserOpen ?? false,
    chooserMode: input.chooserMode ?? "closed",
    chooserActions: input.chooserActions ?? EMPTY,
    pendingIntent: input.pendingIntent ?? null,
    providerKind: input.providerKind ?? null,
    account: input.account ?? null,
    chainId: input.chainId ?? null,
    privateService: input.privateService ?? STANDARD_WALLET_PRIVATE_SERVICE.NOT_REQUESTED,
    privateServiceCode: input.privateServiceCode ?? null,
    rpcProbe: input.rpcProbe ?? STANDARD_WALLET_RPC_PROBE.NOT_RUN,
    rpcProbeCode: input.rpcProbeCode ?? null,
    standardPermissions: input.standardPermissions ?? EMPTY,
    productAccess: input.productAccess ?? "guest-or-public-only",
    focusRestoreTarget: input.focusRestoreTarget ?? null,
    errorCode: input.errorCode ?? null,
    disconnectReason: input.disconnectReason ?? null,
    authority: "standard-wallet-eip1193-state-only",
  });
}
function parseState(value) { if (!object(value) || value.authority !== "standard-wallet-eip1193-state-only" || !Object.values(STANDARD_WALLET_CONNECT_STATUS).includes(value.status)) fail("INVALID_STANDARD_WALLET_STATE", "Standard Wallet state is invalid"); return value; }
function requirePending(value) { if (value.status !== STANDARD_WALLET_CONNECT_STATUS.DISCOVERING || value.pendingIntent === null) fail("INVALID_STANDARD_WALLET_TRANSITION", "Provider selection requires a pending connection intent"); }
function requireConnected(value) { if (value.status !== STANDARD_WALLET_CONNECT_STATUS.CONNECTED || value.providerKind === null || value.account === null || value.chainId !== STANDARD_WALLET_CHAIN_ID) fail("INVALID_STANDARD_WALLET_TRANSITION", "Private service state requires a completed Standard Wallet connection"); }
function requireAcceptedRpcProbe(event) { if (event.probeTransport !== STANDARD_WALLET_RPC_PROBE_TRANSPORT) fail("UNSAFE_BROWSER_RPC_PROBE", "Standard Wallet connection state accepts only the accepted CORS-safe RPC probe transport"); }
function providerKind(value) { if (value !== "metamask" && value !== "ynx-wallet" && value !== "walletconnect") fail("INVALID_STANDARD_WALLET_PROVIDER", "Standard Wallet provider kind is invalid"); return value; }
function account(value) { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) fail("INVALID_STANDARD_WALLET_ACCOUNT", "Standard Wallet account is invalid"); return value.toLowerCase(); }
function accountList(value) { if (!Array.isArray(value) || value.length > 1024) fail("INVALID_STANDARD_WALLET_ACCOUNT", "Standard Wallet account list is invalid"); return value.map(account); }
function chain(value) { if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) fail("INVALID_STANDARD_WALLET_CHAIN", "Standard Wallet chain is invalid"); return value.toLowerCase(); }
function token(value, label) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) fail("INVALID_STANDARD_WALLET_INTENT", `Standard Wallet ${label} is invalid`); return value; }
function safeCode(value) { if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(value)) fail("INVALID_STANDARD_WALLET_ERROR", "Standard Wallet error code is invalid"); return value; }
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(code, message) { throw new WalletAuthError(code, message); }
