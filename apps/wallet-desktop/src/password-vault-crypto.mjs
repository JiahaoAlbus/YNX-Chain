import { createHash, webcrypto } from "node:crypto";
import { evmAddressFromYNX, walletIdentity, walletIdentityFromPublicKey } from "@ynx-chain/wallet-auth";

export const PASSWORD_VAULT_CRYPTO_SUITE = "ynx-desktop-password-v1";
export const PASSWORD_VAULT_KDF_ITERATIONS = 600_000;
export const PASSWORD_VAULT_MAX_ACCOUNTS = 32;
const MAX_BYTES = 65_536, encoder = new TextEncoder(), sessions = new WeakMap();
const META_KEYS = ["account", "ynxAccount", "publicKey", "label", "createdAt", "state"];
const VAULT_KEYS = ["schemaVersion", "cryptoSuite", "vaultId", "revision", "activeAccount", "accounts", "passwordWrap", "catalogCipher", "records"];
const messages = {
  PASSWORD_VAULT_INVALID: "The password-protected Wallet format is invalid.",
  PASSWORD_VAULT_NOT_CONFIGURED: "Set a local Wallet password first.",
  PASSWORD_VAULT_UNSUPPORTED_SUITE: "This Wallet encryption version is unsupported.",
  PASSWORD_VAULT_KDF_INVALID: "The Wallet password derivation parameters are unsupported.",
  PASSWORD_VAULT_PASSWORD_INVALID: "Use a local Wallet password of 12 to 256 characters.",
  PASSWORD_VAULT_UNLOCK_FAILED: "The password is incorrect or the encrypted Wallet was changed.",
  PASSWORD_VAULT_TAMPERED: "The encrypted Wallet could not be authenticated.",
  PASSWORD_VAULT_IDENTITY_MISMATCH: "The key does not match the public Wallet account.",
  PASSWORD_VAULT_SESSION_INVALID: "Unlock this exact Wallet revision before continuing.",
  PASSWORD_VAULT_RECOVERY_REQUIRED: "Restore this account from its offline backup.",
  PASSWORD_VAULT_REVISION_INVALID: "The Wallet revision changed. Reload before continuing.",
  PASSWORD_VAULT_CRYPTO_FAILED: "Wallet encryption could not complete.",
  WALLET_OPERATION_CANCELLED: "This Wallet operation was cancelled.",
};
function fail(code) { throw Object.assign(new Error(messages[code] ?? messages.PASSWORD_VAULT_INVALID), { code, data: { code } }); }
function exact(value, keys, code = "PASSWORD_VAULT_INVALID") {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"))) fail(code);
  return value;
}
function inputObject(value, keys) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("PASSWORD_VAULT_INVALID");
  exact(value, Reflect.ownKeys(value));
  if (Reflect.ownKeys(value).some(key => !keys.includes(key))) fail("PASSWORD_VAULT_INVALID");
  return value;
}
function list(value) {
  if (!Array.isArray(value) || value.length > PASSWORD_VAULT_MAX_ACCOUNTS || Reflect.ownKeys(value).length !== value.length + 1) fail("PASSWORD_VAULT_INVALID");
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index)) ?? {}, "value")) fail("PASSWORD_VAULT_INVALID");
  return value;
}
function freeze(value) { for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child); return Object.freeze(value); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(vault) { return createHash("sha256").update(canonical(vault)).digest("hex"); }
function random(size) { return webcrypto.getRandomValues(new Uint8Array(size)); }
function b64(bytes) { return Buffer.from(bytes).toString("base64url"); }
function decode(value, size, code = "PASSWORD_VAULT_INVALID") {
  if (typeof value !== "string" || value.length !== Math.ceil(size * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) fail(code);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== size || b64(bytes) !== value) fail(code);
  return bytes;
}
function cipher(value, size) {
  exact(value, ["name", "iv", "ciphertext"]);
  if (value.name !== "AES-GCM") fail("PASSWORD_VAULT_UNSUPPORTED_SUITE");
  decode(value.iv, 12); decode(value.ciphertext, size + 16);
  return { name: "AES-GCM", iv: value.iv, ciphertext: value.ciphertext };
}
function publicMetadata(value) {
  exact(value, META_KEYS);
  if (typeof value.account !== "string" || !/^0x[0-9a-f]{40}$/.test(value.account) || typeof value.ynxAccount !== "string" || value.ynxAccount.length !== 42 || typeof value.publicKey !== "string" || !/^(02|03)[0-9a-f]{64}$/.test(value.publicKey)) fail("PASSWORD_VAULT_IDENTITY_MISMATCH");
  try { if (walletIdentityFromPublicKey(value.publicKey) !== value.ynxAccount || evmAddressFromYNX(value.ynxAccount) !== value.account) fail("PASSWORD_VAULT_IDENTITY_MISMATCH"); }
  catch { fail("PASSWORD_VAULT_IDENTITY_MISMATCH"); }
  if (typeof value.label !== "string" || value.label.length > 120 || encoder.encode(value.label).length > 480 || /[\u0000-\u001f\u007f]/u.test(value.label)) fail("PASSWORD_VAULT_INVALID");
  if (typeof value.createdAt !== "string" || value.createdAt.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) fail("PASSWORD_VAULT_INVALID");
  if (!["protected", "recovery-required"].includes(value.state)) fail("PASSWORD_VAULT_INVALID");
  return Object.fromEntries(META_KEYS.map(key => [key, value[key]]));
}
function revision(value) { if (!Number.isSafeInteger(value) || value < 1) fail("PASSWORD_VAULT_REVISION_INVALID"); return value; }
function validCatalog(accounts, activeAccount) {
  if (new Set(accounts.map(item => item.account)).size !== accounts.length || (accounts.length === 0 ? activeAccount !== null : !accounts.some(item => item.account === activeAccount))) fail("PASSWORD_VAULT_INVALID");
}

/** Public-only read: absent vault returns null; this performs no KDF/decryption. */
export function parsePasswordVault(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    if (Buffer.byteLength(value) > MAX_BYTES) fail("PASSWORD_VAULT_INVALID");
    try { value = JSON.parse(value); } catch { fail("PASSWORD_VAULT_INVALID"); }
  }
  exact(value, VAULT_KEYS);
  if (value.schemaVersion !== 3 || value.cryptoSuite !== PASSWORD_VAULT_CRYPTO_SUITE) fail("PASSWORD_VAULT_UNSUPPORTED_SUITE");
  if (typeof value.vaultId !== "string" || !/^[0-9a-f]{32}$/.test(value.vaultId)) fail("PASSWORD_VAULT_INVALID");
  revision(value.revision);
  list(value.accounts); list(value.records);
  const accounts = value.accounts.map(publicMetadata); validCatalog(accounts, value.activeAccount);
  exact(value.passwordWrap, ["kdf", "cipher"]); exact(value.passwordWrap.kdf, ["name", "hash", "iterations", "salt"], "PASSWORD_VAULT_KDF_INVALID");
  const kdf = value.passwordWrap.kdf;
  if (kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256" || kdf.iterations !== PASSWORD_VAULT_KDF_ITERATIONS) fail("PASSWORD_VAULT_KDF_INVALID");
  decode(kdf.salt, 16, "PASSWORD_VAULT_KDF_INVALID");
  const protectedAccounts = accounts.filter(item => item.state === "protected");
  if (value.records.length !== protectedAccounts.length) fail("PASSWORD_VAULT_INVALID");
  const records = value.records.map((record, index) => {
    exact(record, ["account", "cipher"]);
    if (record.account !== protectedAccounts[index].account) fail("PASSWORD_VAULT_INVALID");
    return { account: record.account, cipher: cipher(record.cipher, 32) };
  });
  const catalogCipher = cipher(value.catalogCipher, 0), ivs = [catalogCipher.iv, ...records.map(record => record.cipher.iv)];
  if (new Set(ivs).size !== ivs.length) fail("PASSWORD_VAULT_INVALID");
  const result = { schemaVersion: 3, cryptoSuite: PASSWORD_VAULT_CRYPTO_SUITE, vaultId: value.vaultId, revision: value.revision, activeAccount: value.activeAccount, accounts, passwordWrap: { kdf: { name: kdf.name, hash: kdf.hash, iterations: kdf.iterations, salt: kdf.salt }, cipher: cipher(value.passwordWrap.cipher, 32) }, catalogCipher, records };
  if (Buffer.byteLength(canonical(result)) > MAX_BYTES) fail("PASSWORD_VAULT_INVALID");
  return freeze(result);
}
/** Recovery display only: authenticates no ciphertext and never grants a key handle. */
export function readPasswordVaultPublicMetadata(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    if (Buffer.byteLength(value) > MAX_BYTES) fail("PASSWORD_VAULT_INVALID");
    try { value = JSON.parse(value); } catch { fail("PASSWORD_VAULT_INVALID"); }
  }
  inputObject(value, VAULT_KEYS);
  if (value.schemaVersion !== 3) fail("PASSWORD_VAULT_UNSUPPORTED_SUITE");
  if (typeof value.vaultId !== "string" || !/^[0-9a-f]{32}$/.test(value.vaultId)) fail("PASSWORD_VAULT_INVALID");
  revision(value.revision); list(value.accounts);
  const accounts = value.accounts.map(publicMetadata); validCatalog(accounts, value.activeAccount);
  return freeze({ schemaVersion: 3, vaultId: value.vaultId, revision: value.revision, activeAccount: value.activeAccount, accounts, cryptoSuiteSupported: value.cryptoSuite === PASSWORD_VAULT_CRYPTO_SUITE, catalogAuthenticated: false });
}
function requiredVault(value) { const vault = parsePasswordVault(value); if (!vault) fail("PASSWORD_VAULT_NOT_CONFIGURED"); return vault; }
function checkpoint(options, stage) {
  if (options?.signal?.aborted) fail("WALLET_OPERATION_CANCELLED");
  if (options?.guard !== undefined) {
    if (typeof options.guard !== "function") fail("PASSWORD_VAULT_INVALID");
    // The owner supplies a synchronous generation/account/deadline assertion.
    const result = options.guard(stage);
    if (result && typeof result.then === "function") { void Promise.resolve(result).catch(() => {}); fail("PASSWORD_VAULT_INVALID"); }
  }
  if (options?.signal?.aborted) fail("WALLET_OPERATION_CANCELLED");
}
function wipe(value) { if (value instanceof ArrayBuffer) new Uint8Array(value).fill(0); else if (ArrayBuffer.isView(value)) new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(0); }
async function cryptoStep(action, options, stage, code = "PASSWORD_VAULT_CRYPTO_FAILED") {
  checkpoint(options, `${stage}:before`);
  let value;
  try { value = await action(); } catch { checkpoint(options, `${stage}:failed`); fail(code); }
  try { checkpoint(options, `${stage}:after`); return value; } catch (error) { wipe(value); throw error; }
}
function passwordBytes(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 256 || !password.isWellFormed()) fail("PASSWORD_VAULT_PASSWORD_INVALID");
  const bytes = encoder.encode(password);
  if (bytes.length > 1024) { bytes.fill(0); fail("PASSWORD_VAULT_PASSWORD_INVALID"); }
  return bytes;
}
async function wrapperKey(password, kdf, options) {
  const bytes = passwordBytes(password);
  try {
    const base = await cryptoStep(() => webcrypto.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]), options, "password-import");
    return await cryptoStep(() => webcrypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", iterations: PASSWORD_VAULT_KDF_ITERATIONS, salt: decode(kdf.salt, 16) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]), options, "password-kdf");
  } finally { bytes.fill(0); }
}
function wrapAAD(vault) { return { domain: "YNX_DESKTOP_PASSWORD_WRAP_V3", schemaVersion: 3, cryptoSuite: vault.cryptoSuite, vaultId: vault.vaultId, kdf: vault.passwordWrap.kdf }; }
function recordAAD(vault, account) { return { domain: "YNX_DESKTOP_ACCOUNT_RECORD_V3", schemaVersion: 3, vaultId: vault.vaultId, account: account.account, ynxAccount: account.ynxAccount, publicKey: account.publicKey }; }
function catalogAAD(vault) { const { catalogCipher, ...header } = vault; return { domain: "YNX_DESKTOP_ACCOUNT_CATALOG_V3", ...header }; }
async function encrypt(key, bytes, aad, usedIVs, options, stage) {
  let iv;
  for (let attempt = 0; attempt < 16; attempt++) { iv = b64(random(12)); if (!usedIVs.has(iv)) break; }
  if (usedIVs.has(iv)) fail("PASSWORD_VAULT_CRYPTO_FAILED");
  usedIVs.add(iv);
  const encrypted = await cryptoStep(() => webcrypto.subtle.encrypt({ name: "AES-GCM", iv: decode(iv, 12), additionalData: encoder.encode(canonical(aad)), tagLength: 128 }, key, bytes), options, stage);
  return { name: "AES-GCM", iv, ciphertext: b64(encrypted) };
}
async function decrypt(key, value, size, aad, options, stage, code = "PASSWORD_VAULT_TAMPERED") {
  return new Uint8Array(await cryptoStep(() => webcrypto.subtle.decrypt({ name: "AES-GCM", iv: decode(value.iv, 12), additionalData: encoder.encode(canonical(aad)), tagLength: 128 }, key, decode(value.ciphertext, size + 16)), options, stage, code));
}
function identity(secretHex) {
  try {
    if (typeof secretHex !== "string" || !/^[0-9a-f]{64}$/.test(secretHex)) fail("PASSWORD_VAULT_IDENTITY_MISMATCH");
    const derived = walletIdentity(secretHex);
    return { account: evmAddressFromYNX(derived.account), ynxAccount: derived.account, publicKey: derived.accountPublicKey };
  } catch { fail("PASSWORD_VAULT_IDENTITY_MISMATCH"); }
}
function accountInputs(values, oldVault = null) {
  list(values);
  return values.map(input => {
    inputObject(input, [...META_KEYS, "secretHex"]);
    for (const field of META_KEYS) if (Object.hasOwn(input, field) && input[field] === null) fail("PASSWORD_VAULT_INVALID");
    const old = oldVault?.accounts.find(item => item.account === input.account);
    const derived = input.secretHex === undefined ? null : identity(input.secretHex);
    for (const key of ["account", "ynxAccount", "publicKey"]) if (derived && input[key] !== undefined && input[key] !== derived[key]) fail("PASSWORD_VAULT_IDENTITY_MISMATCH");
    const meta = publicMetadata({ account: input.account ?? derived?.account ?? old?.account, ynxAccount: input.ynxAccount ?? derived?.ynxAccount ?? old?.ynxAccount, publicKey: input.publicKey ?? derived?.publicKey ?? old?.publicKey, label: input.label ?? old?.label ?? "", createdAt: input.createdAt ?? old?.createdAt ?? new Date().toISOString(), state: input.state ?? (derived ? "protected" : old?.state) });
    if (meta.state === "recovery-required" && (derived || old?.state === "protected") || meta.state === "protected" && !derived && old?.state !== "protected") fail("PASSWORD_VAULT_INVALID");
    return { meta, secretHex: input.secretHex };
  });
}
function handle(vault, key) {
  const session = Object.freeze({ version: 1, vaultId: vault.vaultId, revision: vault.revision });
  sessions.set(session, { key, fingerprint: fingerprint(vault), closed: false }); return session;
}
function sessionKey(vault, session) {
  const state = sessions.get(session);
  if (!state || state.closed || !state.key || state.fingerprint !== fingerprint(vault)) fail("PASSWORD_VAULT_SESSION_INVALID");
  return state.key;
}
function guardedSession(vault, session, options) { return { signal: options?.signal, guard(stage) { checkpoint(options, stage); sessionKey(vault, session); } }; }
export function closePasswordVaultSession(session) { const state = sessions.get(session); if (state) { state.closed = true; state.key = null; } }
export function passwordVaultSessionStatus(session) {
  const state = sessions.get(session);
  return Object.freeze({ active: Boolean(state && !state.closed && state.key), keyExtractable: state?.key?.extractable ?? null, vaultId: session?.vaultId ?? null, revision: session?.revision ?? null });
}
async function secretForRecord(vault, account, key, options) {
  const meta = vault.accounts.find(item => item.account === account);
  if (!meta) fail("PASSWORD_VAULT_IDENTITY_MISMATCH");
  if (meta.state !== "protected") fail("PASSWORD_VAULT_RECOVERY_REQUIRED");
  const bytes = await decrypt(key, vault.records.find(item => item.account === account).cipher, 32, recordAAD(vault, meta), options, "record-decrypt");
  try {
    const secret = Buffer.from(bytes).toString("hex"), derived = identity(secret);
    if (["account", "ynxAccount", "publicKey"].some(field => derived[field] !== meta[field])) fail("PASSWORD_VAULT_IDENTITY_MISMATCH");
    checkpoint(options, "record-identity:after"); return secret;
  } finally { bytes.fill(0); }
}
async function verifyCatalog(vault, key, options) {
  const plaintext = await decrypt(key, vault.catalogCipher, 0, catalogAAD(vault), options, "catalog-decrypt"); plaintext.fill(0);
}
async function assemble(vault, inputs, key, options, oldVault = null) {
  const used = new Set(oldVault ? [oldVault.catalogCipher.iv, ...oldVault.records.map(item => item.cipher.iv)] : []), records = [];
  for (const { meta, secretHex } of inputs) {
    checkpoint(options, "record-prepare:before");
    if (meta.state === "recovery-required") continue;
    if (secretHex === undefined) { records.push(oldVault.records.find(item => item.account === meta.account)); continue; }
    const bytes = Buffer.from(secretHex, "hex");
    try { records.push({ account: meta.account, cipher: await encrypt(key, bytes, recordAAD(vault, meta), used, options, "record-encrypt") }); } finally { bytes.fill(0); }
  }
  vault.records = records;
  vault.catalogCipher = await encrypt(key, new Uint8Array(), catalogAAD(vault), used, options, "catalog-encrypt");
  const parsed = requiredVault(vault); await verifyCatalog(parsed, key, options);
  if (parsed.accounts.find(item => item.account === parsed.activeAccount)?.state === "protected") await secretForRecord(parsed, parsed.activeAccount, key, options);
  for (const { meta, secretHex } of inputs) if (secretHex !== undefined && meta.account !== parsed.activeAccount) await secretForRecord(parsed, meta.account, key, options);
  checkpoint(options, "candidate:ready"); return parsed;
}

/** Creates a candidate only. The owner atomically persists it before using session authority. */
export async function createPasswordVault(input, options = {}) {
  inputObject(input, ["password", "accounts", "activeAccount", "revision"]); checkpoint(options, "create:start");
  const inputs = accountInputs(input.accounts), accounts = inputs.map(item => item.meta), activeAccount = input.activeAccount === undefined ? accounts[0]?.account ?? null : input.activeAccount;
  validCatalog(accounts, activeAccount);
  const vault = { schemaVersion: 3, cryptoSuite: PASSWORD_VAULT_CRYPTO_SUITE, vaultId: Buffer.from(random(16)).toString("hex"), revision: revision(input.revision === undefined ? 1 : input.revision), activeAccount, accounts, passwordWrap: { kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PASSWORD_VAULT_KDF_ITERATIONS, salt: b64(random(16)) } }, records: [] };
  const dek = random(32);
  try {
    const wrapper = await wrapperKey(input.password, vault.passwordWrap.kdf, options);
    vault.passwordWrap.cipher = await encrypt(wrapper, dek, wrapAAD(vault), new Set(), options, "dek-wrap");
    const verifiedDEK = await decrypt(wrapper, vault.passwordWrap.cipher, 32, wrapAAD(vault), options, "dek-wrap-readback");
    let key; try { key = await cryptoStep(() => webcrypto.subtle.importKey("raw", verifiedDEK, "AES-GCM", false, ["encrypt", "decrypt"]), options, "dek-import"); } finally { verifiedDEK.fill(0); }
    const parsed = await assemble(vault, inputs, key, options);
    checkpoint(options, "create:ready"); return Object.freeze({ vault: parsed, session: handle(parsed, key) });
  } finally { dek.fill(0); for (const item of inputs) item.secretHex = null; }
}

/** Verifies wrapper, complete catalog and active protected identity before returning an opaque key handle. */
export async function unlockPasswordVault(value, password, options = {}) {
  checkpoint(options, "unlock:start"); const vault = requiredVault(value), wrapper = await wrapperKey(password, vault.passwordWrap.kdf, options);
  const dek = await decrypt(wrapper, vault.passwordWrap.cipher, 32, wrapAAD(vault), options, "dek-unwrap", "PASSWORD_VAULT_UNLOCK_FAILED");
  try {
    const key = await cryptoStep(() => webcrypto.subtle.importKey("raw", dek, "AES-GCM", false, ["encrypt", "decrypt"]), options, "dek-import");
    await verifyCatalog(vault, key, options);
    if (vault.accounts.find(item => item.account === vault.activeAccount)?.state === "protected") await secretForRecord(vault, vault.activeAccount, key, options);
    checkpoint(options, "unlock:ready"); return handle(vault, key);
  } finally { dek.fill(0); }
}

export async function decryptPasswordVaultRecord(value, account, session, options = {}) {
  checkpoint(options, "read:start"); const vault = requiredVault(value), scoped = guardedSession(vault, session, options), key = sessionKey(vault, session);
  const secret = await secretForRecord(vault, account, key, scoped);
  checkpoint(scoped, "read:ready"); return secret;
}

/** Returns a staged next revision. Old session stays valid until the owner commits and closes it. */
export async function rewritePasswordVault(value, changes, session, options = {}) {
  inputObject(changes, ["accounts", "activeAccount", "revision"]); checkpoint(options, "rewrite:start");
  const old = requiredVault(value), key = sessionKey(old, session), scoped = guardedSession(old, session, options);
  const nextRevision = revision(changes.revision === undefined ? old.revision + 1 : changes.revision);
  if (nextRevision !== old.revision + 1) fail("PASSWORD_VAULT_REVISION_INVALID");
  const inputs = accountInputs(changes.accounts === undefined ? old.accounts : changes.accounts, old), accounts = inputs.map(item => item.meta);
  if (old.accounts.some(item => !accounts.some(next => next.account === item.account))) fail("PASSWORD_VAULT_INVALID");
  const activeAccount = changes.activeAccount === undefined ? old.activeAccount ?? accounts[0]?.account ?? null : changes.activeAccount;
  validCatalog(accounts, activeAccount);
  try {
    await verifyCatalog(old, key, scoped);
    const next = await assemble({ ...old, revision: nextRevision, activeAccount, accounts }, inputs, key, scoped, old);
    checkpoint(scoped, "rewrite:ready"); return Object.freeze({ vault: next, session: handle(next, key) });
  } finally { for (const item of inputs) item.secretHex = null; }
}
