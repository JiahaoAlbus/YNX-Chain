export * from "./standard-wallet-walletconnect.js";
export * from "./standard-wallet-walletconnect-storage.js";

import { StandardWalletProviderEngine } from "./standard-wallet-provider-engine.js";
import { StandardWalletWalletConnectSessionAdapter } from "./standard-wallet-walletconnect.js";
import { walletConnectTopic } from "./standard-wallet-walletconnect-storage.js";

export function createStandardWalletWalletConnectRuntime(config) {
  if (!object(config)) throw new TypeError("WalletConnect runtime configuration is invalid");
  const topic = walletConnectTopic(config.topic);
  const engine = new StandardWalletProviderEngine({ ...config, origin: `walletconnect:${topic}` });
  const adapter = new StandardWalletWalletConnectSessionAdapter({ engine, topic, sessionStorage: config.sessionStorage, emit: config.emit });
  let started = false;
  return Object.freeze({
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

function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
