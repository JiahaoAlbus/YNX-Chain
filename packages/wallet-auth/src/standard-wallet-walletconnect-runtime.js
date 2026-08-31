export * from "./standard-wallet-walletconnect.js";
export * from "./standard-wallet-walletconnect-storage.js";

import { StandardWalletProviderEngine } from "./standard-wallet-provider-engine.js";
import { StandardWalletWalletConnectSessionAdapter } from "./standard-wallet-walletconnect.js";
import { validateStandardWalletPermissionStorage } from "./standard-wallet-permission-storage.js";
import { validateStandardWalletWalletConnectSessionStorage, walletConnectTopic } from "./standard-wallet-walletconnect-storage.js";

export const STANDARD_WALLET_WALLETCONNECT_READINESS_VERSION = "standard-wallet-walletconnect-runtime-readiness-v1";

export function preflightStandardWalletWalletConnectRuntime(config) {
  const exact = object(config) ? config : {};
  const capabilities = Object.freeze({
    permissionStorage: validStorage(validateStandardWalletPermissionStorage, exact.permissionStorage),
    sessionStorage: validStorage(validateStandardWalletWalletConnectSessionStorage, exact.sessionStorage),
    relayEventSink: typeof exact.emit === "function",
    rpcTransport: typeof exact.rpcTransport === "function",
    accountApproval: Array.isArray(exact.walletAccounts) && typeof exact.approveAccounts === "function",
    personalSignConfirmation: typeof exact.signMessage === "function",
    typedDataConfirmation: typeof exact.signTypedData === "function",
    transactionConfirmation: typeof exact.sendTransaction === "function",
  });
  return Object.freeze({
    version: STANDARD_WALLET_WALLETCONNECT_READINESS_VERSION,
    ready: Object.values(capabilities).every(Boolean),
    authorityCreated: false,
    callbacksInvoked: false,
    capabilities,
  });
}

export function createStandardWalletWalletConnectRuntime(config) {
  if (!object(config)) throw new TypeError("WalletConnect runtime configuration is invalid");
  const readiness = preflightStandardWalletWalletConnectRuntime(config);
  if (!readiness.ready) throw new TypeError("WalletConnect runtime capability preflight failed");
  const topic = walletConnectTopic(config.topic);
  const engine = new StandardWalletProviderEngine({ ...config, origin: `walletconnect:${topic}` });
  const adapter = new StandardWalletWalletConnectSessionAdapter({ engine, topic, sessionStorage: config.sessionStorage, emit: config.emit });
  let started = false;
  return Object.freeze({
    readiness,
    engine,
    adapter,
    async start() { if (started) return adapter.active; await adapter.restore(); started = true; return adapter.active; },
    async approve(proposal) { if (!started) throw new Error("WalletConnect runtime is not started"); return adapter.approve(proposal); },
    async reject(proposal) { if (!started) throw new Error("WalletConnect runtime is not started"); return adapter.reject(proposal); },
    async request(envelope) { if (!started) throw new Error("WalletConnect runtime is not started"); return adapter.request(envelope); },
    async disconnect() { if (!started) throw new Error("WalletConnect runtime is not started"); return adapter.disconnect(); },
    close() { started = false; return adapter.close(); },
  });
}

function validStorage(validate, value) {
  try { return validate(value) !== null; } catch { return false; }
}
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
