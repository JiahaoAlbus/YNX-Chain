import { keyAccessError } from "./key-lifecycle.mjs";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Wallet } from "ethers";
import { evmAddressFromYNX, walletIdentity } from "@ynx-chain/wallet-auth";

export class DesktopWalletVault {
  constructor({ filePath, legacyFilePath = null, safeStorage, randomSecret = validRandomSecret, authorization = { current() { throw keyAccessError(); } } }) {
    if (!filePath || !safeStorage) throw new Error("Wallet vault requires a path and OS safe storage");
    this.filePath = filePath;
    this.legacyFilePath = legacyFilePath;
    this.safeStorage = safeStorage;
    this.randomSecret = randomSecret;
    this.mutations = Promise.resolve();
    this.authorization = authorization;
  }

  async status() {
    const vault = await this.#read();
    const record = activeRecord(vault);
    return Object.freeze({
      initialized: record !== null,
      account: record?.account ?? null,
      ynxAccount: record?.ynxAccount ?? null,
      accounts: Object.freeze(vault?.accounts.map(item => Object.freeze({ account: item.account, ynxAccount: item.ynxAccount, publicKey: item.publicKey })) ?? []),
      custody: record ? "os-encrypted-local" : "not-created",
      secretExported: false
    });
  }

  async createAccount() {
    const guard = this.authorization.current();
    return this.#mutate(async () => {
      guard.assert();
      if (!await guard.step(() => this.#read())) await this.#write(await this.#newVault(guard), guard);
      return this.status();
    });
  }

  async addAccountAndSelect() {
    const guard = this.authorization.current();
    return this.#mutate(async () => {
    guard.assert();
    const vault = await guard.step(() => this.#read());
    if (!vault) { await this.#write(await this.#newVault(guard), guard); return this.status(); }
    if (vault.accounts.length >= 32) throw providerError(4200, "ACCOUNT_LIMIT", "This Wallet supports up to 32 accounts");
    const next = await this.#newRecord(undefined, guard);
    if (vault.accounts.some(item => item.account === next.account)) throw providerError(4200, "DUPLICATE_ACCOUNT", "Generated Wallet account already exists");
    await this.#write({ schemaVersion: 2, activeAccount: next.account, accounts: [...vault.accounts, next] }, guard);
    return this.status();
    });
  }

  async selectAccount(account) {
    const guard = this.authorization.current();
    return this.#mutate(async () => {
    const vault = await guard.step(() => this.#read());
    const normalized = typeof account === "string" ? account.toLowerCase() : "";
    if (!vault?.accounts.some(item => item.account === normalized)) throw providerError(4100, "UNKNOWN_WALLET_ACCOUNT", "Selected Wallet account does not exist");
    await this.#write({ ...vault, activeAccount: normalized }, guard);
    return this.status();
    });
  }

  async importAccount({ kind, value, password = "" } = {}) {
    const guard = this.authorization.current();
    if (typeof value !== "string" || value.length < 1 || value.length > 100_000) throw providerError(-32602, "INVALID_IMPORT", "Enter a valid Wallet import");
    let secret;
    try {
      if (kind === "private-key" && /^(0x)?[0-9a-fA-F]{64}$/.test(value.trim())) secret = new Wallet(value.trim().replace(/^(?!0x)/, "0x")).privateKey.slice(2);
      else if (kind === "recovery-phrase") secret = Wallet.fromPhrase(value.trim().replace(/\s+/g, " ")).privateKey.slice(2);
      else if (kind === "encrypted-json" && typeof password === "string") secret = (await Wallet.fromEncryptedJson(value, password)).privateKey.slice(2);
      else throw new Error("Unsupported import");
    } catch { throw providerError(-32602, "INVALID_IMPORT", "Wallet import is invalid or the backup password is incorrect"); }
    try {
      guard.assert();
      return await this.#mutate(async () => {
        const vault = await guard.step(() => this.#read());
        const account = evmAddressFromYNX(walletIdentity(secret).account);
        if (vault?.accounts.some(item => item.account === account)) throw providerError(4200, "DUPLICATE_ACCOUNT", "This account is already in the Wallet");
        if ((vault?.accounts.length ?? 0) >= 32) throw providerError(4200, "ACCOUNT_LIMIT", "This Wallet supports up to 32 accounts");
        const record = await this.#newRecord(secret, guard);
        await this.#write({ schemaVersion: 2, activeAccount: record.account, accounts: [...(vault?.accounts ?? []), record] }, guard);
        return this.status();
      });
    } finally { secret = null; }
  }

  async encryptedBackup(password) {
    if (typeof password !== "string" || password.length < 12 || password.length > 1024) throw providerError(-32602, "BACKUP_PASSWORD_REQUIRED", "Use a backup password of at least 12 characters");
    return this.withSecret(secret => new Wallet(`0x${secret}`).encrypt(password));
  }

  #mutate(action) {
    const result = this.mutations.then(action);
    this.mutations = result.catch(() => {});
    return result;
  }

  #assertSecureStorage() {
    if (!this.safeStorage.isEncryptionAvailable() || this.safeStorage.getSelectedStorageBackend?.() === "basic_text") throw providerError(4200, "SECURE_STORAGE_UNAVAILABLE", "OS secure storage is unavailable");
  }

  async #newVault(guard) {
    const record = await this.#newRecord(undefined, guard);
    return { schemaVersion: 2, activeAccount: record.account, accounts: [record] };
  }

  async #newRecord(secret = this.randomSecret(), guard) {
    guard.assert();
    this.#assertSecureStorage();
    const identity = walletIdentity(secret);
    const account = evmAddressFromYNX(identity.account);
    const encryptedSecret = (await guard.step(() => this.#encrypt(secret))).toString("base64");
    return {
      account,
      ynxAccount: identity.account,
      publicKey: identity.accountPublicKey,
      encryptedSecret,
      createdAt: new Date().toISOString()
    };
  }

  async withSecret(action) {
    const guard = this.authorization.current();
    const record = activeRecord(await guard.step(() => this.#read()));
    if (!record) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Create a Wallet account before approving this request");
    if (guard.account !== undefined && guard.account !== record.account) throw keyAccessError("WALLET_OPERATION_CANCELLED");
    this.#assertSecureStorage();
    let secret;
    try {
      secret = await guard.step(() => this.#decrypt(Buffer.from(record.encryptedSecret, "base64")));
      const current = activeRecord(await guard.step(() => this.#read()));
      if (current?.account !== record.account || current?.publicKey !== record.publicKey) throw keyAccessError("WALLET_OPERATION_CANCELLED");
      const identity = walletIdentity(secret);
      if (evmAddressFromYNX(identity.account) !== record.account || identity.account !== record.ynxAccount || identity.accountPublicKey !== record.publicKey) throw providerError(4100, "WALLET_IDENTITY_MISMATCH", "Encrypted key does not match the selected account");
      return await guard.step(() => action(secret, Object.freeze({ account: record.account, ynxAccount: record.ynxAccount, publicKey: record.publicKey }), guard));
    } finally {
      secret = null;
    }
  }

  async #encrypt(secret) {
    if (typeof this.safeStorage.encryptStringAsync === "function") return this.safeStorage.encryptStringAsync(secret);
    return this.safeStorage.encryptString(secret);
  }

  async #decrypt(encrypted) {
    if (typeof this.safeStorage.decryptStringAsync === "function") {
      const value = await this.safeStorage.decryptStringAsync(encrypted);
      if (typeof value?.result !== "string") throw new Error("OS async secure storage returned no plaintext");
      return value.result;
    }
    return this.safeStorage.decryptString(encrypted);
  }

  async #read() {
    try {
      return normalizeVault(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT" && this.legacyFilePath && this.legacyFilePath !== this.filePath) {
        try { return normalizeVault(JSON.parse(await readFile(this.legacyFilePath, "utf8"))); }
        catch (legacyError) { if (legacyError?.code === "ENOENT") return null; throw legacyError; }
      }
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async #write(record, guard) {
    await guard.step(() => mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 }));
    const temporary = `${this.filePath}.tmp`;
    await guard.step(() => writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 }));
    await guard.step(() => rename(temporary, this.filePath));
  }
}

function validRecord(record) { return /^0x[0-9a-f]{40}$/.test(record?.account) && /^ynx1/.test(record?.ynxAccount) && /^(02|03)[0-9a-f]{64}$/.test(record?.publicKey) && /^[A-Za-z0-9+/]+={0,2}$/.test(record?.encryptedSecret); }
function activeRecord(vault) { return vault?.accounts.find(item => item.account === vault.activeAccount) ?? null; }
function normalizeVault(record) {
  if (record?.schemaVersion === 1 && validRecord(record)) return { schemaVersion: 2, activeAccount: record.account, accounts: [{ account: record.account, ynxAccount: record.ynxAccount, publicKey: record.publicKey, encryptedSecret: record.encryptedSecret, createdAt: record.createdAt }] };
  if (record?.schemaVersion !== 2 || !Array.isArray(record.accounts) || record.accounts.length < 1 || record.accounts.length > 32 || !record.accounts.every(validRecord) || new Set(record.accounts.map(item => item.account)).size !== record.accounts.length || !record.accounts.some(item => item.account === record.activeAccount)) throw providerError(4100, "WALLET_VAULT_INVALID", "Wallet vault failed validation");
  return record;
}

function validRandomSecret() {
  for (;;) {
    const value = randomBytes(32).toString("hex");
    try { walletIdentity(value); return value; } catch {}
  }
}

export function providerError(code, dataCode, message) {
  return Object.assign(new Error(message), { code, data: { code: dataCode } });
}
