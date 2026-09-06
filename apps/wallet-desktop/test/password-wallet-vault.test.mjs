import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import { walletIdentity, evmAddressFromYNX } from "@ynx-chain/wallet-auth";
import { DesktopKeyLifecycle } from "../src/key-lifecycle.mjs";
import { PasswordWalletVault } from "../src/password-wallet-vault.mjs";
import { PasswordVaultFile } from "../src/password-vault-file.mjs";
import { createPasswordVault, decryptPasswordVaultRecord, unlockPasswordVault, closePasswordVaultSession } from "../src/password-vault-crypto.mjs";

const PASSWORD = "independent fixture password 2026", NEXT_PASSWORD = "independent next password 2026";
const SECRET = "1".padStart(64, "0"), SECOND = "2".padStart(64, "0"), THIRD = "3".padStart(64, "0");
const accountFor = secret => evmAddressFromYNX(walletIdentity(secret).account);
const cancelled = error => ["WALLET_LOCKED", "WALLET_OPERATION_CANCELLED"].includes(error?.data?.code);
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function legacyRecord(secret) { const identity = walletIdentity(secret); return { account: evmAddressFromYNX(identity.account), ynxAccount: identity.account, publicKey: identity.accountPublicKey, encryptedSecret: Buffer.from(secret).reverse().toString("base64"), createdAt: "2026-09-06T00:00:00.000Z" }; }
async function fixture(t, { io, platform, scheduler } = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), "ynx-v3-fixture-")); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "wallet-vault-v3.json"), v2 = join(directory, "wallet-vault-v2.json"), v1 = join(directory, "wallet-vault-v1.json");
  const life = new DesktopKeyLifecycle(scheduler); life.setFocused(true);
  const calls = { decrypt: 0, fallback: 0 }, safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "fixture", decryptStringAsync: async bytes => { calls.decrypt++; return { result: Buffer.from(bytes).reverse().toString() }; }, decryptString: () => { calls.fallback++; return SECRET; } };
  const store = new PasswordVaultFile(filePath, { io, platform }), vault = new PasswordWalletVault({ filePath, legacyFilePaths: [v2, v1], safeStorage, authorization: life, fileStore: store, randomSecret: () => SECRET });
  life.authorizer = vault.authorizer(); t.after(() => life.lock());
  return { directory, filePath, v2, v1, life, vault, store, calls, safeStorage };
}
async function setup(f) { await f.life.custody(guard => f.vault.setup({ password: PASSWORD, confirmation: PASSWORD }, guard)); }
async function unlock(f, password = PASSWORD) { await f.life.unlock({ password }); }
async function create(f) { await setup(f); await unlock(f); const status = await f.life.run(() => f.vault.createAccount()); f.life.setAccount(status.account); await unlock(f); return status; }
async function writeLegacy(f, secrets = [SECRET, SECOND], old = THIRD) {
  const accounts = secrets.map(legacyRecord), first = { schemaVersion: 2, activeAccount: accounts[0].account, accounts };
  await fs.writeFile(f.v2, JSON.stringify(first), { mode: 0o600 });
  if (old) await fs.writeFile(f.v1, JSON.stringify({ schemaVersion: 1, ...legacyRecord(old) }), { mode: 0o600 });
}

for (const platform of ["linux", "win32", "darwin"]) test(`${platform} actual password AEAD unlock works without OS authentication or an OS encryption backend`, async t => {
  const f = await fixture(t, { platform }); f.safeStorage.isEncryptionAvailable = () => false;
  const status = await create(f); assert.equal(status.custody, "password-encrypted-local");
  const actual = await f.life.run(() => f.vault.withSecret(secret => new Wallet(`0x${secret}`).address.toLowerCase())); assert.equal(actual, accountFor(SECRET));
  f.life.lock(); assert.equal((await f.vault.status()).account, actual); assert.equal(f.calls.decrypt, 0);
  await assert.rejects(unlock(f, "incorrect fixture password"), error => error.data.code === "PASSWORD_VAULT_UNLOCK_FAILED");
  await assert.rejects(f.life.run(() => f.vault.withSecret(() => assert.fail())), cancelled);
  assert.equal(f.life.status().hardwareBound, false);
});

test("locked custody never supplies a signing lease and a real expiry drops the password key", async t => {
  let expire;
  const f = await fixture(t, { scheduler: { schedule: callback => { expire = callback; return 1; }, unschedule: () => {} } });
  await f.life.custody(async guard => { assert.throws(() => f.life.current(), cancelled); await assert.rejects(f.life.run(() => assert.fail()), cancelled); guard.assert(); });
  await create(f); expire();
  assert.equal(f.life.status().locked, true); assert.equal((await f.vault.status()).catalogAuthenticated, false);
  await assert.rejects(f.vault.withSecret(() => assert.fail()), cancelled);
});

test("blur and return during password derivation invalidates that attempt; it is not a Touch ID focus exception", async t => {
  const f = await fixture(t); await setup(f);
  const pending = unlock(f); f.life.setFocused(false); f.life.setFocused(true);
  await assert.rejects(pending, cancelled); assert.equal(f.life.status().locked, true);
  await unlock(f); assert.equal(f.life.status().locked, false);
});

test("V3 public inventory performs no legacy decrypt and a damaged V3 never uses the old OS-only key", async t => {
  const f = await fixture(t); await create(f); f.life.lock(); await writeLegacy(f);
  const value = JSON.parse(await fs.readFile(f.filePath, "utf8")); delete value.passwordWrap;
  await fs.writeFile(f.filePath, JSON.stringify(value), { mode: 0o600 });
  const status = await f.vault.status(); assert.equal(status.account, accountFor(SECRET)); assert.equal(status.recoveryRequired, true); assert.equal(status.legacyCleanupPending, true);
  await assert.rejects(unlock(f)); assert.equal(f.calls.decrypt, 0); assert.equal(f.calls.fallback, 0);
});

test("explicit migration includes both V2 and the leftover V1 account, verifies every key and preserves exact originals", async t => {
  const f = await fixture(t); await writeLegacy(f);
  const before = await Promise.all([fs.readFile(f.v2), fs.readFile(f.v1)]);
  assert.equal((await f.vault.status()).accounts.length, 3); assert.equal(f.calls.decrypt, 0);
  await assert.rejects(setup(f), error => error.data.code === "LEGACY_MIGRATION_REQUIRED");
  const status = await f.life.custody(guard => f.vault.setup({ password: PASSWORD, confirmation: PASSWORD, migrateLegacy: true }, guard));
  assert.equal(status.accounts.length, 3); assert.equal(status.legacyCleanupPending, true); assert.equal(f.calls.decrypt, 3);
  assert.deepEqual(await Promise.all([fs.readFile(f.v2), fs.readFile(f.v1)]), before);
  const disk = JSON.parse(await fs.readFile(f.filePath, "utf8")), session = await unlockPasswordVault(disk, PASSWORD);
  for (const secret of [SECRET, SECOND, THIRD]) assert.equal(await decryptPasswordVaultRecord(disk, accountFor(secret), session), secret);
  closePasswordVaultSession(session);
  assert.equal((await fs.stat(f.filePath)).mode & 0o777, 0o600);
  assert.equal((await fs.readFile(f.filePath, "utf8")).includes(SECRET), false);
});

for (const fault of ["cancel", "wrong-key", "OS-failure", "write-failure", "readback-tamper"]) test(`migration ${fault} keeps every original and does not publish a usable partial V3`, async t => {
  const io = { ...fs }, f = await fixture(t, { io }); await writeLegacy(f);
  const before = await Promise.all([fs.readFile(f.v2), fs.readFile(f.v1)]);
  const decrypt = f.safeStorage.decryptStringAsync;
  f.safeStorage.decryptStringAsync = async bytes => {
    const result = await decrypt(bytes);
    if (f.calls.decrypt === 2) {
      if (fault === "cancel") f.life.lock();
      if (fault === "wrong-key") return { result: THIRD };
      if (fault === "OS-failure") throw new Error("fixture denied");
    }
    return result;
  };
  if (fault === "write-failure") io.rename = async () => { throw new Error("fixture disk full"); };
  if (fault === "readback-tamper") { const original = f.store.read.bind(f.store); f.store.read = async (...args) => { const result = await original(...args); return args[0]?.endsWith(".tmp") && result ? { ...result, text: result.text.replace('"schemaVersion":3', '"schemaVersion":4') } : result; }; }
  await assert.rejects(f.life.custody(guard => f.vault.setup({ password: PASSWORD, confirmation: PASSWORD, migrateLegacy: true }, guard)));
  assert.deepEqual(await Promise.all([fs.readFile(f.v2), fs.readFile(f.v1)]), before);
  assert.equal(await f.store.read(), null); assert.equal(f.calls.fallback, 0);
  assert.equal((await f.vault.status()).accounts.length, 3);
});

test("cancel after rename preserves the committed encrypted V3, stays locked, and restart resumes by password without deleting legacy", async t => {
  const io = { ...fs }, f = await fixture(t, { io }); await writeLegacy(f);
  io.rename = async (...args) => { await fs.rename(...args); f.life.lock(); };
  await assert.rejects(f.life.custody(guard => f.vault.setup({ password: PASSWORD, confirmation: PASSWORD, migrateLegacy: true }, guard)), cancelled);
  assert.equal(f.life.status().locked, true); assert.equal((await f.vault.status()).accounts.length, 3);
  io.rename = fs.rename; f.life.setAccount(accountFor(SECRET)); await unlock(f);
  assert.equal(await f.life.run(() => f.vault.withSecret(secret => accountFor(secret))), accountFor(SECRET));
  assert.equal(f.calls.decrypt, 3); assert.equal(await f.store.exists(f.v1), true); assert.equal(await f.store.exists(f.v2), true);
});

test("selection and import remain password-encrypted, while lock during signing drops the late result", async t => {
  const f = await fixture(t); await create(f);
  const second = await f.life.run(() => f.vault.importAccount({ kind: "private-key", value: SECOND })); f.life.setAccount(second.account); await unlock(f);
  assert.equal(second.account, accountFor(SECOND));
  await assert.rejects(f.life.run(() => f.vault.importAccount({ kind: "private-key", value: SECRET })), error => error.data.code === "DUPLICATE_ACCOUNT");
  const entered = deferred(), signer = deferred(); let delivered = false;
  const pending = f.life.run(() => f.vault.withSecret(async () => { entered.resolve(); return signer.promise; })).then(() => { delivered = true; });
  await entered.promise; f.life.lock(); signer.resolve("fixture late signature"); await assert.rejects(pending, cancelled); assert.equal(delivered, false);
});

test("exact file replacement while unlocked prevents key use and locks the application", async t => {
  const f = await fixture(t); await create(f); const another = await createPasswordVault({ password: PASSWORD, accounts: [{ secretHex: SECOND }] });
  await fs.writeFile(f.filePath, JSON.stringify(another.vault), { mode: 0o600 }); closePasswordVaultSession(another.session);
  await assert.rejects(f.life.run(() => f.vault.withSecret(() => assert.fail())), error => error.data.code === "PASSWORD_VAULT_FILE_CHANGED");
  assert.equal(f.life.status().locked, true);
});

test("recovery preview verifies exact existing identity; cancel and stale preview cannot replace any key", async t => {
  const f = await fixture(t); await create(f); f.life.lock(); const before = await fs.readFile(f.filePath);
  const input = { account: accountFor(SECRET), kind: "private-key", value: SECOND, resetPassword: true, newPassword: NEXT_PASSWORD, confirmation: NEXT_PASSWORD };
  await assert.rejects(f.life.custody(guard => f.vault.prepareRecovery(input, guard)), error => error.data.code === "PASSWORD_VAULT_IDENTITY_MISMATCH");
  input.value = SECRET;
  const preview = await f.life.custody(guard => f.vault.prepareRecovery(input, guard)); f.life.lock();
  await assert.rejects(f.life.custody(guard => f.vault.commitRecovery(preview.previewId, guard)), cancelled);
  assert.deepEqual(await fs.readFile(f.filePath), before);
});

test("forgotten-password recovery preserves unrecovered identities, exact old ciphertext, and independent pending transaction journal", async t => {
  const f = await fixture(t); await create(f); await f.life.run(() => f.vault.importAccount({ kind: "private-key", value: SECOND })); f.life.lock();
  const before = await fs.readFile(f.filePath, "utf8"), journal = join(f.directory, "transaction-intents-v1.json"), pending = '{"fixture":"unresolved broadcast must survive custody reset"}'; await fs.writeFile(journal, pending, { mode: 0o600 });
  const preview = await f.life.custody(guard => f.vault.prepareRecovery({ account: accountFor(SECRET), kind: "private-key", value: SECRET, resetPassword: true, newPassword: NEXT_PASSWORD, confirmation: NEXT_PASSWORD }, guard));
  assert.deepEqual(preview.recoveryRequiredAccounts, [accountFor(SECOND)]);
  const status = await f.life.custody(guard => f.vault.commitRecovery(preview.previewId, guard));
  assert.equal(status.accounts.length, 2); assert.equal(status.accounts.find(item => item.account === accountFor(SECOND)).state, "recovery-required");
  const archive = await fs.readdir(join(f.directory, "wallet-recovery-history")); assert.equal(archive.length, 1); assert.equal(await fs.readFile(join(f.directory, "wallet-recovery-history", archive[0]), "utf8"), before);
  assert.equal(await fs.readFile(journal, "utf8"), pending); await assert.rejects(unlock(f));
  f.life.setAccount(accountFor(SECRET)); await unlock(f, NEXT_PASSWORD);
  assert.equal(await f.life.run(() => f.vault.withSecret(secret => accountFor(secret))), accountFor(SECRET));
  f.life.lock();
  const restore = await f.life.custody(guard => f.vault.prepareRecovery({ account: accountFor(SECOND), kind: "private-key", value: SECOND, currentPassword: NEXT_PASSWORD }, guard));
  await f.life.custody(guard => f.vault.commitRecovery(restore.previewId, guard));
  const current = JSON.parse(await fs.readFile(f.filePath, "utf8")), session = await unlockPasswordVault(current, NEXT_PASSWORD);
  for (const secret of [SECRET, SECOND]) assert.equal(await decryptPasswordVaultRecord(current, accountFor(secret), session), secret); closePasswordVaultSession(session);
  assert.equal(await fs.readFile(journal, "utf8"), pending);
});

test("malicious encrypted backup KDF is rejected before resource-intensive import without changing the stored vault", async t => {
  const f = await fixture(t); await create(f); const before = await fs.readFile(f.filePath);
  const value = JSON.stringify({ version: 3, crypto: { cipher: "aes-128-ctr", ciphertext: "11".repeat(32), cipherparams: { iv: "22".repeat(16) }, mac: "33".repeat(32), kdf: "scrypt", kdfparams: { n: 2 ** 30, r: 8, p: 1, dklen: 32, salt: "44".repeat(32) } } });
  await assert.rejects(f.life.run(() => f.vault.importAccount({ kind: "encrypted-json", value, password: PASSWORD })), error => error.data.code === "INVALID_IMPORT");
  assert.deepEqual(await fs.readFile(f.filePath), before);
});

test("cancelled KDF cannot invalidate or clear a newly entered password dialog draft when it finishes late", async () => {
  const ready = deferred(), kdf = deferred(); let discarded = 0, installed = 0;
  const life = new DesktopKeyLifecycle({ authorizer: { available: () => true, inProcess: true, method: "fixture delayed password", authenticate: async () => { ready.resolve(); await kdf.promise; return { commit: () => { installed++; }, discard: () => { discarded++; } }; } } });
  life.setFocused(true);
  let revision = life.status().revision, draft = "", clears = 0;
  life.subscribe(state => { if (state.locked && state.revision !== revision) { draft = ""; clears++; } revision = state.revision; });
  const pending = life.unlock({ password: PASSWORD }); await ready.promise;
  life.lock(); draft = "new user-owned draft"; const cancelledRevision = life.status().revision, cancelledClears = clears;
  kdf.resolve(); await assert.rejects(pending, cancelled);
  assert.equal(draft, "new user-owned draft"); assert.equal(life.status().revision, cancelledRevision); assert.equal(clears, cancelledClears);
  assert.equal(life.status().authenticating, false); assert.equal(installed, 0); assert.equal(discarded, 1);
});

test("legacy migration preserves a valid label and rejects missing/invalid creation metadata without synthesizing dates", async t => {
  const f = await fixture(t); const record = { ...legacyRecord(SECRET), label: "My existing QA account" };
  await fs.writeFile(f.v2, JSON.stringify({ schemaVersion: 2, activeAccount: record.account, accounts: [record] }), { mode: 0o600 });
  await f.life.custody(guard => f.vault.setup({ password: PASSWORD, confirmation: PASSWORD, migrateLegacy: true }, guard));
  assert.equal((await f.vault.status()).accounts[0].label, record.label);
  for (const bad of [{ createdAt: undefined }, { createdAt: "invalid" }, { label: "bad\u0000label" }]) {
    const fixturePath = join(f.directory, `invalid-${Math.random()}.json`);
    await fs.writeFile(fixturePath, JSON.stringify({ schemaVersion: 2, activeAccount: record.account, accounts: [{ ...record, ...bad }] }), { mode: 0o600 });
    const target = join(f.directory, `absent-${Math.random()}.json`), vault = new PasswordWalletVault({ filePath: target, legacyFilePaths: [fixturePath], safeStorage: f.safeStorage, authorization: f.life });
    await assert.rejects(f.life.custody(guard => vault.setup({ password: PASSWORD, confirmation: PASSWORD, migrateLegacy: true }, guard)), error => error.data.code === "LEGACY_METADATA_INVALID");
    assert.equal(await new PasswordVaultFile(target).exists(target), false);
  }
});

test("a preserved old V3 password can restore another exact existing account without replacing the current password", async t => {
  const f = await fixture(t); await create(f); await f.life.run(() => f.vault.importAccount({ kind: "private-key", value: SECOND })); f.life.lock();
  const first = await f.life.custody(guard => f.vault.prepareRecovery({ account: accountFor(SECRET), kind: "private-key", value: SECRET, resetPassword: true, newPassword: NEXT_PASSWORD, confirmation: NEXT_PASSWORD }, guard));
  await f.life.custody(guard => f.vault.commitRecovery(first.previewId, guard));
  const history = await f.vault.recoveryHistory(); assert.equal(history.length, 1); assert.equal(history[0].accounts.includes(accountFor(SECOND)), true);
  const second = await f.life.custody(guard => f.vault.prepareRecovery({ account: accountFor(SECOND), kind: "previous-password", value: history[0].id, backupPassword: PASSWORD, currentPassword: NEXT_PASSWORD }, guard));
  await f.life.custody(guard => f.vault.commitRecovery(second.previewId, guard));
  f.life.setAccount(accountFor(SECOND)); await unlock(f, NEXT_PASSWORD);
  assert.equal(await f.life.run(() => f.vault.withSecret(secret => accountFor(secret))), accountFor(SECOND));
  await assert.rejects(f.store.readHistory("../../anything"), error => error.data.code === "PASSWORD_VAULT_FILE_INVALID");
});

test("a first failed password authentication owns its generation and still locks with an actionable error", async t => {
  const f = await fixture(t); await setup(f); const revision = f.life.status().revision;
  await assert.rejects(unlock(f, "this fixture password is incorrect"), error => error.data.code === "PASSWORD_VAULT_UNLOCK_FAILED");
  assert.equal(f.life.status().revision, revision + 1); assert.equal(f.life.status().locked, true); assert.equal(f.life.status().authenticating, false);
});

test("failure to durably preserve the previous encrypted generation prevents password-reset replacement", async t => {
  const io = { ...fs }, f = await fixture(t, { io }); await create(f); f.life.lock(); const before = await fs.readFile(f.filePath);
  const preview = await f.life.custody(guard => f.vault.prepareRecovery({ account: accountFor(SECRET), kind: "private-key", value: SECRET, resetPassword: true, newPassword: NEXT_PASSWORD, confirmation: NEXT_PASSWORD }, guard));
  io.open = async (file, ...args) => {
    const handle = await fs.open(file, ...args);
    if (String(file).includes('wallet-recovery-history') && args[0] === 'wx') return new Proxy(handle, { get(target, key) { if (key === 'sync') return async () => { throw new Error('fixture archive fsync failure'); }; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
    return handle;
  };
  await assert.rejects(f.life.custody(guard => f.vault.commitRecovery(preview.previewId, guard)), error => error.data.code === "PASSWORD_VAULT_STORAGE_FAILED");
  assert.deepEqual(await fs.readFile(f.filePath), before); await unlock(f);
  assert.equal(await f.life.run(() => f.vault.withSecret(secret => accountFor(secret))), accountFor(SECRET));
});

test("repository-only recovery cancellation invalidates a pending prepare before it can publish a new preview", async t => {
  const f = await fixture(t); await create(f); f.life.lock();
  const original = f.store.read.bind(f.store), entered = deferred(), finish = deferred(); let once = true;
  f.store.read = async (...args) => { const result = await original(...args); if (once) { once = false; entered.resolve(); await finish.promise; } return result; };
  const pending = f.life.custody(guard => f.vault.prepareRecovery({ account: accountFor(SECRET), kind: "private-key", value: SECRET, resetPassword: true, newPassword: NEXT_PASSWORD, confirmation: NEXT_PASSWORD }, guard));
  await entered.promise; const revision = f.life.status().revision; f.vault.cancelRecovery(); finish.resolve();
  await assert.rejects(pending, cancelled); assert.equal(f.life.status().revision, revision);
  await assert.rejects(f.life.custody(guard => f.vault.commitRecovery("unpublished", guard)), cancelled);
});

test("an ambiguous rename completion of an account mutation closes the app key gate and fresh status reports committed encrypted state", async t => {
  const io = { ...fs }, f = await fixture(t, { io }); await create(f);
  io.rename = async (...args) => { await fs.rename(...args); throw new Error("fixture rename ACK loss"); };
  await assert.rejects(f.life.run(() => f.vault.importAccount({ kind: "private-key", value: SECOND })), error => error.data.code === "PASSWORD_VAULT_STORAGE_FAILED");
  assert.equal(f.life.status().locked, true); assert.equal((await f.vault.status()).account, accountFor(SECOND));
  await unlock(f); assert.equal(f.life.status().account, accountFor(SECOND));
  assert.equal(await f.life.run(() => f.vault.withSecret(secret => accountFor(secret))), accountFor(SECOND));
});

test("archive fsync failure followed by retry must sync the existing matching archive before replacing a password", async t => {
  const io = { ...fs }, f = await fixture(t, { io }); await create(f); f.life.lock(); let syncs = 0, failOnce = true;
  io.open = async (file, ...args) => {
    const handle = await fs.open(file, ...args);
    if (String(file).includes('wallet-recovery-history') && String(file).endsWith('.json')) return new Proxy(handle, { get(target, key) { if (key === 'sync') return async () => { syncs++; if (failOnce) { failOnce = false; throw new Error('fixture first archive sync failure'); } return target.sync(); }; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
    return handle;
  };
  const input = { account: accountFor(SECRET), kind: "private-key", value: SECRET, resetPassword: true, newPassword: NEXT_PASSWORD, confirmation: NEXT_PASSWORD };
  const first = await f.life.custody(guard => f.vault.prepareRecovery(input, guard));
  await assert.rejects(f.life.custody(guard => f.vault.commitRecovery(first.previewId, guard)), error => error.data.code === "PASSWORD_VAULT_STORAGE_FAILED");
  assert.equal(syncs, 1);
  const second = await f.life.custody(guard => f.vault.prepareRecovery(input, guard));
  await f.life.custody(guard => f.vault.commitRecovery(second.previewId, guard));
  assert.equal(syncs, 2); await unlock(f, NEXT_PASSWORD);
  assert.equal(await f.life.run(() => f.vault.withSecret(secret => accountFor(secret))), accountFor(SECRET));
});

test("recovery history capacity never silently hides a newly retained generation or replaces the current vault", async t => {
  const f = await fixture(t); await create(f); f.life.lock(); const before = await fs.readFile(f.filePath);
  f.store.history = async () => Array.from({ length: 64 }, (_, index) => index.toString(16).padStart(64, '0'));
  const preview = await f.life.custody(guard => f.vault.prepareRecovery({ account: accountFor(SECRET), kind: "private-key", value: SECRET, resetPassword: true, newPassword: NEXT_PASSWORD, confirmation: NEXT_PASSWORD }, guard));
  await assert.rejects(f.life.custody(guard => f.vault.commitRecovery(preview.previewId, guard)), error => error.data.code === "PASSWORD_VAULT_HISTORY_LIMIT");
  assert.deepEqual(await fs.readFile(f.filePath), before);
});

for (const expiry of ["before-confirm", "before-publication"]) test(`a real recovery preview expiring ${expiry} cannot revoke app permissions or replace the wallet`, async t => {
  const f = await fixture(t); await create(f); f.life.lock(); let now = 10_000, revocations = 0; f.vault.now = () => now;
  const before = await fs.readFile(f.filePath), preview = await f.life.custody(guard => f.vault.prepareRecovery({ account: accountFor(SECRET), kind: "private-key", value: SECRET, resetPassword: true, newPassword: NEXT_PASSWORD, confirmation: NEXT_PASSWORD }, guard));
  if (expiry === "before-confirm") now += 61_000;
  else { const read = f.store.read.bind(f.store); f.store.read = async (...args) => { const result = await read(...args); if (args[0]?.endsWith('.tmp')) now += 61_000; return result; }; }
  await assert.rejects(f.life.custody(guard => f.vault.commitRecovery(preview.previewId, guard, { beforePublish: async () => { revocations++; } })), cancelled);
  assert.equal(revocations, 0); assert.deepEqual(await fs.readFile(f.filePath), before);
});

test("a live verified recovery invokes permission revocation before replacement while still exposing no signing lease", async t => {
  const f = await fixture(t); await create(f); f.life.lock(); const before = await fs.readFile(f.filePath); let revocations = 0;
  const preview = await f.life.custody(guard => f.vault.prepareRecovery({ account: accountFor(SECRET), kind: "private-key", value: SECRET, resetPassword: true, newPassword: NEXT_PASSWORD, confirmation: NEXT_PASSWORD }, guard));
  await f.life.custody(guard => f.vault.commitRecovery(preview.previewId, guard, { beforePublish: async () => { revocations++; assert.deepEqual(await fs.readFile(f.filePath), before); assert.throws(() => f.life.current(), cancelled); } }));
  assert.equal(revocations, 1); assert.notDeepEqual(await fs.readFile(f.filePath), before); await unlock(f, NEXT_PASSWORD);
});
