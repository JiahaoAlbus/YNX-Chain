import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { evmAddressFromYNX, walletIdentity } from "@ynx-chain/wallet-auth";
import {
  PASSWORD_VAULT_CRYPTO_SUITE, PASSWORD_VAULT_KDF_ITERATIONS, PASSWORD_VAULT_MAX_ACCOUNTS,
  parsePasswordVault, readPasswordVaultPublicMetadata, createPasswordVault, unlockPasswordVault,
  decryptPasswordVaultRecord, rewritePasswordVault, closePasswordVaultSession, passwordVaultSessionStatus,
} from "../src/password-vault-crypto.mjs";

// Public synthetic fixtures only; shipping code contains no password or account default.
const PASSWORD = "synthetic wallet fixture password", OTHER_PASSWORD = "different synthetic fixture password";
const SECRET = "1".padStart(64, "0"), SECOND = "2".padStart(64, "0"), THIRD = "3".padStart(64, "0");
const metadata = (secret, label = "Fixture account", state = "protected") => {
  const identity = walletIdentity(secret);
  return { account: evmAddressFromYNX(identity.account), ynxAccount: identity.account, publicKey: identity.accountPublicKey, label, createdAt: "2026-09-06T00:00:00.000Z", state };
};
const FIRST = metadata(SECRET, "First fixture"), NEXT = metadata(SECOND, "Second fixture"), LOST = metadata(THIRD, "Keep this public identity", "recovery-required");
const baseline = await createPasswordVault({ password: PASSWORD, accounts: [{ ...FIRST, secretHex: SECRET }, { ...NEXT, secretHex: SECOND }, LOST], activeAccount: FIRST.account });
const clone = value => structuredClone(value);
const flip = value => { const bytes = Buffer.from(value, "base64url"); bytes[0] ^= 1; return bytes.toString("base64url"); };
const code = expected => error => error.code === expected && error.data.code === expected && !error.message.includes(SECRET) && !error.message.includes(PASSWORD);

// Independently constructs an authenticated but wrong-account record. This proves
// identity verification beyond detecting an unauthenticated ciphertext edit.
async function withWrongAuthenticatedRecord(vault, account, wrongSecret) {
  const output = clone(vault), encoder = new TextEncoder();
  const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
  const base = await webcrypto.subtle.importKey("raw", encoder.encode(PASSWORD), "PBKDF2", false, ["deriveKey"]);
  const wrapper = await webcrypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(vault.passwordWrap.kdf.salt, "base64url"), iterations: 600000 }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const wrapAAD = { domain: "YNX_DESKTOP_PASSWORD_WRAP_V3", schemaVersion: 3, cryptoSuite: vault.cryptoSuite, vaultId: vault.vaultId, kdf: vault.passwordWrap.kdf };
  const raw = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(vault.passwordWrap.cipher.iv, "base64url"), additionalData: encoder.encode(canonical(wrapAAD)), tagLength: 128 }, wrapper, Buffer.from(vault.passwordWrap.cipher.ciphertext, "base64url"));
  const key = await webcrypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]); new Uint8Array(raw).fill(0);
  const meta = vault.accounts.find(item => item.account === account), recordAAD = { domain: "YNX_DESKTOP_ACCOUNT_RECORD_V3", schemaVersion: 3, vaultId: vault.vaultId, account, ynxAccount: meta.ynxAccount, publicKey: meta.publicKey };
  async function encrypted(bytes, aad) { const iv = webcrypto.getRandomValues(new Uint8Array(12)); return { name: "AES-GCM", iv: Buffer.from(iv).toString("base64url"), ciphertext: Buffer.from(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(canonical(aad)), tagLength: 128 }, key, bytes)).toString("base64url") }; }
  output.records.find(item => item.account === account).cipher = await encrypted(Buffer.from(wrongSecret, "hex"), recordAAD);
  const { catalogCipher, ...header } = output;
  output.catalogCipher = await encrypted(new Uint8Array(), { domain: "YNX_DESKTOP_ACCOUNT_CATALOG_V3", ...header });
  return output;
}

test("empty setup is real password encryption and starts with no invented account", async () => {
  const empty = await createPasswordVault({ password: PASSWORD, accounts: [], activeAccount: null });
  assert.equal(empty.vault.schemaVersion, 3); assert.equal(empty.vault.cryptoSuite, PASSWORD_VAULT_CRYPTO_SUITE);
  assert.equal(empty.vault.passwordWrap.kdf.iterations, PASSWORD_VAULT_KDF_ITERATIONS); assert.equal(empty.vault.activeAccount, null); assert.deepEqual(empty.vault.accounts, []);
  const session = await unlockPasswordVault(JSON.stringify(empty.vault), PASSWORD); assert.equal(passwordVaultSessionStatus(session).keyExtractable, false);
  await assert.rejects(unlockPasswordVault(empty.vault, OTHER_PASSWORD), code("PASSWORD_VAULT_UNLOCK_FAILED"));
  closePasswordVaultSession(session); closePasswordVaultSession(empty.session);
});

test("absent vault has public empty state but cannot grant an unlock session", async () => {
  assert.equal(parsePasswordVault(null), null); assert.equal(readPasswordVaultPublicMetadata(undefined), null);
  await assert.rejects(unlockPasswordVault(null, PASSWORD), code("PASSWORD_VAULT_NOT_CONFIGURED"));
});

test("real password unwrap returns only a nonextractable opaque session and exact selected secrets", async () => {
  const session = await unlockPasswordVault(baseline.vault, PASSWORD);
  assert.equal(passwordVaultSessionStatus(session).active, true); assert.equal(passwordVaultSessionStatus(session).keyExtractable, false);
  assert.deepEqual(Object.keys(session).sort(), ["revision", "vaultId", "version"]); assert.equal(Object.isFrozen(session), true);
  assert.equal(await decryptPasswordVaultRecord(baseline.vault, FIRST.account, session), SECRET);
  assert.equal(await decryptPasswordVaultRecord(baseline.vault, NEXT.account, session), SECOND);
  await assert.rejects(decryptPasswordVaultRecord(baseline.vault, LOST.account, session), code("PASSWORD_VAULT_RECOVERY_REQUIRED"));
  const encoded = JSON.stringify(baseline.vault); assert.equal(encoded.includes(SECRET), false); assert.equal(encoded.includes(PASSWORD), false);
  closePasswordVaultSession(session);
});

test("new wraps and records use fresh random salt, vault ID and IVs", async () => {
  const other = await createPasswordVault({ password: PASSWORD, accounts: [{ ...FIRST, secretHex: SECRET }] });
  assert.notEqual(other.vault.vaultId, baseline.vault.vaultId); assert.notEqual(other.vault.passwordWrap.kdf.salt, baseline.vault.passwordWrap.kdf.salt);
  assert.notEqual(other.vault.records[0].cipher.iv, baseline.vault.records[0].cipher.iv);
  closePasswordVaultSession(other.session);
});

test("public parser bounds the exact crypto/KDF/schema before costly password work", async () => {
  for (const change of [value => value.cryptoSuite = "future-suite", value => value.schemaVersion = 4]) {
    const value = clone(baseline.vault); change(value); await assert.rejects(unlockPasswordVault(value, PASSWORD), code("PASSWORD_VAULT_UNSUPPORTED_SUITE"));
  }
  for (const iterations of [1, 600001, 1e15, "600000", null]) {
    const value = clone(baseline.vault); value.passwordWrap.kdf.iterations = iterations; let costly = false;
    await assert.rejects(unlockPasswordVault(value, PASSWORD, { guard(stage) { if (stage === "password-kdf:before") costly = true; } }), code("PASSWORD_VAULT_KDF_INVALID")); assert.equal(costly, false);
  }
  for (const change of [value => value.extra = true, value => value.records[0].cipher.ciphertext += "=", value => value.catalogCipher.iv = value.records[0].cipher.iv, value => value.records.reverse(), value => value.accounts.push(value.accounts[0]), value => value.accounts[0].label = "x".repeat(121), value => value.revision = 0, value => value.activeAccount = null]) {
    const value = clone(baseline.vault); change(value); assert.throws(() => parsePasswordVault(value));
  }
  assert.throws(() => parsePasswordVault(" ".repeat(65537)), code("PASSWORD_VAULT_INVALID"));
  assert.throws(() => parsePasswordVault({ ...baseline.vault, accounts: [, FIRST] }), code("PASSWORD_VAULT_INVALID"));
  const accessor = { ...baseline.vault }; Object.defineProperty(accessor, "accounts", { enumerable: true, get() { throw new Error("must not evaluate accessor"); } }); assert.throws(() => parsePasswordVault(accessor), code("PASSWORD_VAULT_INVALID"));
});

test("wrong password and wrapper tag/salt changes cannot unwrap the DEK", async () => {
  await assert.rejects(unlockPasswordVault(baseline.vault, OTHER_PASSWORD), code("PASSWORD_VAULT_UNLOCK_FAILED"));
  for (const change of [value => value.passwordWrap.cipher.ciphertext = flip(value.passwordWrap.cipher.ciphertext), value => value.passwordWrap.kdf.salt = flip(value.passwordWrap.kdf.salt), value => value.vaultId = "f".repeat(32)]) {
    const value = clone(baseline.vault); change(value); await assert.rejects(unlockPasswordVault(value, PASSWORD), code("PASSWORD_VAULT_UNLOCK_FAILED"));
  }
});

test("catalog authenticates revision, selection, labels and every encrypted record", async () => {
  for (const change of [value => value.revision++, value => value.activeAccount = NEXT.account, value => value.accounts[0].label = "Forged label", value => value.accounts[0].createdAt = "2026-09-07T00:00:00.000Z", value => value.records[1].cipher.ciphertext = flip(value.records[1].cipher.ciphertext), value => value.catalogCipher.ciphertext = flip(value.catalogCipher.ciphertext)]) {
    const value = clone(baseline.vault); change(value); await assert.rejects(unlockPasswordVault(value, PASSWORD), code("PASSWORD_VAULT_TAMPERED"));
  }
});

test("a valid AEAD record containing another key still fails identity validation", async () => {
  const activeMismatch = await withWrongAuthenticatedRecord(baseline.vault, FIRST.account, SECOND);
  await assert.rejects(unlockPasswordVault(activeMismatch, PASSWORD), code("PASSWORD_VAULT_IDENTITY_MISMATCH"));
  const inactiveMismatch = await withWrongAuthenticatedRecord(baseline.vault, NEXT.account, SECRET), session = await unlockPasswordVault(inactiveMismatch, PASSWORD);
  await assert.rejects(decryptPasswordVaultRecord(inactiveMismatch, NEXT.account, session), code("PASSWORD_VAULT_IDENTITY_MISMATCH"));
  await assert.rejects(rewritePasswordVault(inactiveMismatch, { activeAccount: NEXT.account }, session), code("PASSWORD_VAULT_IDENTITY_MISMATCH")); closePasswordVaultSession(session);
});

test("public identity must be a valid matching public key, YNX address and 0x address", async () => {
  for (const patch of [{ account: NEXT.account }, { ynxAccount: NEXT.ynxAccount }, { publicKey: NEXT.publicKey }]) {
    await assert.rejects(createPasswordVault({ password: PASSWORD, accounts: [{ ...FIRST, secretHex: SECRET, ...patch }] }), code("PASSWORD_VAULT_IDENTITY_MISMATCH"));
    const value = clone(baseline.vault); Object.assign(value.accounts[0], patch); assert.throws(() => readPasswordVaultPublicMetadata(value), code("PASSWORD_VAULT_IDENTITY_MISMATCH"));
  }
});

test("recovery metadata remains readable after crypto corruption without claiming authentication", async () => {
  const damaged = clone(baseline.vault); damaged.passwordWrap = { damaged: true }; delete damaged.catalogCipher; damaged.records = "broken";
  const publicState = readPasswordVaultPublicMetadata(damaged); assert.equal(publicState.catalogAuthenticated, false); assert.deepEqual(publicState.accounts, baseline.vault.accounts); assert.equal(publicState.activeAccount, FIRST.account);
  assert.equal("passwordWrap" in publicState, false); assert.equal("records" in publicState, false); assert.equal("session" in publicState, false);
  await assert.rejects(unlockPasswordVault(damaged, PASSWORD));
});

test("rewrite stages an exact next revision while preserving old session until outer commit", async () => {
  const old = await unlockPasswordVault(baseline.vault, PASSWORD);
  const candidate = await rewritePasswordVault(baseline.vault, { activeAccount: NEXT.account }, old);
  assert.equal(candidate.vault.revision, baseline.vault.revision + 1); assert.equal(candidate.vault.activeAccount, NEXT.account); assert.deepEqual(candidate.vault.records, baseline.vault.records);
  assert.equal(await decryptPasswordVaultRecord(baseline.vault, FIRST.account, old), SECRET);
  await assert.rejects(decryptPasswordVaultRecord(candidate.vault, NEXT.account, old), code("PASSWORD_VAULT_SESSION_INVALID"));
  await assert.rejects(decryptPasswordVaultRecord(baseline.vault, FIRST.account, candidate.session), code("PASSWORD_VAULT_SESSION_INVALID"));
  closePasswordVaultSession(old); assert.equal(await decryptPasswordVaultRecord(candidate.vault, NEXT.account, candidate.session), SECOND); closePasswordVaultSession(candidate.session);
});

test("closing a failed candidate leaves the still-committed old session usable", async () => {
  const candidate = await rewritePasswordVault(baseline.vault, {}, baseline.session); closePasswordVaultSession(candidate.session);
  assert.equal(await decryptPasswordVaultRecord(baseline.vault, FIRST.account, baseline.session), SECRET);
  await assert.rejects(decryptPasswordVaultRecord(candidate.vault, FIRST.account, candidate.session), code("PASSWORD_VAULT_SESSION_INVALID"));
});

test("rewrite adds or restores exact identities without deleting or downgrading old accounts", async () => {
  const restored = await rewritePasswordVault(baseline.vault, { accounts: [FIRST, NEXT, { ...LOST, state: "protected", secretHex: THIRD }], activeAccount: LOST.account }, baseline.session);
  assert.equal(restored.vault.accounts.length, 3); assert.equal(restored.vault.accounts[2].label, LOST.label); assert.equal(await decryptPasswordVaultRecord(restored.vault, LOST.account, restored.session), THIRD);
  for (const changes of [{ accounts: [FIRST] }, { accounts: [{ ...FIRST, state: "recovery-required" }, NEXT, LOST] }, { revision: baseline.vault.revision }, { revision: baseline.vault.revision + 2 }]) await assert.rejects(rewritePasswordVault(baseline.vault, changes, baseline.session));
  const empty = await createPasswordVault({ password: PASSWORD, accounts: [] }), added = await rewritePasswordVault(empty.vault, { accounts: [{ ...FIRST, secretHex: SECRET }] }, empty.session);
  assert.equal(added.vault.activeAccount, FIRST.account); assert.equal(await decryptPasswordVaultRecord(added.vault, FIRST.account, added.session), SECRET);
  closePasswordVaultSession(restored.session); closePasswordVaultSession(empty.session); closePasswordVaultSession(added.session);
});

test("equal revision candidates are still bound to different exact catalog fingerprints", async () => {
  const a = await rewritePasswordVault(baseline.vault, {}, baseline.session), b = await rewritePasswordVault(baseline.vault, {}, baseline.session);
  assert.equal(a.vault.revision, b.vault.revision); assert.notEqual(a.vault.catalogCipher.iv, b.vault.catalogCipher.iv);
  await assert.rejects(decryptPasswordVaultRecord(b.vault, FIRST.account, a.session), code("PASSWORD_VAULT_SESSION_INVALID"));
  closePasswordVaultSession(a.session); closePasswordVaultSession(b.session);
});

test("password bounds and ill-formed Unicode reject before KDF; no silent trimming", async () => {
  for (const password of [undefined, "", "a".repeat(11), "a".repeat(257), `${"a".repeat(12)}\ud800`]) await assert.rejects(createPasswordVault({ password, accounts: [] }), code("PASSWORD_VAULT_PASSWORD_INVALID"));
  const exactPassword = ` ${PASSWORD} `, exact = await createPasswordVault({ password: exactPassword, accounts: [] });
  await assert.rejects(unlockPasswordVault(exact.vault, PASSWORD), code("PASSWORD_VAULT_UNLOCK_FAILED")); closePasswordVaultSession(exact.session);
});

test("input snapshots are frozen before awaits and cannot be changed by caller mutation", async () => {
  const input = { password: PASSWORD, accounts: [{ ...FIRST, secretHex: SECRET }] }, pending = createPasswordVault(input);
  input.accounts[0].secretHex = SECOND; input.accounts[0].label = "late mutation";
  const created = await pending; assert.equal(created.vault.accounts[0].label, FIRST.label); assert.equal(await decryptPasswordVaultRecord(created.vault, FIRST.account, created.session), SECRET);
  assert.equal(Object.isFrozen(created.vault.accounts[0]), true); closePasswordVaultSession(created.session);
});

test("pre-abort, KDF cancellation and owner guard errors cannot return a session", async () => {
  const already = new AbortController(); already.abort(); await assert.rejects(createPasswordVault({ password: PASSWORD, accounts: [] }, { signal: already.signal }), code("WALLET_OPERATION_CANCELLED"));
  const abort = new AbortController(); await assert.rejects(unlockPasswordVault(baseline.vault, PASSWORD, { signal: abort.signal, guard(stage) { if (stage === "password-kdf:after") abort.abort(); } }), code("WALLET_OPERATION_CANCELLED"));
  const sentinel = Object.assign(new Error("owner generation changed"), { code: "OWNER_CANCELLED" });
  await assert.rejects(unlockPasswordVault(baseline.vault, PASSWORD, { guard(stage) { if (stage === "dek-unwrap:after") throw sentinel; } }), error => error === sentinel);
});

test("close during async decrypt discards late plaintext; close is idempotent", async () => {
  const session = await unlockPasswordVault(baseline.vault, PASSWORD);
  await assert.rejects(decryptPasswordVaultRecord(baseline.vault, FIRST.account, session, { guard(stage) { if (stage === "record-decrypt:after") closePasswordVaultSession(session); } }), code("PASSWORD_VAULT_SESSION_INVALID"));
  closePasswordVaultSession(session); assert.equal(passwordVaultSessionStatus(session).active, false);
  await assert.rejects(decryptPasswordVaultRecord(baseline.vault, FIRST.account, session), code("PASSWORD_VAULT_SESSION_INVALID"));
  await assert.rejects(decryptPasswordVaultRecord(baseline.vault, FIRST.account, { ...baseline.session }), code("PASSWORD_VAULT_SESSION_INVALID"));
});

test("rewrite cancellation cannot invalidate old committed session or return a new one", async () => {
  const abort = new AbortController(); await assert.rejects(rewritePasswordVault(baseline.vault, {}, baseline.session, { signal: abort.signal, guard(stage) { if (stage === "catalog-encrypt:after") abort.abort(); } }), code("WALLET_OPERATION_CANCELLED"));
  assert.equal(await decryptPasswordVaultRecord(baseline.vault, FIRST.account, baseline.session), SECRET);
});

test("account limits and recovery-only catalogs remain bounded and cannot synthesize keys", async () => {
  assert.equal(PASSWORD_VAULT_MAX_ACCOUNTS, 32);
  await assert.rejects(createPasswordVault({ password: PASSWORD, accounts: Array(33).fill(LOST) }), code("PASSWORD_VAULT_INVALID"));
  const recovery = await createPasswordVault({ password: PASSWORD, accounts: [LOST] }); assert.deepEqual(recovery.vault.records, []);
  const session = await unlockPasswordVault(recovery.vault, PASSWORD); await assert.rejects(decryptPasswordVaultRecord(recovery.vault, LOST.account, session), code("PASSWORD_VAULT_RECOVERY_REQUIRED")); closePasswordVaultSession(session); closePasswordVaultSession(recovery.session);
});


test("cancellation between helper completion and public result does not publish secret or candidate session", async () => {
  const session = await unlockPasswordVault(baseline.vault, PASSWORD);
  await assert.rejects(decryptPasswordVaultRecord(baseline.vault, FIRST.account, session, { guard(stage) { if (stage === "record-identity:after") queueMicrotask(() => closePasswordVaultSession(session)); } }), code("PASSWORD_VAULT_SESSION_INVALID"));
  const abort = new AbortController();
  await assert.rejects(createPasswordVault({ password: PASSWORD, accounts: [] }, { signal: abort.signal, guard(stage) { if (stage === "candidate:ready") queueMicrotask(() => abort.abort()); } }), code("WALLET_OPERATION_CANCELLED"));
  const old = await unlockPasswordVault(baseline.vault, PASSWORD);
  await assert.rejects(rewritePasswordVault(baseline.vault, {}, old, { guard(stage) { if (stage === "candidate:ready") queueMicrotask(() => closePasswordVaultSession(old)); } }), code("PASSWORD_VAULT_SESSION_INVALID"));
});

test("explicit null fields are invalid rather than silently replacing a requested revision or catalog", async () => {
  for (const changes of [{ revision: null }, { accounts: null }]) await assert.rejects(rewritePasswordVault(baseline.vault, changes, baseline.session));
  for (const input of [{ password: PASSWORD, accounts: [], revision: null }, { password: PASSWORD, accounts: [{ ...FIRST, label: null, secretHex: SECRET }] }]) await assert.rejects(createPasswordVault(input));
});
