import { STANDARD_WALLET_PRIVATE_SERVICE } from "./standard-wallet-connect-state.js";
import { StandardWalletProviderEngine } from "./standard-wallet-provider-engine.js";

export const STANDARD_WALLET_RUNTIME_VERSION = "1.1.0-p0.0";
export const STANDARD_WALLET_RUNTIME_PLATFORMS = Object.freeze(["web", "android", "ios", "macos", "desktop"]);

export function createStandardWalletPlatformRuntime(config) {
  if (!object(config) || !STANDARD_WALLET_RUNTIME_PLATFORMS.includes(config.platform)) throw new TypeError("Standard Wallet runtime platform is invalid");
  const provider = new StandardWalletProviderEngine(config);
  let lifecycle = "created";
  let startPromise = null;

  async function start() {
    if (lifecycle === "ready") return snapshot();
    if (lifecycle === "stopped") throw new Error("Standard Wallet runtime is stopped");
    if (startPromise !== null) return startPromise;
    lifecycle = "starting";
    const operation = provider.restorePermissions().then(() => { lifecycle = "ready"; return snapshot(); }, (error) => { lifecycle = "failed"; throw error; });
    startPromise = operation;
    return operation;
  }

  function requireReady() { if (lifecycle !== "ready") throw new Error("Standard Wallet runtime is not ready"); }
  function snapshot() { return Object.freeze({ version: STANDARD_WALLET_RUNTIME_VERSION, platform: config.platform, lifecycle, provider: provider.state }); }

  return Object.freeze({
    platform: config.platform,
    provider,
    get state() { return snapshot(); },
    start,
    async request(input) { requireReady(); return provider.request(input); },
    async replaceWalletAccounts(accounts) { requireReady(); return provider.replaceWalletAccounts(accounts); },
    async notifyChainChanged(chainId) { requireReady(); return provider.notifyChainChanged(chainId); },
    async disconnect() { requireReady(); return provider.disconnect(); },
    setRpcStatus(status) { requireReady(); return provider.setRpcStatus(status); },
    setPrivateServiceStatus(status) { requireReady(); return provider.setPrivateServiceStatus(status); },
    stop() { lifecycle = "stopped"; return snapshot(); },
  });
}

export function markStandardWalletPrivateServiceDegraded(runtime) {
  if (!runtime || typeof runtime.setPrivateServiceStatus !== "function") throw new TypeError("Standard Wallet runtime is invalid");
  return runtime.setPrivateServiceStatus(STANDARD_WALLET_PRIVATE_SERVICE.DEGRADED);
}

function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
