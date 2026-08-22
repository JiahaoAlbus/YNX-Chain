import { canonicalJSON } from "./canonical.js";
import { StandardWalletProviderError } from "./standard-wallet-provider-common.js";
import { STANDARD_WALLET_PROVIDER_EVENTS } from "./standard-wallet-provider-events.js";
import { createStandardWalletPlatformRuntime } from "./standard-wallet-platform-runtime.js";

const NATIVE_PLATFORMS = Object.freeze(["android", "ios", "macos", "desktop"]);

export function createStandardWalletNativeBridge(config) {
  if (!object(config) || !NATIVE_PLATFORMS.includes(config.platform) || typeof config.emit !== "function") throw new TypeError("Standard Wallet native bridge configuration is invalid");
  const runtime = createStandardWalletPlatformRuntime(config);
  const listeners = new Map();
  for (const event of STANDARD_WALLET_PROVIDER_EVENTS) {
    const listener = (payload) => {
      try { config.emit(`${canonicalJSON({ jsonrpc: "2.0", method: "ynx_walletEvent", params: { event, payload } })}\n`); } catch {}
    };
    listeners.set(event, listener);
    runtime.provider.on(event, listener);
  }
  let stopped = false;

  return Object.freeze({
    platform: config.platform,
    runtime,
    async start() { if (stopped) throw new Error("Standard Wallet native bridge is stopped"); return runtime.start(); },
    async handle(message) {
      if (stopped) throw new Error("Standard Wallet native bridge is stopped");
      const envelope = parseEnvelope(message);
      try {
        const result = await runtime.request({ method: envelope.method, ...(envelope.params === undefined ? {} : { params: envelope.params }) });
        return `${canonicalJSON({ id: envelope.id, jsonrpc: "2.0", result })}\n`;
      } catch (error) {
        const exact = error instanceof StandardWalletProviderError ? error : new StandardWalletProviderError(-32603, "Standard Wallet request failed");
        return `${canonicalJSON({ error: { code: exact.code, data: exact.data, message: exact.message }, id: envelope.id, jsonrpc: "2.0" })}\n`;
      }
    },
    stop() {
      if (!stopped) for (const [event, listener] of listeners) runtime.provider.removeListener(event, listener);
      stopped = true;
      runtime.stop();
      return Object.freeze({ stopped: true });
    },
  });
}

function parseEnvelope(input) {
  let value = input;
  if (typeof input === "string") try { value = JSON.parse(input); } catch { throw new TypeError("Standard Wallet bridge request is invalid JSON"); }
  if (!object(value) || Object.keys(value).some((key) => !["id", "jsonrpc", "method", "params"].includes(key)) || value.jsonrpc !== "2.0" || (!Number.isSafeInteger(value.id) && (typeof value.id !== "string" || value.id.length < 1 || value.id.length > 128)) || typeof value.method !== "string") throw new TypeError("Standard Wallet bridge request envelope is invalid");
  return value;
}
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
