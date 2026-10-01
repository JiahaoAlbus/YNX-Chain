import { createEncryptedVault, parseEncryptedVault, unlockEncryptedVault } from "./extension-vault.js";
import {HOSTED_CHAIN_ID, HOSTED_SESSION_MS, randomHostedId, registeredProduct} from "./hosted-protocol.js";

const DB_NAME = "ynx-hosted-wallet-v1";
const STORE = "vault";
const REPLAY = "replay";
const ACCOUNTS = "accounts";
const META = "meta";
const JOURNAL = "journal";
const CONNECTIONS = "connections";
const KEY = "primary";
function problem(code) { return Object.assign(new Error(code), { code }); }
function fail(code) { throw problem(code); }
function validConnectionRecord(grant) {
  return grant && Object.keys(grant).sort().join(",") === "account,chainId,epoch,expiresAt,id,origin,revoked,scopes,version" && grant.version === 1 &&
    registeredProduct(grant.origin) && /^0x[0-9a-f]{40}$/u.test(grant.account) && /^[A-Za-z0-9_-]{22,64}$/u.test(grant.id) &&
    grant.chainId === HOSTED_CHAIN_ID && Number.isSafeInteger(grant.epoch) && grant.epoch > 0 && grant.epoch < Number.MAX_SAFE_INTEGER &&
    Number.isSafeInteger(grant.expiresAt) && typeof grant.revoked === "boolean" && Array.isArray(grant.scopes) && grant.scopes.join(",") === "account:read,request:review";
}

function openDatabase(factory,onClosed=()=>{}) {
  return new Promise((resolve,reject)=>{
    let request,settled=false;
    const denied=code=>{if(!settled){settled=true;reject(problem(code));}};
    const accepted=handle=>{
      if(settled){handle.close?.();return;}
      settled=true;
      handle.onversionchange=()=>{handle.close();onClosed(handle);};
      resolve(handle);
    };
    try{request=factory.open(DB_NAME,5);}catch{denied('HOSTED_STORAGE_UNAVAILABLE');return;}
    request.onupgradeneeded=()=>{
      if(settled){request.transaction?.abort();return;}
      for(const name of [STORE,REPLAY,ACCOUNTS,META,JOURNAL,CONNECTIONS])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);
    };
    request.onsuccess=()=>accepted(request.result);
    request.onblocked=()=>denied('HOSTED_STORAGE_UPGRADE_BLOCKED');
    request.onerror=()=>{
      if(settled)return;
      if(request.error?.name!=='VersionError'){denied('HOSTED_STORAGE_UNAVAILABLE');return;}
      // Existing higher-version DB only; no deletion, downgrade or key rewrite.
      let compatible;
      try{compatible=factory.open(DB_NAME);}catch{denied('HOSTED_STORAGE_UNAVAILABLE');return;}
      compatible.onsuccess=()=>accepted(compatible.result);
      compatible.onerror=()=>denied('HOSTED_STORAGE_UNAVAILABLE');
      compatible.onblocked=()=>denied('HOSTED_STORAGE_UPGRADE_BLOCKED');
    };
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
  let dbPromise,activeDatabase;
  async function db() {
    if(!dbPromise){
      const opening=openDatabase(factory,handle=>{if(activeDatabase===handle){activeDatabase=null;dbPromise=null;}});
      const tracked=opening.then(handle=>{activeDatabase=handle;return handle;}).catch(error=>{if(dbPromise===tracked)dbPromise=null;throw error;});
      dbPromise=tracked;
    }
    return dbPromise;
  }
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
    // Account selection and revocation share one transaction: switching back
    // must never resurrect approvals from the previous account generation.
    const database = await db();
    await new Promise((resolve, reject) => {
        const change = database.transaction([META, CONNECTIONS], "readwrite");
        change.oncomplete = resolve;
        change.onabort = change.onerror = () => reject(problem("HOSTED_STORAGE_WRITE_FAILED"));
        const grants = change.objectStore(CONNECTIONS), all = grants.getAll();
        all.onsuccess = () => {
          for (const grant of all.result) {
            if (!validConnectionRecord(grant)) { change.abort(); return; }
            grants.put({...grant, revoked:true, epoch:grant.epoch+1}, `${grant.origin}|${grant.account}`);
          }
          if (parseEncryptedVault(primary).account === account) change.objectStore(META).delete("selected");
          else change.objectStore(META).put(account, "selected");
        };
    });
    const selected = await read();
    if (selected?.account !== account) fail("HOSTED_STORAGE_READBACK_FAILED");
    return selected;
  }
  async function consumeReplay(key, deadlineAt) {
    if (typeof key !== "string" || key.length > 300 || !Number.isSafeInteger(deadlineAt) || deadlineAt <= Date.now()) fail("HOSTED_REPLAY_INVALID");
    try { await transaction(await db(), "readwrite", store => store.add(deadlineAt, key), REPLAY); }
    catch { fail("HOSTED_REQUEST_REPLAYED_OR_STORAGE_UNAVAILABLE"); }
  }
  // These records authorize account disclosure and opening a fresh review,
  // never signing. The Wallet origin alone reads/writes them. Hints held by a
  // DApp are not credentials and are always checked against this store.
  async function connectionRecord(origin, account, change) {
    if (!registeredProduct(origin) || !/^0x[0-9a-f]{40}$/u.test(account ?? "")) fail("HOSTED_GRANT_INVALID");
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction([CONNECTIONS, META, STORE, ACCOUNTS], change ? "readwrite" : "readonly");
      let result, error;
      tx.oncomplete = () => error ? reject(error) : resolve(result);
      tx.onabort = tx.onerror = () => reject(error ?? problem("HOSTED_STORAGE_WRITE_FAILED"));
      const selected = tx.objectStore(META).get("selected");
      selected.onsuccess = () => {
        const record = selected.result === undefined ? tx.objectStore(STORE).get(KEY) : tx.objectStore(ACCOUNTS).get(selected.result);
        record.onsuccess = () => {
          try { if (parseEncryptedVault(record.result).account !== account) fail("HOSTED_ACCOUNT_CHANGED"); }
          catch (failure) { error = failure; tx.abort(); return; }
          const store = tx.objectStore(CONNECTIONS), key = `${origin}|${account}`, request = store.get(key);
          request.onsuccess = () => {
            try { result = change ? change(request.result) : request.result; if (change) store.put(result, key); }
            catch (failure) { error = failure; tx.abort(); }
          };
        };
      };
    });
  }
  async function approveConnection(origin, account) {
    return connectionRecord(origin, account, previous => {
      if (previous && !validConnectionRecord(previous)) fail("HOSTED_GRANT_INVALID");
      return {version:1, id:randomHostedId(cryptoProvider), origin, account, chainId:HOSTED_CHAIN_ID,
        scopes:["account:read","request:review"], epoch:(previous?.epoch ?? 0)+1, expiresAt:Date.now()+HOSTED_SESSION_MS, revoked:false};
    });
  }
  async function verifyConnection(origin, account, hint) {
    const grant = await connectionRecord(origin, account);
    if (!validConnectionRecord(grant) || grant.revoked || grant.expiresAt <= Date.now() || grant.expiresAt > Date.now()+HOSTED_SESSION_MS ||
      grant.id !== hint?.id || grant.epoch !== hint?.epoch || grant.account !== account || grant.origin !== origin ||
      grant.scopes?.join(",") !== "account:read,request:review") fail("HOSTED_GRANT_REVOKED_OR_EXPIRED");
    return grant;
  }
  async function revokeConnection(origin, account, hint) {
    return connectionRecord(origin, account, previous => {
      if (!validConnectionRecord(previous) || previous.id !== hint?.id || previous.epoch !== hint?.epoch) fail("HOSTED_GRANT_REVOKED_OR_EXPIRED");
      return {...previous, revoked:true, epoch:previous.epoch+1};
    });
  }
  const journalStorage = Object.freeze({
    async get(keys) {
      const result = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (typeof key !== "string" || key.length > 300) fail("HOSTED_JOURNAL_INVALID");
        const value = await transaction(await db(), "readonly", store => store.get(key), JOURNAL);
        if (value !== undefined) result[key] = value;
      }
      return result;
    },
    async set(records) {
      if (!records || typeof records !== "object" || Array.isArray(records) || Object.keys(records).length < 1 || Object.keys(records).length > 4 || Object.keys(records).some(key => key.length > 300)) fail("HOSTED_JOURNAL_INVALID");
      const currentDb = await db();
      await new Promise((resolve, reject) => {
        let tx;
        try { tx = currentDb.transaction(JOURNAL, "readwrite"); } catch { reject(problem("HOSTED_STORAGE_UNAVAILABLE")); return; }
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(problem("HOSTED_STORAGE_WRITE_FAILED"));
        try { for (const [key, value] of Object.entries(records)) tx.objectStore(JOURNAL).put(value, key); }
        catch { tx.abort(); }
      });
    },
  });
  return Object.freeze({ read, create, importEncrypted, listAccounts, addEncryptedAccount, selectAccount, consumeReplay, approveConnection, verifyConnection, revokeConnection, journalStorage });
}
