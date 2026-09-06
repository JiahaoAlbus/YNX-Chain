import { walletIdentity, walletIdentityFromPublicKey } from "@ynx-chain/wallet-auth";

export const MANIFEST_KEY = "ynx.wallet.manifest.v2";
export const LEGACY_IDENTITY_KEY = "ynx.mobile.identity.v1";
export const DELETION_JOURNAL_KEY = "ynx.wallet.deletions.v1";
const SECRET_PREFIX = "ynx.wallet.account.v2.";
const mutationQueues = new WeakMap<SecureStorageAdapter, Promise<unknown>>();
type OperationGuard = () => void;
type PendingDeletion = Readonly<{ account: string; accountPublicKey: string }>;

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
    // Public inventory must remain available while locked or if one secret is unavailable.
    // Legacy identity material is read only by the explicit, locally authorized restore API.
    return { manifest: await this.readManifest(), migrated: false };
  }

  async addAccount(input: { secretHex: string; label: string; createdAt: string; backupConfirmed: boolean }, assertCurrent?: OperationGuard): Promise<WalletManifest> {
    return this.mutate(async () => {
      assertCurrent?.();
      const current = (await this.load()).manifest;
      assertCurrent?.();
      const identity = walletIdentity(input.secretHex);
      if (current.accounts.some((account) => account.account === identity.account)) throw new Error("This YNX account already exists in Wallet");
      if (current.accounts.length >= 20) throw new Error("Wallet supports at most 20 local accounts");
      const account = Object.freeze({
        ...identity,
        label: validLabel(input.label),
        createdAt: validTime(input.createdAt),
        backupConfirmed: input.backupConfirmed === true,
      });
      const pending = await this.readDeletionJournal();
      assertCurrent?.();
      if (pending.some((item) => item.account === identity.account)) throw new Error("Complete the pending account removal before importing this account again");
      await this.storage.setItem(secretKey(identity.account), encodeSecret(identity.account, input.secretHex));
      const manifest = freezeManifest({
        schemaVersion: 2,
        selectedAccountId: identity.account,
        accounts: [...current.accounts, account],
      });
      await this.saveManifest(manifest);
      return manifest;
    });
  }

  async confirmBackup(account: string): Promise<WalletManifest> {
    return this.mutate(async () => {
      const current = (await this.load()).manifest;
      if (!current.accounts.some((item) => item.account === account)) throw new Error("Account is not stored in Wallet");
      return this.replaceManifest(current, {
        ...current,
        accounts: current.accounts.map((item) => item.account === account ? Object.freeze({ ...item, backupConfirmed: true }) : item),
      });
    });
  }

  async selectAccount(account: string): Promise<WalletManifest> {
    return this.mutate(async () => {
      const current = (await this.load()).manifest;
      if (!current.accounts.some((item) => item.account === account)) throw new Error("Account is not stored in Wallet");
      return this.replaceManifest(current, { ...current, selectedAccountId: account });
    });
  }

  async renameAccount(account: string, label: string): Promise<WalletManifest> {
    return this.mutate(async () => {
      const current = (await this.load()).manifest;
      if (!current.accounts.some((item) => item.account === account)) throw new Error("Account is not stored in Wallet");
      return this.replaceManifest(current, { ...current, accounts: current.accounts.map((item) => item.account === account ? Object.freeze({ ...item, label: validLabel(label) }) : item) });
    });
  }

  async deleteAccount(account: string, assertCurrent?: OperationGuard): Promise<WalletManifest> {
    return this.mutate(async () => {
      assertCurrent?.();
      const current = (await this.load()).manifest;
      assertCurrent?.();
      const pending = await this.readDeletionJournal();
      assertCurrent?.();
      const stored = current.accounts.find((item) => item.account === account);
      const existing = pending.find((item) => item.account === account);
      if (!stored && !existing) throw new Error("Account is not stored in Wallet");
      if (stored && existing && stored.accountPublicKey !== existing.accountPublicKey) throw new Error("Pending account removal failed public identity verification");
      const journal = existing ? pending : [...pending, { account: stored!.account, accountPublicKey: stored!.accountPublicKey }];
      // Record intent first, commit public removal second, delete material last. Once writing
      // starts, finish this sequence despite a UI cancellation; failures remain retryable.
      await this.saveDeletionJournal(journal);
      const accounts = current.accounts.filter((item) => item.account !== account);
      const selectedAccountId = current.selectedAccountId === account ? accounts[0]?.account ?? null : current.selectedAccountId;
      const next = freezeManifest({ ...current, selectedAccountId, accounts });
      if (stored) await this.saveManifest(next);
      await this.storage.deleteItem(secretKey(account));
      await this.saveDeletionJournal(journal.filter((item) => item.account !== account));
      return next;
    });
  }

  async accountSecret(account: string, assertCurrent?: OperationGuard): Promise<string> {
    assertCurrent?.();
    const expected = (await this.readManifest()).accounts.find((item) => item.account === account);
    assertCurrent?.();
    if (!expected) throw new Error("Account is missing from the public Wallet manifest");
    const serialized = await this.storage.getItem(secretKey(account));
    assertCurrent?.();
    if (serialized === null) throw new Error("Secure account material is missing; restore from the offline recovery key");
    const value = parseObject(serialized, "Secure Wallet account record");
    exactKeys(value, ["schemaVersion", "account", "secretHex"], "Secure Wallet account record");
    if (value.schemaVersion !== 2 || value.account !== account || typeof value.secretHex !== "string") throw new Error("Secure Wallet account record is invalid");
    const identity = walletIdentity(value.secretHex);
    if (identity.account !== account || identity.accountPublicKey !== expected.accountPublicKey) throw new Error("Secure Wallet account record failed account verification");
    const current = (await this.readManifest()).accounts.find((item) => item.account === account);
    assertCurrent?.();
    if (!current || current.accountPublicKey !== expected.accountPublicKey) throw new Error("Wallet account changed while reading its secure material");
    return value.secretHex;
  }

  async retryPendingDeletions(assertCurrent?: OperationGuard): Promise<WalletManifest> {
    return this.mutate(async () => {
      assertCurrent?.();
      const current = await this.readManifest();
      assertCurrent?.();
      const pending = await this.readDeletionJournal();
      assertCurrent?.();
      let remaining = pending;
      for (const item of pending) {
        // An entry still in the manifest never committed removal: leave its key intact.
        if (!current.accounts.some((account) => account.account === item.account)) await this.storage.deleteItem(secretKey(item.account));
        remaining = remaining.filter((record) => record.account !== item.account);
        await this.saveDeletionJournal(remaining);
      }
      return current;
    });
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

  async migrateLegacyIdentity(assertCurrent?: OperationGuard): Promise<LoadResult> {
    return this.mutate(async () => {
      assertCurrent?.();
      const current = await this.readManifest();
      assertCurrent?.();
      if (current.accounts.length) throw new Error("Existing Wallet accounts cannot be overwritten by legacy restore; import the offline recovery key to add an account");
      const serialized = await this.storage.getItem(LEGACY_IDENTITY_KEY);
      assertCurrent?.();
      if (serialized === null) return { manifest: current, migrated: false };
      const value = parseObject(serialized, "Legacy secure identity record");
      exactKeys(value, ["schemaVersion", "account", "accountSecret", "deviceSecret"], "Legacy secure identity record");
      if (value.schemaVersion !== 1 || typeof value.account !== "string" || typeof value.accountSecret !== "string" || typeof value.deviceSecret !== "string" || !/^[0-9a-f]{64}$/.test(value.deviceSecret)) throw new Error("Legacy secure identity record is invalid");
      const identity = walletIdentity(value.accountSecret);
      if (identity.account !== value.account) throw new Error("Legacy secure identity record failed account verification");
      const account = Object.freeze({ ...identity, label: "Migrated account", createdAt: "1970-01-01T00:00:00.000Z", backupConfirmed: true });
      const pending = await this.readDeletionJournal();
      assertCurrent?.();
      if (pending.some((item) => item.account === identity.account)) throw new Error("Complete the pending account removal before restoring this identity");
      await this.storage.setItem(secretKey(identity.account), encodeSecret(identity.account, value.accountSecret));
      const manifest = freezeManifest({ schemaVersion: 2, selectedAccountId: identity.account, accounts: [account] });
      await this.saveManifest(manifest);
      await this.storage.deleteItem(LEGACY_IDENTITY_KEY);
      return { manifest, migrated: true };
    });
  }

  private async readManifest(): Promise<WalletManifest> {
    const serialized = await this.storage.getItem(MANIFEST_KEY);
    return serialized === null ? emptyManifest() : this.decodeManifest(serialized);
  }

  private decodeManifest(serialized: string): WalletManifest {
    const value = parseObject(serialized, "Secure Wallet manifest");
    exactKeys(value, ["schemaVersion", "selectedAccountId", "accounts"], "Secure Wallet manifest");
    if (value.schemaVersion !== 2 || !(value.selectedAccountId === null || typeof value.selectedAccountId === "string") || !Array.isArray(value.accounts) || value.accounts.length > 20) throw new Error("Secure Wallet manifest is invalid");
    const accounts = value.accounts.map((raw, index) => decodeAccount(raw, index));
    if (new Set(accounts.map((item) => item.account)).size !== accounts.length) throw new Error("Secure Wallet manifest contains duplicate accounts");
    const sorted = sortAccounts(accounts);
    if (JSON.stringify(accounts) !== JSON.stringify(sorted)) throw new Error("Secure Wallet manifest account order is not deterministic");
    if (value.selectedAccountId !== null && !accounts.some((item) => item.account === value.selectedAccountId)) throw new Error("Secure Wallet manifest selected account is missing");
    return freezeManifest({ schemaVersion: 2, selectedAccountId: value.selectedAccountId, accounts });
  }

  private async readDeletionJournal(): Promise<PendingDeletion[]> {
    const raw = await this.storage.getItem(DELETION_JOURNAL_KEY);
    if (raw === null) return [];
    const value = parseObject(raw, "Wallet deletion journal");
    exactKeys(value, ["schemaVersion", "accounts"], "Wallet deletion journal");
    if (value.schemaVersion !== 1 || !Array.isArray(value.accounts) || value.accounts.length > 20) throw new Error("Wallet deletion journal is invalid");
    const accounts = value.accounts.map((item) => {
      if (!isObject(item)) throw new Error("Wallet deletion journal is invalid");
      exactKeys(item, ["account", "accountPublicKey"], "Wallet deletion journal entry");
      verifyPublicIdentity(item.account, item.accountPublicKey);
      return { account: item.account as string, accountPublicKey: item.accountPublicKey as string };
    });
    if (new Set(accounts.map((item) => item.account)).size !== accounts.length) throw new Error("Wallet deletion journal contains duplicate accounts");
    return accounts;
  }

  private async saveDeletionJournal(accounts: readonly PendingDeletion[]): Promise<void> {
    if (accounts.length > 20) throw new Error("Complete pending account removals before deleting another account");
    if (!accounts.length) return this.storage.deleteItem(DELETION_JOURNAL_KEY);
    await this.storage.setItem(DELETION_JOURNAL_KEY, JSON.stringify({ schemaVersion: 1, accounts: [...accounts].sort((a, b) => a.account.localeCompare(b.account)) }));
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = mutationQueues.get(this.storage) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    mutationQueues.set(this.storage, next);
    return next;
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
  verifyPublicIdentity(raw.account, raw.accountPublicKey);
  return Object.freeze({ account: raw.account, accountPublicKey: raw.accountPublicKey, label: validLabel(raw.label), createdAt: validTime(raw.createdAt), backupConfirmed: raw.backupConfirmed });
}
function verifyPublicIdentity(account: unknown, publicKey: unknown): void {
  try {
    if (typeof account !== "string" || typeof publicKey !== "string" || !/^(02|03)[0-9a-f]{64}$/.test(publicKey) || walletIdentityFromPublicKey(publicKey) !== account) throw new Error("mismatch");
  } catch { throw new Error("Wallet public account identity failed verification"); }
}
function validLabel(value: unknown): string { if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 40) throw new Error("Account label must contain 1 to 40 characters"); return value; }
function validTime(value: unknown): string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) throw new Error("Account time is invalid"); return value; }
function parseObject(serialized: string, label: string): Record<string, unknown> { let value: unknown; try { value = JSON.parse(serialized); } catch { throw new Error(`${label} is unreadable`); } if (!isObject(value)) throw new Error(`${label} is invalid`); return value; }
function isObject(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) { if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new Error(`${label} has unknown or missing fields`); }
