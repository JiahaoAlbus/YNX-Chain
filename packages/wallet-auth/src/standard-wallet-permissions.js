import { normalizeStandardWalletAddress } from "./standard-wallet-provider-events.js";

export const STANDARD_WALLET_PERMISSION = Object.freeze({ ACCOUNTS: "eth_accounts" });
const EMPTY = Object.freeze([]);

export class StandardWalletPermissionController {
  #origin;
  #walletAccounts;
  #approveAccounts;
  #approved = EMPTY;
  #approvalPromise = null;
  #epoch = 0;

  constructor({ origin, walletAccounts, approveAccounts }) {
    this.#origin = canonicalOrigin(origin);
    if (!Array.isArray(walletAccounts) || walletAccounts.length < 1 || walletAccounts.length > 1024) throw new TypeError("Wallet account inventory is invalid");
    this.#walletAccounts = Object.freeze(unique(walletAccounts.map(normalizeStandardWalletAddress)));
    if (typeof approveAccounts !== "function") throw new TypeError("Wallet account approval callback is required");
    this.#approveAccounts = approveAccounts;
  }

  get origin() { return this.#origin; }
  get accounts() { return this.#approved; }

  permissions() {
    if (this.#approved.length === 0) return EMPTY;
    return Object.freeze([{ parentCapability: STANDARD_WALLET_PERMISSION.ACCOUNTS, caveats: Object.freeze([{ type: "restrictReturnedAccounts", value: this.#approved }]) }]);
  }

  async requestAccounts() {
    if (this.#approved.length > 0) return this.#approved;
    if (this.#approvalPromise !== null) return this.#approvalPromise;
    const epoch = this.#epoch;
    const operation = this.#requestAccounts(epoch);
    this.#approvalPromise = operation;
    try { return await operation; }
    finally { if (this.#approvalPromise === operation) this.#approvalPromise = null; }
  }

  async #requestAccounts(epoch) {
    let selected;
    try { selected = await this.#approveAccounts(Object.freeze({ origin: this.#origin, accounts: this.#walletAccounts })); }
    catch { throw providerError(4001, "Account access was not approved"); }
    if (epoch !== this.#epoch) throw providerError(4100, "Account inventory changed during approval");
    if (!Array.isArray(selected) || selected.length < 1 || selected.length > this.#walletAccounts.length) throw providerError(4001, "Account access was not approved");
    const allowed = new Set(this.#walletAccounts);
    const approved = unique(selected.map(normalizeStandardWalletAddress));
    if (approved.some((address) => !allowed.has(address))) throw providerError(4100, "Account approval returned an unauthorized address");
    this.#approved = Object.freeze(approved);
    return this.#approved;
  }

  async requestPermissions(input) {
    if (!object(input) || Object.keys(input).length !== 1 || !object(input.eth_accounts) || Object.keys(input.eth_accounts).length !== 0) throw providerError(4200, "Only eth_accounts permission is supported");
    await this.requestAccounts();
    return this.permissions();
  }

  requireAccount(value) {
    const address = normalizeStandardWalletAddress(value);
    if (!this.#approved.includes(address)) throw providerError(4100, "The requested account is not approved for this origin");
    return address;
  }

  replaceWalletAccounts(accounts) {
    if (!Array.isArray(accounts) || accounts.length > 1024) throw new TypeError("Wallet account inventory is invalid");
    const next = Object.freeze(unique(accounts.map(normalizeStandardWalletAddress)));
    this.#epoch += 1;
    this.#walletAccounts = next;
    this.#approved = Object.freeze(this.#approved.filter((address) => next.includes(address)));
    return this.#approved;
  }

  revoke() { this.#epoch += 1; this.#approved = EMPTY; return this.#approved; }
}

export class StandardWalletProviderError extends Error {
  constructor(code, message, data = null) {
    super(message);
    this.name = "ProviderRpcError";
    this.code = code;
    this.data = data;
  }
}

export function providerError(code, message, data = null) { return new StandardWalletProviderError(code, message, data); }

export function canonicalWalletOrigin(value) { return canonicalOrigin(value); }

function canonicalOrigin(value) {
  if (typeof value !== "string" || value.length > 2048) throw new TypeError("DApp origin is invalid");
  if (/^walletconnect:[A-Za-z0-9_-]{16,128}$/.test(value)) return value;
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError("DApp origin is invalid"); }
  if (parsed.origin !== value || parsed.username || parsed.password || parsed.hash || parsed.search) throw new TypeError("DApp origin must be an exact origin");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) throw new TypeError("DApp origin must use HTTPS");
  return parsed.origin;
}
function unique(values) { return [...new Set(values)]; }
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
