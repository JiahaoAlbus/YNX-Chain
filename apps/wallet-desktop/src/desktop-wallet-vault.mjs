import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { evmAddressFromYNX, walletIdentity } from "@ynx-chain/wallet-auth";

export class DesktopWalletVault {
  constructor({ filePath, safeStorage, randomSecret = validRandomSecret }) {
    if (!filePath || !safeStorage) throw new Error("Wallet vault requires a path and OS safe storage");
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.randomSecret = randomSecret;
  }

  async status() {
    const record = await this.#read();
    return Object.freeze({
      initialized: record !== null,
      account: record?.account ?? null,
      ynxAccount: record?.ynxAccount ?? null,
      custody: record ? "os-encrypted-local" : "not-created",
      secretExported: false
    });
  }

  async createAccount() {
    const existing = await this.#read();
    if (existing) return this.status();
    if (!this.safeStorage.isEncryptionAvailable()) throw providerError(4200, "SECURE_STORAGE_UNAVAILABLE", "OS secure storage is unavailable");
    const secret = this.randomSecret();
    const identity = walletIdentity(secret);
    const account = evmAddressFromYNX(identity.account);
    const encryptedSecret = this.safeStorage.encryptString(secret).toString("base64");
    const record = {
      schemaVersion: 1,
      account,
      ynxAccount: identity.account,
      publicKey: identity.accountPublicKey,
      encryptedSecret,
      createdAt: new Date().toISOString()
    };
    await this.#write(record);
    return this.status();
  }

  async withSecret(action) {
    const record = await this.#read();
    if (!record) throw providerError(4100, "ACCOUNT_NOT_CREATED", "Create a Wallet account before approving this request");
    if (!this.safeStorage.isEncryptionAvailable()) throw providerError(4200, "SECURE_STORAGE_UNAVAILABLE", "OS secure storage is unavailable");
    let secret;
    try {
      secret = this.safeStorage.decryptString(Buffer.from(record.encryptedSecret, "base64"));
      return await action(secret, Object.freeze({ account: record.account, ynxAccount: record.ynxAccount, publicKey: record.publicKey }));
    } finally {
      secret = null;
    }
  }

  async #read() {
    try {
      const record = JSON.parse(await readFile(this.filePath, "utf8"));
      if (record?.schemaVersion !== 1 || !/^0x[0-9a-f]{40}$/.test(record.account) || !/^ynx1/.test(record.ynxAccount) || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.encryptedSecret)) {
        throw providerError(4100, "WALLET_VAULT_INVALID", "Wallet vault failed validation");
      }
      return record;
    } catch (error) {
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

function validRandomSecret() {
  for (;;) {
    const value = randomBytes(32).toString("hex");
    try { walletIdentity(value); return value; } catch {}
  }
}

export function providerError(code, dataCode, message) {
  return Object.assign(new Error(message), { code, data: { code: dataCode } });
}
