import { normalizeStandardWalletAddress } from "./standard-wallet-provider-events.js";
import { createStandardWalletPermissionSnapshot, parseStandardWalletPermissionSnapshot, validateStandardWalletPermissionStorage } from "./standard-wallet-permission-storage.js";
import { canonicalWalletOrigin, providerError, StandardWalletProviderError } from "./standard-wallet-provider-common.js";

export { canonicalWalletOrigin, providerError, StandardWalletProviderError };

export const STANDARD_WALLET_PERMISSION = Object.freeze({ ACCOUNTS: "eth_accounts" });
const EMPTY = Object.freeze([]);

export class StandardWalletPermissionController {
  #origin;
  #walletAccounts;
  #approveAccounts;
  #approved = EMPTY;
  #approvalPromise = null;
  #epoch = 0;
  #storage;
  #storageTail = Promise.resolve();

  constructor({ origin, walletAccounts, approveAccounts, storage }) {
    this.#origin = canonicalOrigin(origin);
    if (!Array.isArray(walletAccounts) || walletAccounts.length < 1 || walletAccounts.length > 1024) throw new TypeError("Wallet account inventory is invalid");
    this.#walletAccounts = Object.freeze(unique(walletAccounts.map(normalizeStandardWalletAddress)));
    if (typeof approveAccounts !== "function") throw new TypeError("Wallet account approval callback is required");
    this.#approveAccounts = approveAccounts;
    this.#storage = validateStandardWalletPermissionStorage(storage);
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
    const next = Object.freeze(approved);
    await this.#persist(next, epoch);
    if (epoch !== this.#epoch) throw providerError(4100, "Account inventory changed during approval persistence");
    this.#approved = next;
    return this.#approved;
  }

  async requestPermissions(input) {
    requireAccountsPermission(input);
    await this.requestAccounts();
    return this.permissions();
  }

  async revokePermissions(input) { requireAccountsPermission(input); await this.revokePersisted(); return null; }

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

  async restore() {
    if (this.#storage === null) return this.#approved;
    const epoch = this.#epoch;
    let encoded;
    try {
      encoded = await this.#queueStorage(async () => {
        if (epoch !== this.#epoch) throw providerError(4100, "Wallet permission state changed during restore");
        return this.#storage.load(Object.freeze({ origin: this.#origin }));
      });
    }
    catch { throw providerError(4100, "Wallet permission storage could not be read"); }
    if (encoded === null || encoded === undefined) return this.#approved;
    const snapshot = parseStandardWalletPermissionSnapshot(encoded, this.#origin);
    const inventory = new Set(this.#walletAccounts);
    if (snapshot.accounts.some((account) => !inventory.has(account))) throw providerError(4100, "Stored Wallet permission references an unavailable account");
    if (epoch !== this.#epoch) throw providerError(4100, "Wallet permission state changed during restore");
    this.#approved = snapshot.accounts;
    return this.#approved;
  }

  async replaceWalletAccountsPersisted(accounts) {
    const previousInventory = this.#walletAccounts, previousApproved = this.#approved;
    const nextApproved = this.replaceWalletAccounts(accounts);
    const epoch = this.#epoch;
    try { if (nextApproved.length === 0) await this.#clear(); else await this.#persist(nextApproved, epoch); }
    catch (error) { this.#walletAccounts = previousInventory; this.#approved = previousApproved; throw error; }
    return this.#approved;
  }

  async revokePersisted() {
    const previous = this.#approved;
    this.#epoch += 1;
    this.#approved = EMPTY;
    try { await this.#clear(); }
    catch (error) { this.#approved = previous; throw error; }
    return this.#approved;
  }

  async #persist(accounts, epoch) {
    if (this.#storage === null) return;
    try {
      await this.#queueStorage(async () => {
        if (epoch !== this.#epoch) throw providerError(4100, "Wallet permission state changed before persistence");
        await this.#storage.save(createStandardWalletPermissionSnapshot(this.#origin, accounts));
        if (epoch !== this.#epoch) throw providerError(4100, "Wallet permission state changed during persistence");
      });
    }
    catch { throw providerError(4100, "Wallet permission storage could not be updated"); }
  }

  async #clear() {
    if (this.#storage === null) return;
    try { await this.#queueStorage(() => this.#storage.clear(Object.freeze({ origin: this.#origin }))); }
    catch { throw providerError(4100, "Wallet permission storage could not be cleared"); }
  }

  #queueStorage(operation) {
    const next = this.#storageTail.then(operation, operation);
    this.#storageTail = next.catch(() => undefined);
    return next;
  }
}

function canonicalOrigin(value) {
  return canonicalWalletOrigin(value);
}
function unique(values) { return [...new Set(values)]; }
function requireAccountsPermission(input) { if (!object(input) || Object.keys(input).length !== 1 || !object(input.eth_accounts) || Object.keys(input.eth_accounts).length !== 0) throw providerError(4200, "Only eth_accounts permission is supported"); }
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
