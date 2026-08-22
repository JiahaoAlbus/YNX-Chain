import { canonicalJSON } from "./canonical.js";
import { encodeBase64url } from "./base64url.js";
import { normalizeStandardWalletAddress } from "./standard-wallet-provider-events.js";
import { canonicalWalletOrigin, providerError } from "./standard-wallet-provider-common.js";

export const STANDARD_WALLET_PERMISSION_SNAPSHOT_VERSION = 1;

export function createStandardWalletPermissionSnapshot(origin, accounts) {
  const exactOrigin = canonicalWalletOrigin(origin);
  if (!Array.isArray(accounts) || accounts.length < 1 || accounts.length > 1024) throw providerError(4100, "Wallet permission snapshot account list is invalid");
  const normalized = accounts.map(normalizeStandardWalletAddress);
  if (new Set(normalized).size !== normalized.length) throw providerError(4100, "Wallet permission snapshot contains duplicate accounts");
  return Object.freeze({ schemaVersion: STANDARD_WALLET_PERMISSION_SNAPSHOT_VERSION, origin: exactOrigin, chainId: "0x1917", accounts: Object.freeze(normalized) });
}

export function parseStandardWalletPermissionSnapshot(input, expectedOrigin) {
  const value = typeof input === "string" ? parseJson(input) : input;
  if (!object(value) || Object.keys(value).sort().join(",") !== "accounts,chainId,origin,schemaVersion" || value.schemaVersion !== STANDARD_WALLET_PERMISSION_SNAPSHOT_VERSION || value.chainId !== "0x1917") throw providerError(4100, "Wallet permission snapshot is invalid");
  const snapshot = createStandardWalletPermissionSnapshot(value.origin, value.accounts);
  if (snapshot.origin !== canonicalWalletOrigin(expectedOrigin)) throw providerError(4100, "Wallet permission snapshot belongs to another origin");
  if (typeof input === "string" && `${canonicalJSON(snapshot)}\n` !== input) throw providerError(4100, "Wallet permission snapshot is not canonical JSON");
  return snapshot;
}

export function serializeStandardWalletPermissionSnapshot(snapshot) {
  return `${canonicalJSON(parseStandardWalletPermissionSnapshot(snapshot, snapshot?.origin))}\n`;
}

export class InMemoryStandardWalletPermissionStorage {
  #records = new Map();
  async load({ origin }) { return this.#records.get(canonicalWalletOrigin(origin)) ?? null; }
  async save(snapshot) { const exact = parseStandardWalletPermissionSnapshot(snapshot, snapshot?.origin); this.#records.set(exact.origin, serializeStandardWalletPermissionSnapshot(exact)); }
  async clear({ origin }) { this.#records.delete(canonicalWalletOrigin(origin)); }
}

export function validateStandardWalletPermissionStorage(value) {
  if (value === undefined || value === null) return null;
  if (!object(value) || typeof value.load !== "function" || typeof value.save !== "function" || typeof value.clear !== "function") throw new TypeError("Wallet permission storage is invalid");
  return value;
}

export function createStandardWalletPermissionStorageAdapter(config) {
  if (!object(config) || Object.keys(config).some((key) => !["namespace", "getItem", "setItem", "removeItem"].includes(key))) throw new TypeError("Wallet platform storage configuration is invalid");
  const namespace = config.namespace ?? "ynx.standard-wallet.permission.v1";
  if (typeof namespace !== "string" || !/^[a-z][a-z0-9.-]{2,63}$/.test(namespace)) throw new TypeError("Wallet platform storage namespace is invalid");
  for (const name of ["getItem", "setItem", "removeItem"]) if (typeof config[name] !== "function") throw new TypeError(`Wallet platform storage ${name} callback is required`);
  const key = (origin) => `${namespace}.${encodeBase64url(new TextEncoder().encode(canonicalWalletOrigin(origin)))}`;
  return Object.freeze({
    async load({ origin }) {
      const value = await config.getItem(key(origin));
      if (value !== null && value !== undefined && typeof value !== "string") throw providerError(4100, "Wallet platform storage returned invalid bytes");
      return value ?? null;
    },
    async save(snapshot) {
      const exact = parseStandardWalletPermissionSnapshot(snapshot, snapshot?.origin);
      await config.setItem(key(exact.origin), serializeStandardWalletPermissionSnapshot(exact));
    },
    async clear({ origin }) { await config.removeItem(key(origin)); },
  });
}

function parseJson(value) { try { return JSON.parse(value); } catch { throw providerError(4100, "Wallet permission snapshot is invalid JSON"); } }
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
