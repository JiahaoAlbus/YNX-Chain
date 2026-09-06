import { randomBytes, randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { evmAddressFromYNX, walletIdentity, walletIdentityFromPublicKey } from "@ynx-chain/wallet-auth";
import { keyAccessError } from "./key-lifecycle.mjs";
import { providerError } from "./desktop-wallet-vault.mjs";
import { PasswordVaultFile, vaultStorageError } from "./password-vault-file.mjs";
import { parsePasswordVault, readPasswordVaultPublicMetadata, createPasswordVault, unlockPasswordVault, rewritePasswordVault, decryptPasswordVaultRecord, closePasswordVaultSession } from "./password-vault-crypto.mjs";

const fail = (code, message) => { throw providerError(4100, code, message); };
const cancelled = () => keyAccessError("WALLET_OPERATION_CANCELLED");
const options = guard => ({ guard: () => guard.assert() });
const identityFor = secret => { const identity = walletIdentity(secret); return { account: evmAddressFromYNX(identity.account), ynxAccount: identity.account, publicKey: identity.accountPublicKey }; };
function passwordPair(password, confirmation) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256) fail("PASSWORD_VAULT_PASSWORD_INVALID", "Use a local Wallet password of 12 to 256 characters.");
  if (password !== confirmation) fail("PASSWORD_CONFIRMATION_MISMATCH", "The two local Wallet passwords do not match.");
}
function legacyVault(text) {
  let value; try { value = JSON.parse(text); } catch { fail("WALLET_VAULT_INVALID", "The existing Wallet file is invalid. Keep it for offline recovery."); }
  if (value?.schemaVersion === 1) value = { schemaVersion: 2, activeAccount: value.account, accounts: [value] };
  if (value?.schemaVersion !== 2 || !Array.isArray(value.accounts) || value.accounts.length < 1 || value.accounts.length > 32) fail("WALLET_VAULT_INVALID", "The existing Wallet catalog is invalid.");
  const accounts = value.accounts.map(record => {
    try {
      if (walletIdentityFromPublicKey(record.publicKey) !== record.ynxAccount || evmAddressFromYNX(record.ynxAccount) !== record.account || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.encryptedSecret) || record.encryptedSecret.length > 16_384) throw new Error();
      let createdAtValid = false;
      try { createdAtValid = typeof record.createdAt === "string" && record.createdAt.length === 24 && new Date(record.createdAt).toISOString() === record.createdAt; } catch {}
      const label = record.label === undefined ? "" : record.label;
      if (!createdAtValid || typeof label !== "string" || label.length > 120 || Buffer.byteLength(label) > 480 || /[\u0000-\u001f\u007f]/u.test(label)) fail("LEGACY_METADATA_INVALID", "The existing Wallet has an unsupported account label or an unknown creation date. Keep the original file; migration cannot invent or discard that metadata.");
      return { account: record.account, ynxAccount: record.ynxAccount, publicKey: record.publicKey, label, createdAt: record.createdAt, state: "protected", encryptedSecret: record.encryptedSecret };
    } catch (error) { if (error?.data?.code === "LEGACY_METADATA_INVALID") throw error; fail("WALLET_VAULT_INVALID", "An existing Wallet account does not match its public identity."); }
  });
  if (new Set(accounts.map(record => record.account)).size !== accounts.length || !accounts.some(record => record.account === value.activeAccount)) fail("WALLET_VAULT_INVALID", "The existing Wallet catalog is invalid.");
  return { accounts, activeAccount: value.activeAccount };
}
const publicLegacy = ({ encryptedSecret, ...record }) => record;

/** Password-encrypted V3 custody. OS storage is read only during explicit migration. */
export class PasswordWalletVault {
  #session = null; #digest = null; #preview = null; #previewEpoch = 0; #mutations = Promise.resolve();
  constructor({ filePath, legacyFilePaths = [], safeStorage, authorization, fileStore = new PasswordVaultFile(filePath), randomSecret = () => randomBytes(32).toString("hex"), now = Date.now } = {}) {
    if (!filePath || !authorization) throw new Error("Password Wallet requires storage and authorization");
    this.filePath = filePath; this.files = fileStore; this.legacyFilePaths = [...new Set(legacyFilePaths)]; this.safeStorage = safeStorage; this.authorization = authorization; this.randomSecret = randomSecret; this.now = now;
  }
  authorizer() { return Object.freeze({ available: () => true, method: "local-password-encrypted-vault", inProcess: true, authenticate: (input, guard) => this.authenticate(input, guard), invalidate: () => this.lock() }); }
  lock() { closePasswordVaultSession(this.#session); this.#session = null; this.#digest = null; this.cancelRecovery(); }
  cancelRecovery() { this.#previewEpoch++; if (this.#preview) { clearTimeout(this.#preview.timer); closePasswordVaultSession(this.#preview.candidate.session); this.#preview = null; } }
  async #legacy() {
    const sources = [];
    for (const filePath of this.legacyFilePaths) { const snapshot = await this.files.read(filePath, { legacy: true }); if (snapshot) sources.push({ filePath, snapshot, vault: legacyVault(snapshot.text) }); }
    const accounts = [];
    for (const source of sources) for (const record of source.vault.accounts) {
      const old = accounts.find(item => item.account === record.account);
      if (!old) accounts.push(publicLegacy(record));
      else if (old.publicKey !== record.publicKey || old.ynxAccount !== record.ynxAccount) fail("WALLET_VAULT_INVALID", "Existing Wallet files disagree on an account identity.");
    }
    if (accounts.length > 32) fail("ACCOUNT_LIMIT", "Existing Wallet files contain more than 32 accounts. Preserve them for separate recovery.");
    return { sources, accounts, activeAccount: sources[0]?.vault.activeAccount ?? null };
  }
  async status() {
    const snapshot = await this.files.read();
    let catalog, custody, formatError = null, configured = snapshot !== null;
    if (snapshot) {
      catalog = readPasswordVaultPublicMetadata(snapshot.text); // Never fall back to OS-only keys when V3 exists.
      try { parsePasswordVault(snapshot.text); } catch (error) { formatError = error?.data?.code ?? "PASSWORD_VAULT_INVALID"; }
      custody = "password-encrypted-local";
    } else { const legacy = await this.#legacy(); catalog = legacy; custody = legacy.accounts.length ? "legacy-migration-required" : "not-created"; }
    const active = catalog.accounts.find(record => record.account === catalog.activeAccount) ?? null;
    const legacyFilesPresent = (await Promise.all(this.legacyFilePaths.map(filePath => this.files.exists(filePath)))).some(Boolean);
    return Object.freeze({ initialized: active !== null, account: active?.account ?? null, ynxAccount: active?.ynxAccount ?? null, accounts: Object.freeze(catalog.accounts.map(record => Object.freeze({ ...record, ...(formatError ? { state: "recovery-required" } : {}) }))), custody, passwordConfigured: configured, recoveryRequired: Boolean(formatError || active?.state === "recovery-required"), formatError, catalogAuthenticated: Boolean(snapshot && this.#session && this.#digest === snapshot.digest), legacyCleanupPending: configured && legacyFilesPresent, secretExported: false });
  }
  async authenticate({ password } = {}, guard) {
    guard.assert(); const snapshot = await this.files.read(); guard.assert();
    if (!snapshot) fail("PASSWORD_VAULT_NOT_CONFIGURED", "Set a local password or explicitly migrate the existing Wallet first.");
    let session;
    try {
      session = await unlockPasswordVault(snapshot.text, password, options(guard));
      await this.files.assertCurrent(snapshot.digest, guard);
      return Object.freeze({ account: parsePasswordVault(snapshot.text).activeAccount, commit: () => { guard.assert(); closePasswordVaultSession(this.#session); this.#session = session; this.#digest = snapshot.digest; }, discard: () => closePasswordVaultSession(session) });
    } catch (error) { closePasswordVaultSession(session); throw error; }
  }
  #serialize(action) { const result = this.#mutations.then(action); this.#mutations = result.catch(() => {}); return result; }
  async #readUnlocked(guard) {
    guard.assert(); const snapshot = await this.files.read(); guard.assert();
    if (!snapshot || !this.#session || this.#digest !== snapshot.digest) { this.authorization.lock(); throw vaultStorageError("PASSWORD_VAULT_FILE_CHANGED"); }
    return { snapshot, vault: parsePasswordVault(snapshot.text), session: this.#session };
  }
  async #verify(candidate, text, guard) {
    const vault = parsePasswordVault(text);
    // Check every protected identity before accepting a durable candidate, not just the active one.
    for (const record of vault.accounts) if (record.state === "protected") await decryptPasswordVaultRecord(vault, record.account, candidate.session, options(guard));
  }
  async #publish(candidate, expected, guard, install = false, beforeCommit) {
    try {
      const digest = await this.files.publish(candidate.vault, expected, guard, text => this.#verify(candidate, text, guard), beforeCommit);
      guard.assert();
      if (install) { closePasswordVaultSession(this.#session); this.#session = candidate.session; this.#digest = digest; }
      else closePasswordVaultSession(candidate.session);
    } catch (error) {
      closePasswordVaultSession(candidate.session); this.lock();
      let ownsGeneration = false; try { guard.assert(); ownsGeneration = true; } catch {}
      if (ownsGeneration) this.authorization.lock();
      throw error;
    }
  }
  async setup({ password, confirmation, migrateLegacy = false } = {}, guard, { beforePublish } = {}) {
    return this.#serialize(async () => {
      guard.assert(); passwordPair(password, confirmation);
      if (await this.files.read()) fail("PASSWORD_VAULT_ALREADY_CONFIGURED", "This Wallet already has a password. Unlock it or use explicit offline recovery.");
      const legacy = await this.#legacy(); guard.assert();
      if (legacy.accounts.length && migrateLegacy !== true) fail("LEGACY_MIGRATION_REQUIRED", "Review and explicitly migrate all existing local accounts before setting a password.");
      let candidate;
      try {
        candidate = await createPasswordVault({ password, accounts: [], activeAccount: null }, options(guard));
        // One plaintext key at a time; no unprotected migration journal and no deletion of old files.
        for (const source of legacy.sources) for (const record of source.vault.accounts) {
          guard.assert();
          if (!this.safeStorage?.isEncryptionAvailable() || this.safeStorage.getSelectedStorageBackend?.() === "basic_text") fail("LEGACY_RECOVERY_REQUIRED", "OS protection is unavailable. Restore the existing accounts from offline backups.");
          let secret;
          try {
            try {
              if (typeof this.safeStorage.decryptStringAsync === "function") secret = (await this.safeStorage.decryptStringAsync(Buffer.from(record.encryptedSecret, "base64")))?.result;
              else secret = this.safeStorage.decryptString(Buffer.from(record.encryptedSecret, "base64"));
            } catch { fail("LEGACY_RECOVERY_REQUIRED", "An existing key could not be opened by the OS. All original files were kept for offline recovery."); }
            guard.assert();
            let identity; try { identity = identityFor(secret); } catch { fail("PASSWORD_VAULT_IDENTITY_MISMATCH", "An existing key does not match its public account."); }
            if (["account", "ynxAccount", "publicKey"].some(key => identity[key] !== record[key])) fail("PASSWORD_VAULT_IDENTITY_MISMATCH", "An existing key does not match its public account.");
            if (!candidate.vault.accounts.some(item => item.account === record.account)) {
              const next = await rewritePasswordVault(candidate.vault, { accounts: [...candidate.vault.accounts, { ...publicLegacy(record), secretHex: secret }], activeAccount: candidate.vault.activeAccount ?? record.account }, candidate.session, options(guard));
              closePasswordVaultSession(candidate.session); candidate = next;
            }
          } finally { secret = null; }
        }
        if (candidate.vault.activeAccount !== legacy.activeAccount) {
          const next = await rewritePasswordVault(candidate.vault, { activeAccount: legacy.activeAccount }, candidate.session, options(guard)); closePasswordVaultSession(candidate.session); candidate = next;
        }
        for (const source of legacy.sources) { const current = await this.files.read(source.filePath, { legacy: true }); guard.assert(); if (current?.digest !== source.snapshot.digest) throw vaultStorageError("PASSWORD_VAULT_FILE_CHANGED"); }
        await this.#publish(candidate, null, guard, false, beforePublish);
        return this.status();
      } finally { closePasswordVaultSession(candidate?.session); password = null; confirmation = null; }
    });
  }
  async createAccount() { return this.#add(null, true); }
  async addAccountAndSelect() { return this.#add(null, false); }
  async importAccount(input) { return this.#add(input, false); }
  async #add(input, onlyFirst) {
    const guard = this.authorization.current();
    return this.#serialize(async () => {
      const current = await this.#readUnlocked(guard);
      if (onlyFirst && current.vault.accounts.length) return this.status();
      if (current.vault.accounts.length >= 32) fail("ACCOUNT_LIMIT", "This Wallet supports up to 32 accounts.");
      let secret;
      try {
        secret = input ? await importSecret(input, guard) : this.randomSecret(); guard.assert();
        const identity = identityFor(secret);
        if (current.vault.accounts.some(record => record.account === identity.account)) fail("DUPLICATE_ACCOUNT", "This account already exists. Use explicit recovery to restore its key.");
        const candidate = await rewritePasswordVault(current.vault, { accounts: [...current.vault.accounts, { secretHex: secret }], activeAccount: identity.account }, current.session, options(guard));
        await this.#publish(candidate, current.snapshot.digest, guard, true); return this.status();
      } finally { secret = null; }
    });
  }
  async selectAccount(account) {
    const guard = this.authorization.current();
    return this.#serialize(async () => {
      const current = await this.#readUnlocked(guard);
      if (!current.vault.accounts.some(record => record.account === account)) fail("UNKNOWN_WALLET_ACCOUNT", "The selected account does not exist.");
      const candidate = await rewritePasswordVault(current.vault, { activeAccount: account }, current.session, options(guard));
      await this.#publish(candidate, current.snapshot.digest, guard, true); return this.status();
    });
  }
  async withSecret(action) {
    const guard = this.authorization.current(), current = await this.#readUnlocked(guard), account = current.vault.activeAccount;
    if (!account) fail("ACCOUNT_NOT_CREATED", "Create or import an account first.");
    if (guard.account !== account) throw cancelled();
    let secret;
    try {
      secret = await decryptPasswordVaultRecord(current.vault, account, current.session, options(guard));
      await this.files.assertCurrent(current.snapshot.digest, guard);
      const record = current.vault.accounts.find(item => item.account === account);
      return await guard.step(() => action(secret, Object.freeze({ account, ynxAccount: record.ynxAccount, publicKey: record.publicKey }), guard));
    } finally { secret = null; }
  }
  async encryptedBackup(password) {
    if (typeof password !== "string" || password.length < 12 || password.length > 1024) fail("BACKUP_PASSWORD_REQUIRED", "Use a backup password of at least 12 characters.");
    return this.withSecret(secret => new Wallet(`0x${secret}`).encrypt(password));
  }
  async recoveryHistory() {
    const current = await this.status(), result = [];
    for (const id of (await this.files.history()).slice(0, 64)) {
      try {
        const snapshot = await this.files.readHistory(id), catalog = readPasswordVaultPublicMetadata(snapshot.text);
        result.push(Object.freeze({ id, revision: catalog.revision, accounts: catalog.accounts.filter(record => record.state === "protected" && current.accounts.some(item => item.account === record.account)).map(record => record.account) }));
      } catch { /* A damaged archive never becomes an alternate unlock path. */ }
    }
    return Object.freeze(result);
  }
  async prepareRecovery(input = {}, guard) {
    this.cancelRecovery();
    const outer = guard, epoch = this.#previewEpoch;
    guard = Object.freeze({ revision: outer.revision, assert: () => { outer.assert(); if (epoch !== this.#previewEpoch) throw cancelled(); } });
    guard.assert();
    const snapshot = await this.files.read(), legacy = snapshot ? null : await this.#legacy(); guard.assert();
    const catalog = snapshot ? readPasswordVaultPublicMetadata(snapshot.text) : legacy;
    const record = catalog.accounts.find(item => item.account === input.account);
    if (!record) fail("UNKNOWN_WALLET_ACCOUNT", "Recovery must match an existing public account.");
    let secret, candidate, currentSession;
    try {
      if (input.kind === "previous-password") {
        const archived = await this.files.readHistory(input.value); guard.assert();
        let oldSession;
        try { oldSession = await unlockPasswordVault(archived.text, input.backupPassword, options(guard)); secret = await decryptPasswordVaultRecord(archived.text, record.account, oldSession, options(guard)); }
        finally { closePasswordVaultSession(oldSession); }
      } else secret = await importSecret({ kind: input.kind, value: input.value, password: input.backupPassword ?? "" }, guard);
      if (identityFor(secret).account !== record.account) fail("PASSWORD_VAULT_IDENTITY_MISMATCH", "This backup belongs to a different account. Existing accounts were kept.");
      if (input.resetPassword === true) {
        passwordPair(input.newPassword, input.confirmation);
        candidate = await createPasswordVault({ password: input.newPassword, revision: (catalog.revision ?? 0) + 1, activeAccount: record.account, accounts: catalog.accounts.map(item => item.account === record.account ? { ...item, state: "protected", secretHex: secret } : { ...item, state: "recovery-required" }) }, options(guard));
      } else {
        if (!snapshot) fail("PASSWORD_VAULT_NOT_CONFIGURED", "Set a new local password when recovering an OS-protected Wallet.");
        const vault = parsePasswordVault(snapshot.text);
        currentSession = await unlockPasswordVault(vault, input.currentPassword, options(guard));
        candidate = await rewritePasswordVault(vault, { accounts: vault.accounts.map(item => item.account === record.account ? { ...item, state: "protected", secretHex: secret } : item), activeAccount: record.account }, currentSession, options(guard));
      }
      await this.files.assertCurrent(snapshot?.digest ?? null, guard);
      const previewId = randomUUID(), expiresAt = this.now() + 60_000;
      const preview = { id: previewId, expiresAt, revision: guard.revision, snapshot, legacy, candidate, account: record.account, resetPassword: input.resetPassword === true };
      guard.assert(); this.#preview = preview;
      preview.timer = setTimeout(() => { if (this.#preview === preview) this.cancelRecovery(); }, 60_000); preview.timer.unref?.();
      return Object.freeze({ previewId, account: record.account, resetPassword: preview.resetPassword, recoveryRequiredAccounts: candidate.vault.accounts.filter(item => item.state === "recovery-required").map(item => item.account), expiresAt });
    } catch (error) { closePasswordVaultSession(candidate?.session); throw error; }
    finally { closePasswordVaultSession(currentSession); secret = null; }
  }
  async commitRecovery(previewId, guard, { beforePublish } = {}) {
    return this.#serialize(async () => {
      const preview = this.#preview;
      if (!preview || preview.id !== previewId || preview.expiresAt <= this.now() || preview.revision !== guard.revision) { this.cancelRecovery(); throw cancelled(); }
      guard.assert();
      try {
        await this.files.assertCurrent(preview.snapshot?.digest ?? null, guard);
        if (preview.legacy) for (const source of preview.legacy.sources) { const current = await this.files.read(source.filePath, { legacy: true }); guard.assert(); if (current?.digest !== source.snapshot.digest) throw vaultStorageError("PASSWORD_VAULT_FILE_CHANGED"); }
        // Preserve the exact old encrypted generation before replacing the password.
        // It can be used for later offline restoration of the remaining identities.
        if (preview.resetPassword) await this.files.preserve(preview.snapshot, guard);
        await this.#publish(preview.candidate, preview.snapshot?.digest ?? null, guard, false, async () => {
          guard.assert();
          if (this.#preview !== preview || preview.expiresAt <= this.now() || preview.revision !== guard.revision) throw cancelled();
          await beforePublish?.(); guard.assert();
          if (this.#preview !== preview || preview.expiresAt <= this.now()) throw cancelled();
        });
        return this.status();
      } finally { this.cancelRecovery(); }
    });
  }
}

/** Bounded import parser. Passwords and plaintext never enter public errors or journals. */
async function importSecret({ kind, value, password = "" } = {}, guard) {
  guard.assert();
  if (typeof value !== "string" || value.length < 1 || value.length > 100_000 || typeof password !== "string" || password.length > 1024) fail("INVALID_IMPORT", "Enter a valid Wallet backup.");
  let secret;
  try {
    if (kind === "private-key" && /^(0x)?[0-9a-fA-F]{64}$/.test(value.trim())) secret = new Wallet(value.trim().replace(/^(?!0x)/, "0x")).privateKey.slice(2);
    else if (kind === "recovery-phrase" && [12, 15, 18, 21, 24].includes(value.trim().split(/\s+/).length)) secret = Wallet.fromPhrase(value.trim().replace(/\s+/g, " ")).privateKey.slice(2);
    else if (kind === "encrypted-json") {
      const json = JSON.parse(value), crypto = json.crypto ?? json.Crypto, kdf = crypto?.kdfparams;
      if (json.version !== 3 || crypto?.cipher !== "aes-128-ctr" || !/^[0-9a-f]{64}$/i.test(crypto.ciphertext) || !/^[0-9a-f]{32}$/i.test(crypto.cipherparams?.iv) || !/^[0-9a-f]{64}$/i.test(crypto.mac) || !/^[0-9a-f]{32,128}$/i.test(kdf?.salt) || kdf.salt.length % 2 || kdf.dklen !== 32) throw new Error();
      if (crypto.kdf === "scrypt") { if (!Number.isSafeInteger(kdf.n) || kdf.n < 2 || kdf.n > 262_144 || (kdf.n & (kdf.n - 1)) !== 0 || !Number.isSafeInteger(kdf.r) || kdf.r < 1 || kdf.r > 8 || !Number.isSafeInteger(kdf.p) || kdf.p < 1 || kdf.p > 4 || kdf.n * kdf.r * kdf.p > 2_097_152) throw new Error(); }
      else if (crypto.kdf === "pbkdf2") { if (kdf.prf !== "hmac-sha256" || !Number.isSafeInteger(kdf.c) || kdf.c < 1 || kdf.c > 1_000_000) throw new Error(); }
      else throw new Error();
      secret = (await Wallet.fromEncryptedJson(value, password)).privateKey.slice(2);
    } else throw new Error();
    guard.assert(); return secret;
  } catch (error) { if (error?.data?.code === "WALLET_OPERATION_CANCELLED") throw error; fail("INVALID_IMPORT", "The backup is invalid, uses unsupported encryption parameters, or its password is incorrect."); }
  finally { secret = null; }
}
