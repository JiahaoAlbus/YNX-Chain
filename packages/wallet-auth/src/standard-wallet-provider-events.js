export const STANDARD_WALLET_PROVIDER_EVENTS = Object.freeze(["connect", "disconnect", "accountsChanged", "chainChanged", "message"]);

export class StandardWalletProviderEventModel {
  #listeners = new Map(STANDARD_WALLET_PROVIDER_EVENTS.map((name) => [name, new Set()]));

  on(name, listener) {
    const listeners = this.#listeners.get(name);
    if (!listeners || typeof listener !== "function") throw new TypeError("Wallet provider event subscription is invalid");
    listeners.add(listener);
    return this;
  }

  removeListener(name, listener) {
    const listeners = this.#listeners.get(name);
    if (!listeners || typeof listener !== "function") throw new TypeError("Wallet provider event subscription is invalid");
    listeners.delete(listener);
    return this;
  }

  once(name, listener) {
    if (typeof listener !== "function") throw new TypeError("Wallet provider event subscription is invalid");
    const wrapped = (payload) => { this.removeListener(name, wrapped); listener(payload); };
    return this.on(name, wrapped);
  }

  listenerCount(name) { return this.#listeners.get(name)?.size ?? 0; }

  emit(name, payload) {
    const listeners = this.#listeners.get(name);
    if (!listeners) throw new TypeError("Wallet provider event is invalid");
    const exact = eventPayload(name, payload);
    for (const listener of [...listeners]) {
      try { listener(exact); } catch {}
    }
  }
}

function eventPayload(name, payload) {
  if (name === "accountsChanged") {
    if (!Array.isArray(payload) || payload.length > 1024) throw new TypeError("accountsChanged payload is invalid");
    return Object.freeze(payload.map(normalizeAddress));
  }
  if (name === "chainChanged") return normalizeChain(payload);
  if (name === "connect") {
    if (!object(payload) || Object.keys(payload).join(",") !== "chainId") throw new TypeError("connect payload is invalid");
    return Object.freeze({ chainId: normalizeChain(payload.chainId) });
  }
  if (name === "disconnect") {
    if (!object(payload) || !Number.isInteger(payload.code) || typeof payload.message !== "string") throw new TypeError("disconnect payload is invalid");
    return Object.freeze({ code: payload.code, message: payload.message.slice(0, 256) });
  }
  if (!object(payload) || typeof payload.type !== "string" || payload.type.length > 64) throw new TypeError("message payload is invalid");
  return Object.freeze({ type: payload.type, data: payload.data ?? null });
}

export function normalizeStandardWalletAddress(value) {
  return normalizeAddress(value);
}

export function normalizeStandardWalletChainId(value) {
  return normalizeChain(value);
}

function normalizeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new TypeError("Wallet account must be a 20-byte hexadecimal address");
  return value.toLowerCase();
}
function normalizeChain(value) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) throw new TypeError("Wallet chainId must be a canonical hexadecimal quantity");
  return value.toLowerCase();
}
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
