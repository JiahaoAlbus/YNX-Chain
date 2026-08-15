import {WALLET_WEB_COMPANION_CALLBACK} from "./core-auth-consumer.js";

export const WEB_COMPANION_STATE = Object.freeze({
  DISCONNECTED: "disconnected", CONNECTING: "connecting", CONNECTED: "connected",
  NETWORK_UNAVAILABLE: "network-unavailable", RETRY_REQUIRED: "retry-required",
});

const unavailable = (reason) => Object.freeze({
  status: WEB_COMPANION_STATE.NETWORK_UNAVAILABLE,
  code: "CANONICAL_AUTH_UNAVAILABLE",
  message: reason,
  authoritative: false,
  account: false,
  sign: false,
  sendTransaction: false,
});

function assertClient(client) {
  if (!client || ["beginDetected", "handleReturn", "disconnect", "restore"].some((name) => typeof client[name] !== "function")) {
    throw Object.assign(new Error("A frozen Core RecoverableProductSessionClient is required."), {code: "INVALID_CORE_RUNTIME"});
  }
}

function sanitize(result) {
  if (!result || typeof result.status !== "string") throw Object.assign(new Error("Core runtime returned an invalid state."), {code: "INVALID_CORE_RUNTIME_STATE"});
  return Object.freeze({
    status: result.status,
    message: String(result.message || ""),
    authoritative: result.status === WEB_COMPANION_STATE.CONNECTED,
    route: result.status === WEB_COMPANION_STATE.CONNECTING && result.route?.status === "ready" ? result.route.url : null,
    rejected: result.status === WEB_COMPANION_STATE.DISCONNECTED && /rejected/i.test(String(result.message || "")),
    account: false,
    sign: false,
    sendTransaction: false,
  });
}

/** Thin Web-owner adapter over Core's frozen RecoverableProductSessionClient. */
export function createWalletWebCompanionLifecycle({binding, client = null, open = null}) {
  const ready = binding?.publicGatewayRegistryReady === true && binding?.trustedRuntimeAvailable === true;
  const fail = () => unavailable("The public Gateway registry or trusted Core runtime is not ready; no Product Session was created.");
  const requireReady = () => { if (!ready) return false; assertClient(client); return true; };
  return Object.freeze({
    callback: WALLET_WEB_COMPANION_CALLBACK,
    publicAuthAvailable: ready,
    async begin() {
      if (!requireReady()) return fail();
      const state = sanitize(await client.beginDetected(false));
      if (state.route && typeof open === "function") await open(state.route);
      return state;
    },
    async handleReturn(url) {
      if (!requireReady()) return fail();
      let parsed;
      try { parsed = new URL(url); } catch { return unavailable("Wallet callback URL is invalid."); }
      if (`${parsed.origin}${parsed.pathname}` !== WALLET_WEB_COMPANION_CALLBACK) return unavailable("Wallet callback did not match the frozen Web companion callback.");
      return sanitize(await client.handleReturn(parsed.toString()));
    },
    async disconnect() {
      if (!requireReady()) return fail();
      return sanitize(await client.disconnect());
    },
    async restart(networkAvailable = true) {
      if (!requireReady()) return fail();
      return sanitize(await client.restore(networkAvailable === true));
    },
  });
}
