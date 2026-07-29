import { walletIdentity } from "@ynx-chain/wallet-auth";

export const MANIFEST_KEY = "ynx.wallet.manifest.v2";
export const LEGACY_IDENTITY_KEY = "ynx.mobile.identity.v1";
const SECRET_PREFIX = "ynx.wallet.account.v2.";

export type SecureStorageAdapter = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};

export type WalletAccount = Readonly<{
  account: string;
  accountPublicKey: string;
  label: string;
  createdAt: string;
  backupConfirmed: boolean;
}>;

export type WalletManifest = Readonly<{
  schemaVersion: 2;
  selectedAccountId: string | null;
  accounts: readonly WalletAccount[];
}>;

export type LoadResult = Readonly<{ manifest: WalletManifest; migrated: boolean }>;

export class WalletRepository {
  constructor(private readonly storage: SecureStorageAdapter) {}

  async load(): Promise<LoadResult> {
    const serialized = await this.storage.getItem(MANIFEST_KEY);
    if (serialized !== null) return { manifest: await this.decodeAndVerifyManifest(serialized), migrated: false };
    const migrated = await this.migrateLegacy();
    if (migrated) return { manifest: migrated, migrated: true };
    return { manifest: emptyManifest(), migrated: false };
  }

  async addAccount(input: { secretHex: string; label: string; createdAt: string; backupConfirmed: boolean }): Promise<WalletManifest> {
    const current = (await this.load()).manifest;
    const identity = walletIdentity(input.secretHex);
    if (current.accounts.some((account) => account.account === identity.account)) throw new Error("This YNX account already exists in Wallet");
    if (current.accounts.length >= 20) throw new Error("Wallet supports at most 20 local accounts");
    const account = Object.freeze({
      ...identity,
      label: validLabel(input.label),
      createdAt: validTime(input.createdAt),
      backupConfirmed: input.backupConfirmed === true,
    });
    await this.storage.setItem(secretKey(identity.account), encodeSecret(identity.account, input.secretHex));
    const manifest = freezeManifest({
      schemaVersion: 2,
      selectedAccountId: identity.account,
      accounts: [...current.accounts, account],
    });
    await this.saveManifest(manifest);
    return manifest;
  }

  async confirmBackup(account: string): Promise<WalletManifest> {
    const current = (await this.load()).manifest;
    if (!current.accounts.some((item) => item.account === account)) throw new Error("Account is not stored in Wallet");
    return this.replaceManifest(current, {
      ...current,
      accounts: current.accounts.map((item) => item.account === account ? Object.freeze({ ...item, backupConfirmed: true }) : item),
    });
  }

  async selectAccount(account: string): Promise<WalletManifest> {
    const current = (await this.load()).manifest;
    if (!current.accounts.some((item) => item.account === account)) throw new Error("Account is not stored in Wallet");
    return this.replaceManifest(current, { ...current, selectedAccountId: account });
  }

  async renameAccount(account: string, label: string): Promise<WalletManifest> {
    const current = (await this.load()).manifest;
    if (!current.accounts.some((item) => item.account === account)) throw new Error("Account is not stored in Wallet");
    return this.replaceManifest(current, { ...current, accounts: current.accounts.map((item) => item.account === account ? Object.freeze({ ...item, label: validLabel(label) }) : item) });
  }

  async deleteAccount(account: string): Promise<WalletManifest> {
    const current = (await this.load()).manifest;
    if (!current.accounts.some((item) => item.account === account)) throw new Error("Account is not stored in Wallet");
    await this.storage.deleteItem(secretKey(account));
    const accounts = current.accounts.filter((item) => item.account !== account);
    const selectedAccountId = current.selectedAccountId === account ? accounts[0]?.account ?? null : current.selectedAccountId;
    return this.replaceManifest(current, { ...current, selectedAccountId, accounts });
  }

  async accountSecret(account: string): Promise<string> {
    const serialized = await this.storage.getItem(secretKey(account));
    if (serialized === null) throw new Error("Secure account material is missing; restore from the offline recovery key");
    const value = parseObject(serialized, "Secure Wallet account record");
    exactKeys(value, ["schemaVersion", "account", "secretHex"], "Secure Wallet account record");
    if (value.schemaVersion !== 2 || value.account !== account || typeof value.secretHex !== "string") throw new Error("Secure Wallet account record is invalid");
    const identity = walletIdentity(value.secretHex);
    if (identity.account !== account) throw new Error("Secure Wallet account record failed account verification");
    return value.secretHex;
  }

  async resetCorruptStorage(): Promise<void> {
    const raw = await this.storage.getItem(MANIFEST_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { accounts?: Array<{ account?: string }> };
        for (const item of parsed.accounts ?? []) if (typeof item.account === "string") await this.storage.deleteItem(secretKey(item.account));
      } catch { /* unreadable manifest has no trusted account identifiers */ }
    }
    await this.storage.deleteItem(MANIFEST_KEY);
    await this.storage.deleteItem(LEGACY_IDENTITY_KEY);
  }

  private async migrateLegacy(): Promise<WalletManifest | null> {
    const serialized = await this.storage.getItem(LEGACY_IDENTITY_KEY);
    if (serialized === null) return null;
    const value = parseObject(serialized, "Legacy secure identity record");
    exactKeys(value, ["schemaVersion", "account", "accountSecret", "deviceSecret"], "Legacy secure identity record");
    if (value.schemaVersion !== 1 || typeof value.account !== "string" || typeof value.accountSecret !== "string" || typeof value.deviceSecret !== "string" || !/^[0-9a-f]{64}$/.test(value.deviceSecret)) throw new Error("Legacy secure identity record is invalid");
    const identity = walletIdentity(value.accountSecret);
    if (identity.account !== value.account) throw new Error("Legacy secure identity record failed account verification");
    const account = Object.freeze({ ...identity, label: "Migrated account", createdAt: "1970-01-01T00:00:00.000Z", backupConfirmed: true });
    await this.storage.setItem(secretKey(identity.account), encodeSecret(identity.account, value.accountSecret));
    const manifest = freezeManifest({ schemaVersion: 2, selectedAccountId: identity.account, accounts: [account] });
    await this.saveManifest(manifest);
    await this.storage.deleteItem(LEGACY_IDENTITY_KEY);
    return manifest;
  }

  private async decodeAndVerifyManifest(serialized: string): Promise<WalletManifest> {
    const value = parseObject(serialized, "Secure Wallet manifest");
    exactKeys(value, ["schemaVersion", "selectedAccountId", "accounts"], "Secure Wallet manifest");
    if (value.schemaVersion !== 2 || !(value.selectedAccountId === null || typeof value.selectedAccountId === "string") || !Array.isArray(value.accounts)) throw new Error("Secure Wallet manifest is invalid");
    const accounts = value.accounts.map((raw, index) => decodeAccount(raw, index));
    if (new Set(accounts.map((item) => item.account)).size !== accounts.length) throw new Error("Secure Wallet manifest contains duplicate accounts");
    const sorted = sortAccounts(accounts);
    if (JSON.stringify(accounts) !== JSON.stringify(sorted)) throw new Error("Secure Wallet manifest account order is not deterministic");
    if (value.selectedAccountId !== null && !accounts.some((item) => item.account === value.selectedAccountId)) throw new Error("Secure Wallet manifest selected account is missing");
    for (const account of accounts) await this.accountSecretAgainstManifest(account);
    return freezeManifest({ schemaVersion: 2, selectedAccountId: value.selectedAccountId, accounts });
  }

  private async accountSecretAgainstManifest(account: WalletAccount): Promise<void> {
    const secret = await this.storage.getItem(secretKey(account.account));
    if (secret === null) throw new Error(`Secure material is missing for ${account.account}`);
    const decoded = parseObject(secret, "Secure Wallet account record");
    exactKeys(decoded, ["schemaVersion", "account", "secretHex"], "Secure Wallet account record");
    if (decoded.schemaVersion !== 2 || decoded.account !== account.account || typeof decoded.secretHex !== "string") throw new Error("Secure Wallet account record is invalid");
    const identity = walletIdentity(decoded.secretHex);
    if (identity.account !== account.account || identity.accountPublicKey !== account.accountPublicKey) throw new Error("Secure Wallet account record failed public identity verification");
  }

  private async replaceManifest(_current: WalletManifest, next: {schemaVersion:2;selectedAccountId:string|null;accounts:readonly WalletAccount[]}): Promise<WalletManifest> {
    const manifest = freezeManifest(next);
    await this.saveManifest(manifest);
    return manifest;
  }

  private async saveManifest(manifest: WalletManifest): Promise<void> {
    await this.storage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  }
}

export function emptyManifest(): WalletManifest { return freezeManifest({ schemaVersion: 2, selectedAccountId: null, accounts: [] }); }
function secretKey(account: string) { return `${SECRET_PREFIX}${account}`; }
function encodeSecret(account: string, secretHex: string) { walletIdentity(secretHex); return JSON.stringify({ schemaVersion: 2, account, secretHex }); }
function freezeManifest(value: {schemaVersion:2;selectedAccountId:string|null;accounts:readonly WalletAccount[]}): WalletManifest {
  const accounts = Object.freeze(sortAccounts(value.accounts).map((item) => Object.freeze({ ...item })));
  return Object.freeze({ schemaVersion: 2, selectedAccountId: value.selectedAccountId, accounts });
}
function sortAccounts(accounts: readonly WalletAccount[]): WalletAccount[] { return [...accounts].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.account.localeCompare(b.account)); }
function decodeAccount(raw: unknown, index: number): WalletAccount {
  if (!isObject(raw)) throw new Error(`Secure Wallet account ${index} is invalid`);
  exactKeys(raw, ["account", "accountPublicKey", "label", "createdAt", "backupConfirmed"], `Secure Wallet account ${index}`);
  if (typeof raw.account !== "string" || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(raw.account) || typeof raw.accountPublicKey !== "string" || !/^(02|03)[0-9a-f]{64}$/.test(raw.accountPublicKey) || typeof raw.backupConfirmed !== "boolean") throw new Error(`Secure Wallet account ${index} is invalid`);
  return Object.freeze({ account: raw.account, accountPublicKey: raw.accountPublicKey, label: validLabel(raw.label), createdAt: validTime(raw.createdAt), backupConfirmed: raw.backupConfirmed });
}
function validLabel(value: unknown): string { if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 40) throw new Error("Account label must contain 1 to 40 characters"); return value; }
function validTime(value: unknown): string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) throw new Error("Account time is invalid"); return value; }
function parseObject(serialized: string, label: string): Record<string, unknown> { let value: unknown; try { value = JSON.parse(serialized); } catch { throw new Error(`${label} is unreadable`); } if (!isObject(value)) throw new Error(`${label} is invalid`); return value; }
function isObject(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) { if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new Error(`${label} has unknown or missing fields`); }
