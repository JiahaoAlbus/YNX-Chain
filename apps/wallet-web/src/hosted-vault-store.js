import { createEncryptedVault, parseEncryptedVault, unlockEncryptedVault } from "./extension-vault.js";

const DB_NAME = "ynx-hosted-wallet-v1";
const STORE = "vault";
const REPLAY = "replay";
const ACCOUNTS = "accounts";
const META = "meta";
const KEY = "primary";
function problem(code) { return Object.assign(new Error(code), { code }); }
function fail(code) { throw problem(code); }

function openDatabase(factory) {
  return new Promise((resolve, reject) => {
    let request;
    try { request = factory.open(DB_NAME, 3); } catch { reject(problem("HOSTED_STORAGE_UNAVAILABLE")); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains(REPLAY)) request.result.createObjectStore(REPLAY);
      if (!request.result.objectStoreNames.contains(ACCOUNTS)) request.result.createObjectStore(ACCOUNTS);
      if (!request.result.objectStoreNames.contains(META)) request.result.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(problem("HOSTED_STORAGE_UNAVAILABLE"));
    request.onblocked = () => reject(problem("HOSTED_STORAGE_UNAVAILABLE"));
  });
}
function transaction(db, mode, action, name = STORE) {
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(name, mode); } catch { reject(problem("HOSTED_STORAGE_UNAVAILABLE")); return; }
    let result;
    const request = action(tx.objectStore(name));
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(problem(mode === "readonly" ? "HOSTED_STORAGE_READ_FAILED" : "HOSTED_STORAGE_WRITE_FAILED"));
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(problem(mode === "readonly" ? "HOSTED_STORAGE_READ_FAILED" : "HOSTED_STORAGE_WRITE_FAILED"));
  });
}

export function createHostedVaultStore(factory = globalThis.indexedDB, cryptoProvider = globalThis.crypto) {
  if (!factory) fail("HOSTED_STORAGE_UNAVAILABLE");
  let dbPromise;
  async function db() { return dbPromise ??= openDatabase(factory); }
  async function read() {
    const active = await transaction(await db(), "readonly", store => store.get("selected"), META);
    if (active !== undefined && (typeof active !== "string" || !/^0x[0-9a-f]{40}$/u.test(active))) fail("HOSTED_STORAGE_READ_FAILED");
    const value = active === undefined ? await transaction(await db(), "readonly", store => store.get(KEY)) : await transaction(await db(), "readonly", store => store.get(active), ACCOUNTS);
    if (active !== undefined && value === undefined) fail("HOSTED_STORAGE_READ_FAILED");
    const record = value === undefined ? null : parseEncryptedVault(value);
    if (active !== undefined && record?.account !== active) fail("HOSTED_STORAGE_READ_FAILED");
    return record;
  }
  async function create({ password, secretHex }) {
    // A failed read never means an empty Wallet. IndexedDB add is atomic and
    // refuses replacement even when another tab creates an account concurrently.
    if (await read() !== null) fail("HOSTED_VAULT_EXISTS");
    const vault = await createEncryptedVault({ password, secretHex }, cryptoProvider);
    await unlockEncryptedVault(vault, password, cryptoProvider);
    try { await transaction(await db(), "readwrite", store => store.add(vault, KEY)); }
    catch (error) { if (error?.code === "HOSTED_STORAGE_WRITE_FAILED") fail("HOSTED_VAULT_EXISTS_OR_WRITE_FAILED"); throw error; }
    const saved = await read();
    if (JSON.stringify(saved) !== JSON.stringify(vault)) fail("HOSTED_STORAGE_READBACK_FAILED");
    await unlockEncryptedVault(saved, password, cryptoProvider);
    return { account: saved.account, vault: saved };
  }
  async function importEncrypted({ record, password }) {
    if (await read() !== null) fail("HOSTED_VAULT_EXISTS");
    const vault = parseEncryptedVault(record);
    const unlocked = await unlockEncryptedVault(vault, password, cryptoProvider);
    if (unlocked.account !== vault.account) fail("HOSTED_BACKUP_ACCOUNT_MISMATCH");
    try { await transaction(await db(), "readwrite", store => store.add(vault, KEY)); }
    catch { fail("HOSTED_VAULT_EXISTS_OR_WRITE_FAILED"); }
    const saved = await read();
    if (JSON.stringify(saved) !== JSON.stringify(vault)) fail("HOSTED_STORAGE_READBACK_FAILED");
    const recovered = await unlockEncryptedVault(saved, password, cryptoProvider);
    if (recovered.account !== vault.account) fail("HOSTED_BACKUP_ACCOUNT_MISMATCH");
    return { account: saved.account, vault: saved };
  }
  async function listAccounts() {
    const primary = await transaction(await db(), "readonly", store => store.get(KEY));
    const extra = await transaction(await db(), "readonly", store => store.getAll(), ACCOUNTS);
    const records = [primary, ...extra].filter(value => value !== undefined).map(parseEncryptedVault);
    if (new Set(records.map(record => record.account)).size !== records.length) fail("HOSTED_STORAGE_READ_FAILED");
    return records.map(record => record.account);
  }
  async function addEncryptedAccount({ record, password }) {
    const current = await read();
    if (!current) fail("HOSTED_VAULT_ABSENT");
    const vault = parseEncryptedVault(record);
    if ((await listAccounts()).includes(vault.account)) fail("HOSTED_ACCOUNT_EXISTS");
    const unlocked = await unlockEncryptedVault(vault, password, cryptoProvider);
    if (unlocked.account !== vault.account) fail("HOSTED_BACKUP_ACCOUNT_MISMATCH");
    try { await transaction(await db(), "readwrite", store => store.add(vault, vault.account), ACCOUNTS); }
    catch { fail("HOSTED_ACCOUNT_EXISTS_OR_WRITE_FAILED"); }
    const saved = await transaction(await db(), "readonly", store => store.get(vault.account), ACCOUNTS);
    if (JSON.stringify(parseEncryptedVault(saved)) !== JSON.stringify(vault)) fail("HOSTED_STORAGE_READBACK_FAILED");
    return vault.account;
  }
  async function selectAccount(account) {
    if (!(await listAccounts()).includes(account)) fail("HOSTED_ACCOUNT_UNAVAILABLE");
    const primary = await transaction(await db(), "readonly", store => store.get(KEY));
    if (parseEncryptedVault(primary).account === account) await transaction(await db(), "readwrite", store => store.delete("selected"), META);
    else await transaction(await db(), "readwrite", store => store.put(account, "selected"), META);
    const selected = await read();
    if (selected?.account !== account) fail("HOSTED_STORAGE_READBACK_FAILED");
    return selected;
  }
  async function consumeReplay(key, deadlineAt) {
    if (typeof key !== "string" || key.length > 300 || !Number.isSafeInteger(deadlineAt) || deadlineAt <= Date.now()) fail("HOSTED_REPLAY_INVALID");
    try { await transaction(await db(), "readwrite", store => store.add(deadlineAt, key), REPLAY); }
    catch { fail("HOSTED_REQUEST_REPLAYED_OR_STORAGE_UNAVAILABLE"); }
  }
  return Object.freeze({ read, create, importEncrypted, listAccounts, addEncryptedAccount, selectAccount, consumeReplay });
}
