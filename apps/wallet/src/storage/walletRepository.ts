import { walletIdentity, walletIdentityFromPublicKey } from "@ynx-chain/wallet-auth";

export const MANIFEST_KEY = "ynx.wallet.manifest.v2";
export const LEGACY_IDENTITY_KEY = "ynx.mobile.identity.v1";
export const DELETION_JOURNAL_KEY = "ynx.wallet.deletions.v1";
const SECRET_PREFIX = "ynx.wallet.account.v2.";
const AUTHENTICATED_SECRET_PREFIX = "ynx.wallet.account.auth.v3.";
const PROTECTION_PREFIX = "ynx.wallet.protection.v1.";
const mutationQueues = new WeakMap<SecureStorageAdapter, Promise<unknown>>();
type OperationGuard = () => void;
type PendingDeletion = Readonly<{ account: string; accountPublicKey: string }>;
type SecretProtection = Readonly<{schemaVersion:1;account:string;accountPublicKey:string;source:"created"|"legacy-v2"|"legacy-v1";state:"pending"|"recovery-pending"|"protected"|"complete"}>;

export type AuthenticatedSecretStorageAdapter = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};

export class WalletSecretRecoveryRequired extends Error {
  readonly code = "WALLET_SECRET_RECOVERY_REQUIRED";
  constructor() { super("This account's protected key is unavailable or biometric enrollment changed. Restore it with its offline recovery key; the public account has been retained."); }
}

export class WalletSecretMigrationRequired extends Error {
  readonly code = "WALLET_SECRET_MIGRATION_REQUIRED";
  constructor() { super("Confirm this Wallet operation with system biometrics to upgrade this account's key protection."); }
}

export type SecureStorageAdapter = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
  authenticatedSecrets?: AuthenticatedSecretStorageAdapter;
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
      await this.writeProtectedSecret(account, input.secretHex, "created", assertCurrent);
      assertCurrent?.();
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
      // Record public intent first. Cancellation stops further deletion; the journal lets a
      // later explicitly authorized retry complete an interrupted removal without secrets.
      await this.saveDeletionJournal(journal);
      assertCurrent?.();
      const accounts = current.accounts.filter((item) => item.account !== account);
      const selectedAccountId = current.selectedAccountId === account ? accounts[0]?.account ?? null : current.selectedAccountId;
      const next = freezeManifest({ ...current, selectedAccountId, accounts });
      if (stored) await this.saveManifest(next);
      assertCurrent?.();
      await this.deleteAccountMaterial(account, assertCurrent, (stored ?? existing)!.accountPublicKey);
      assertCurrent?.();
      await this.saveDeletionJournal(journal.filter((item) => item.account !== account));
      return next;
    });
  }

  async accountSecret(account: string, assertCurrent?: OperationGuard, authorization?: Readonly<{allowLegacyMigration: true; authorizeLegacyMigration?: () => Promise<void>}>): Promise<string> {
    assertCurrent?.();
    const expected = (await this.readManifest()).accounts.find((item) => item.account === account);
    assertCurrent?.();
    if (!expected) throw new Error("Account is missing from the public Wallet manifest");
    const protection = await this.readProtection(expected, assertCurrent);
    const serialized = await this.secrets().getItem(authenticatedSecretKey(account));
    assertCurrent?.();
    if (serialized !== null) {
      const secret = decodeSecret(serialized, expected, 3);
      await this.assertStoredAccount(expected, assertCurrent);
      if (!protection) throw new Error("Protected Wallet key has no verified protection record; explicit offline recovery is required");
      if (protection?.state === "pending") {
        if (!authorization?.allowLegacyMigration) throw new WalletSecretMigrationRequired();
        await this.saveProtection({...protection,state:"protected"}, assertCurrent);
      }
      if (protection.state !== "complete" && authorization?.allowLegacyMigration) {
        await this.cleanupLegacySecret({...protection,state:"protected"}, assertCurrent);
      }
      return secret;
    }
    // Never downgrade an already verified protected account after key invalidation.
    if (protection && protection.state !== "pending") throw new WalletSecretRecoveryRequired();
    if (!authorization?.allowLegacyMigration) throw new WalletSecretMigrationRequired();
    await this.assertStoredAccount(expected, assertCurrent);
    // Product sign-in relies on the cipher-bound OS prompt for protected v3 keys.
    // A legacy v2 record has no such protection until migration, so obtain its
    // separate explicit authorization before reading any legacy key material.
    await authorization.authorizeLegacyMigration?.();
    assertCurrent?.();
    await this.assertStoredAccount(expected, assertCurrent);
    const afterAuthorization = await this.readProtection(expected, assertCurrent);
    if (afterAuthorization && afterAuthorization.state !== "pending") throw new Error("Wallet key protection changed during legacy authorization. Review and authorize again.");
    const legacy = await this.storage.getItem(secretKey(account));
    assertCurrent?.();
    if (legacy === null) throw new WalletSecretRecoveryRequired();
    const secret = decodeSecret(legacy, expected, 2);
    await this.assertStoredAccount(expected, assertCurrent);
    await this.writeProtectedSecret(expected, secret, "legacy-v2", assertCurrent, true);
    await this.cleanupLegacySecret({schemaVersion:1,...publicIdentity(expected),source:"legacy-v2",state:"protected"}, assertCurrent);
    return secret;
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
        assertCurrent?.();
        if (!current.accounts.some((account) => account.account === item.account)) await this.deleteAccountMaterial(item.account, assertCurrent, item.accountPublicKey);
        assertCurrent?.();
        remaining = remaining.filter((record) => record.account !== item.account);
        await this.saveDeletionJournal(remaining);
      }
      return current;
    });
  }

  async resetCorruptStorage(assertCurrent?: OperationGuard): Promise<void> {
    assertCurrent?.();
    const raw = await this.storage.getItem(MANIFEST_KEY);
    assertCurrent?.();
    if (raw) {
      let parsed: {accounts?: Array<{account?:string}>} | undefined;
      try {
        parsed = JSON.parse(raw);
      } catch { /* unreadable manifest has no trusted account identifiers */ }
      for (const item of parsed?.accounts ?? []) if (typeof item.account === "string" && /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(item.account)) await this.deleteAccountMaterial(item.account, assertCurrent);
    }
    assertCurrent?.();
    await this.storage.deleteItem(MANIFEST_KEY);
    assertCurrent?.();
    await this.storage.deleteItem(LEGACY_IDENTITY_KEY);
  }

  async migrateLegacyIdentity(assertCurrent?: OperationGuard): Promise<LoadResult> {
    return this.mutate(async () => {
      assertCurrent?.();
      const current = await this.readManifest();
      assertCurrent?.();
      if (current.accounts.length) {
        const account = current.accounts.length === 1 ? current.accounts[0]! : null;
        const protection = account ? await this.readProtection(account, assertCurrent) : null;
        if (!account || protection?.source !== "legacy-v1" || protection.state === "complete") throw new Error("Existing Wallet accounts cannot be overwritten by legacy restore; import the offline recovery key to add an account");
        const serialized = await this.secrets().getItem(authenticatedSecretKey(account.account));
        assertCurrent?.();
        if (serialized === null) throw new WalletSecretRecoveryRequired();
        decodeSecret(serialized, account, 3);
        await this.assertStoredAccount(account, assertCurrent);
        await this.cleanupLegacySecret({...protection,state:"protected"}, assertCurrent);
        return {manifest:current,migrated:true};
      }
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
      await this.writeProtectedSecret(account, value.accountSecret, "legacy-v1", assertCurrent);
      assertCurrent?.();
      const manifest = freezeManifest({ schemaVersion: 2, selectedAccountId: identity.account, accounts: [account] });
      await this.saveManifest(manifest);
      assertCurrent?.();
      await this.cleanupLegacySecret({schemaVersion:1,...publicIdentity(account),source:"legacy-v1",state:"protected"}, assertCurrent);
      return { manifest, migrated: true };
    });
  }

  /** Only an explicit offline-key import may replace an unavailable protected key.
   * This never removes the public account or silently falls back to legacy material. */
  async restoreAccountSecret(account: string, secretHex: string, assertCurrent?: OperationGuard): Promise<WalletManifest> {
    return this.mutate(async()=>{
      assertCurrent?.();
      const current = await this.readManifest();
      assertCurrent?.();
      const expected = current.accounts.find(item=>item.account===account);
      if (!expected) throw new Error("Account is missing from the public Wallet manifest");
      decodeSecret(encodeSecret(account,secretHex,3),expected,3);
      const previousProtection = await this.readProtection(expected,assertCurrent);
      // A failed v1 cleanup may still hold the original recovery record. Retain
      // its verified source through restore so that copy is removed after the
      // replacement protected key has been authenticated and read back.
      const source = previousProtection?.source === "legacy-v1" ? "legacy-v1" : "legacy-v2";
      const pending = await this.readDeletionJournal();
      assertCurrent?.();
      if (pending.some(item=>item.account===account)) throw new Error("Complete the pending account removal before restoring this account");
      // The explicit supplied recovery key is authoritative for this exact public identity.
      await this.writeProtectedSecret(expected,secretHex,source,assertCurrent,true,true);
      await this.cleanupLegacySecret({schemaVersion:1,...publicIdentity(expected),source,state:"protected"},assertCurrent);
      return current;
    });
  }

  private secrets(): AuthenticatedSecretStorageAdapter {
    if (!this.storage.authenticatedSecrets) throw new Error("OS-authenticated Wallet secret storage is unavailable");
    return this.storage.authenticatedSecrets;
  }

  private async assertStoredAccount(expected: Pick<WalletAccount,"account"|"accountPublicKey">, assertCurrent?: OperationGuard): Promise<void> {
    assertCurrent?.();
    const current = (await this.readManifest()).accounts.find((item) => item.account === expected.account);
    assertCurrent?.();
    if (!current || current.accountPublicKey !== expected.accountPublicKey) throw new Error("Wallet account changed while reading its secure material");
  }

  private async readProtection(expected: Pick<WalletAccount,"account"|"accountPublicKey">, assertCurrent?: OperationGuard): Promise<SecretProtection|null> {
    assertCurrent?.();
    const raw = await this.storage.getItem(protectionKey(expected.account));
    assertCurrent?.();
    if (raw === null) return null;
    const value = parseObject(raw,"Wallet key protection record");
    exactKeys(value,["schemaVersion","account","accountPublicKey","source","state"],"Wallet key protection record");
    if (value.schemaVersion !== 1 || value.account !== expected.account || value.accountPublicKey !== expected.accountPublicKey || !["created","legacy-v2","legacy-v1"].includes(value.source as string) || !["pending","recovery-pending","protected","complete"].includes(value.state as string)) throw new Error("Wallet key protection record failed account verification");
    return value as SecretProtection;
  }

  private async saveProtection(value: SecretProtection, assertCurrent?: OperationGuard): Promise<void> {
    assertCurrent?.();
    await this.storage.setItem(protectionKey(value.account),JSON.stringify(value));
    assertCurrent?.();
  }

  private async writeProtectedSecret(expected: Pick<WalletAccount,"account"|"accountPublicKey">, secret: string, source: SecretProtection["source"], assertCurrent?: OperationGuard, requireStored = false, recovering = false): Promise<void> {
    // A failed explicit recovery must not downgrade an account back into the
    // ordinary legacy migration path when its protected key is unavailable.
    const protection: SecretProtection = {schemaVersion:1,...publicIdentity(expected),source,state:recovering ? "recovery-pending" : "pending"};
    this.secrets();
    assertCurrent?.();
    decodeSecret(encodeSecret(expected.account,secret,3),expected,3);
    await this.saveProtection(protection,assertCurrent);
    if (requireStored) await this.assertStoredAccount(expected,assertCurrent);
    await this.secrets().setItem(authenticatedSecretKey(expected.account),encodeSecret(expected.account,secret,3));
    assertCurrent?.();
    const readback = await this.secrets().getItem(authenticatedSecretKey(expected.account));
    assertCurrent?.();
    if (readback === null) throw new WalletSecretRecoveryRequired();
    if (decodeSecret(readback,expected,3) !== secret) throw new Error("Protected Wallet key readback did not match the reviewed account");
    if (requireStored) await this.assertStoredAccount(expected,assertCurrent);
    await this.saveProtection({...protection,state:source === "created" ? "complete" : "protected"},assertCurrent);
  }

  private async cleanupLegacySecret(protection: SecretProtection, assertCurrent?: OperationGuard): Promise<void> {
    await this.assertStoredAccount(protection,assertCurrent);
    if (protection.source !== "created") {
      await this.storage.deleteItem(protection.source === "legacy-v1" ? LEGACY_IDENTITY_KEY : secretKey(protection.account));
      assertCurrent?.();
    }
    await this.saveProtection({...protection,state:"complete"},assertCurrent);
  }

  private async deleteAccountMaterial(account: string, assertCurrent?: OperationGuard, accountPublicKey?:string): Promise<void> {
    assertCurrent?.();
    const protection = accountPublicKey ? await this.readProtection({account,accountPublicKey},assertCurrent) : null;
    await this.secrets().deleteItem(authenticatedSecretKey(account));
    assertCurrent?.();
    await this.storage.deleteItem(secretKey(account));
    assertCurrent?.();
    if (protection?.source === "legacy-v1") {
      // This public marker was identity-verified by explicit v1 migration. Do not leave
      // its old unprotected copy behind after the user removes the migrated account.
      await this.storage.deleteItem(LEGACY_IDENTITY_KEY);
      assertCurrent?.();
    }
    await this.storage.deleteItem(protectionKey(account));
    assertCurrent?.();
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
function authenticatedSecretKey(account: string) { return `${AUTHENTICATED_SECRET_PREFIX}${account}`; }
function protectionKey(account: string) { return `${PROTECTION_PREFIX}${account}`; }
function publicIdentity(value: Pick<WalletAccount,"account"|"accountPublicKey">) { return {account:value.account,accountPublicKey:value.accountPublicKey}; }
function encodeSecret(account: string, secretHex: string, schemaVersion: 2|3) { walletIdentity(secretHex); return JSON.stringify({ schemaVersion, account, secretHex }); }
function decodeSecret(serialized: string, expected: Pick<WalletAccount,"account"|"accountPublicKey">, schemaVersion: 2|3): string {
  const value = parseObject(serialized,"Secure Wallet account record");
  exactKeys(value,["schemaVersion","account","secretHex"],"Secure Wallet account record");
  if (value.schemaVersion !== schemaVersion || value.account !== expected.account || typeof value.secretHex !== "string") throw new Error("Secure Wallet account record is invalid");
  const identity = walletIdentity(value.secretHex);
  if (identity.account !== expected.account || identity.accountPublicKey !== expected.accountPublicKey) throw new Error("Secure Wallet account record failed account verification");
  return value.secretHex;
}
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
