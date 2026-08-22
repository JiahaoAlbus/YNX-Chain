import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { evmAddressFromYNX, walletIdentity } from "@ynx-chain/wallet-auth";

export class DesktopWalletVault {
  constructor({ filePath, legacyFilePath = null, safeStorage, randomSecret = validRandomSecret }) {
    if (!filePath || !safeStorage) throw new Error("Wallet vault requires a path and OS safe storage");
    this.filePath = filePath;
    this.legacyFilePath = legacyFilePath;
    this.safeStorage = safeStorage;
    this.randomSecret = randomSecret;
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
    const existing = await this.#read();
    if (existing) return this.status();
    await this.#write(await this.#newVault());
    return this.status();
  }

  async addAccountAndSelect() {
    const vault = await this.#read();
    if (!vault) return this.createAccount();
    const next = await this.#newRecord();
    if (vault.accounts.some(item => item.account === next.account)) throw providerError(4200, "DUPLICATE_ACCOUNT", "Generated Wallet account already exists");
    await this.#write({ schemaVersion: 2, activeAccount: next.account, accounts: [...vault.accounts, next] });
    return this.status();
  }

  async selectAccount(account) {
    const vault = await this.#read();
    const normalized = typeof account === "string" ? account.toLowerCase() : "";
    if (!vault?.accounts.some(item => item.account === normalized)) throw providerError(4100, "UNKNOWN_WALLET_ACCOUNT", "Selected Wallet account does not exist");
    await this.#write({ ...vault, activeAccount: normalized });
    return this.status();
  }

  async #newVault() {
    const record = await this.#newRecord();
    return { schemaVersion: 2, activeAccount: record.account, accounts: [record] };
  }

  async #newRecord() {
    if (!this.safeStorage.isEncryptionAvailable()) throw providerError(4200, "SECURE_STORAGE_UNAVAILABLE", "OS secure storage is unavailable");
    const secret = this.randomSecret();
    const identity = walletIdentity(secret);
    const account = evmAddressFromYNX(identity.account);
    const encryptedSecret = (await this.#encrypt(secret)).toString("base64");
    return {
      account,
      ynxAccount: identity.account,
      publicKey: identity.accountPublicKey,
      encryptedSecret,
      createdAt: new Date().toISOString()
    };
  }

  async withSecret(action) {
    const record = activeRecord(await this.#read());
    if (!record) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Create a Wallet account before approving this request");
    if (!this.safeStorage.isEncryptionAvailable()) throw providerError(4200, "SECURE_STORAGE_UNAVAILABLE", "OS secure storage is unavailable");
    let secret;
    try {
      secret = await this.#decrypt(Buffer.from(record.encryptedSecret, "base64"));
      return await action(secret, Object.freeze({ account: record.account, ynxAccount: record.ynxAccount, publicKey: record.publicKey }));
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
      try {
        const value = await this.safeStorage.decryptStringAsync(encrypted);
        if (typeof value?.result !== "string") throw new Error("OS async secure storage returned no plaintext");
        return value.result;
      } catch (error) {
        if (typeof this.safeStorage.decryptString !== "function") throw error;
      }
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

  async #write(record) {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
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
