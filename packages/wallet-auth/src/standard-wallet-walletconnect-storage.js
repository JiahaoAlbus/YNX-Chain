import { canonicalJSON } from "./canonical.js";
import { encodeBase64url } from "./base64url.js";
import { normalizeStandardWalletAddress } from "./standard-wallet-provider-events.js";
import { providerError } from "./standard-wallet-provider-common.js";

export const STANDARD_WALLET_WALLETCONNECT_SESSION_VERSION = 1;
export const STANDARD_WALLET_WALLETCONNECT_CHAIN = "eip155:6423";

export function createStandardWalletWalletConnectSessionSnapshot({ topic, methods, events, accounts }) {
  const exactTopic = walletConnectTopic(topic);
  const exactMethods = exactStrings(methods, "WalletConnect methods");
  const exactEvents = exactStrings(events, "WalletConnect events");
  if (!Array.isArray(accounts) || accounts.length < 1 || accounts.length > 1024) throw providerError(4100, "WalletConnect session accounts are invalid");
  const exactAccounts = accounts.map(normalizeStandardWalletAddress);
  if (new Set(exactAccounts).size !== exactAccounts.length) throw providerError(4100, "WalletConnect session accounts contain duplicates");
  return Object.freeze({
    schemaVersion: STANDARD_WALLET_WALLETCONNECT_SESSION_VERSION,
    topic: exactTopic,
    chainId: STANDARD_WALLET_WALLETCONNECT_CHAIN,
    methods: Object.freeze(exactMethods),
    events: Object.freeze(exactEvents),
    accounts: Object.freeze(exactAccounts),
  });
}

export function parseStandardWalletWalletConnectSessionSnapshot(input, expectedTopic) {
  const value = typeof input === "string" ? parseJson(input) : input;
  if (!object(value) || Object.keys(value).sort().join(",") !== "accounts,chainId,events,methods,schemaVersion,topic" || value.schemaVersion !== STANDARD_WALLET_WALLETCONNECT_SESSION_VERSION || value.chainId !== STANDARD_WALLET_WALLETCONNECT_CHAIN) throw providerError(4100, "WalletConnect session snapshot is invalid");
  const snapshot = createStandardWalletWalletConnectSessionSnapshot(value);
  if (snapshot.topic !== walletConnectTopic(expectedTopic)) throw providerError(4100, "WalletConnect session snapshot belongs to another topic");
  if (typeof input === "string" && `${canonicalJSON(snapshot)}\n` !== input) throw providerError(4100, "WalletConnect session snapshot is not canonical JSON");
  return snapshot;
}

export function serializeStandardWalletWalletConnectSessionSnapshot(snapshot) {
  return `${canonicalJSON(parseStandardWalletWalletConnectSessionSnapshot(snapshot, snapshot?.topic))}\n`;
}

export class InMemoryStandardWalletWalletConnectSessionStorage {
  #records = new Map();
  async load({ topic }) { return this.#records.get(walletConnectTopic(topic)) ?? null; }
  async save(snapshot) { const exact = parseStandardWalletWalletConnectSessionSnapshot(snapshot, snapshot?.topic); this.#records.set(exact.topic, serializeStandardWalletWalletConnectSessionSnapshot(exact)); }
  async clear({ topic }) { this.#records.delete(walletConnectTopic(topic)); }
}

export function validateStandardWalletWalletConnectSessionStorage(value) {
  if (value === undefined || value === null) return null;
  if (!object(value) || typeof value.load !== "function" || typeof value.save !== "function" || typeof value.clear !== "function") throw new TypeError("WalletConnect session storage is invalid");
  return value;
}

export function createStandardWalletWalletConnectSessionStorageAdapter(config) {
  if (!object(config) || Object.keys(config).some((key) => !["namespace", "getItem", "setItem", "removeItem"].includes(key))) throw new TypeError("WalletConnect platform storage configuration is invalid");
  const namespace = config.namespace ?? "ynx.standard-wallet.walletconnect.v1";
  if (typeof namespace !== "string" || !/^[a-z][a-z0-9.-]{2,63}$/.test(namespace)) throw new TypeError("WalletConnect platform storage namespace is invalid");
  for (const name of ["getItem", "setItem", "removeItem"]) if (typeof config[name] !== "function") throw new TypeError(`WalletConnect platform storage ${name} callback is required`);
  const key = (topic) => `${namespace}.${encodeBase64url(new TextEncoder().encode(walletConnectTopic(topic)))}`;
  return Object.freeze({
    async load({ topic }) {
      const value = await config.getItem(key(topic));
      if (value !== null && value !== undefined && typeof value !== "string") throw providerError(4100, "WalletConnect platform storage returned invalid bytes");
      return value ?? null;
    },
    async save(snapshot) {
      const exact = parseStandardWalletWalletConnectSessionSnapshot(snapshot, snapshot?.topic);
      await config.setItem(key(exact.topic), serializeStandardWalletWalletConnectSessionSnapshot(exact));
    },
    async clear({ topic }) { await config.removeItem(key(topic)); },
  });
}

export function walletConnectTopic(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new TypeError("WalletConnect topic is invalid");
  return value;
}

function exactStrings(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128 || value.some((item) => typeof item !== "string" || !/^[A-Za-z0-9_:.-]{1,96}$/.test(item)) || new Set(value).size !== value.length) throw providerError(4100, `${label} are invalid`);
  return [...value].sort();
}
function parseJson(value) { try { return JSON.parse(value); } catch { throw providerError(4100, "WalletConnect session snapshot is invalid JSON"); } }
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
