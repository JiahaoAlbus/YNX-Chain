import assert from "node:assert/strict";
import { test } from "node:test";
import { walletIdentity } from "@ynx-chain/wallet-auth";
import { DELETION_JOURNAL_KEY, LEGACY_IDENTITY_KEY, MANIFEST_KEY, type SecureStorageAdapter, WalletRepository, WalletSecretRecoveryRequired, WalletSecretMigrationRequired } from "./walletRepository";
import { WalletOperationLifecycle } from "../security/operationLifecycle";

const SECRET_ONE = `${"00".repeat(31)}01`;
const SECRET_TWO = `${"00".repeat(31)}02`;

class MemorySecureStorage implements SecureStorageAdapter {
  readonly values = new Map<string,string>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  readonly deletions: string[] = [];
  beforeGet?: (key: string) => Promise<void>;
  beforeSet?: (key: string) => void;
  afterSet?: (key: string) => void;
  beforeDelete?: (key: string) => void;
  readonly authenticatedSecrets = {getItem:(key:string)=>this.getItem(key),setItem:(key:string,value:string)=>this.setItem(key,value),deleteItem:(key:string)=>this.deleteItem(key)};
  async getItem(key:string){this.reads.push(key);await this.beforeGet?.(key);return this.values.get(key)??null;}
  async setItem(key:string,value:string){this.beforeSet?.(key);this.writes.push(key);this.values.set(key,value);this.afterSet?.(key);}
  async deleteItem(key:string){this.beforeDelete?.(key);this.deletions.push(key);this.values.delete(key);}
}
const accountOne = walletIdentity(SECRET_ONE).account;
const accountTwo = walletIdentity(SECRET_TWO).account;
const secretKey = (account: string) => `ynx.wallet.account.auth.v3.${account}`;
const privateReads = (storage: MemorySecureStorage) => storage.reads.filter((key) => key.startsWith("ynx.wallet.account.") || key === LEGACY_IDENTITY_KEY);
async function twoAccounts() {
  const storage = new MemorySecureStorage(), repository = new WalletRepository(storage);
  await repository.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:false});
  await repository.addAccount({secretHex:SECRET_TWO,label:"Savings",createdAt:"2026-07-15T12:01:00.000Z",backupConfirmed:true});
  storage.reads.length=0;storage.writes.length=0;storage.deletions.length=0;
  return { storage, repository };
}

test("creates, confirms backup, switches and deletes multiple secure accounts", async () => {
  const storage=new MemorySecureStorage(), repository=new WalletRepository(storage);
  let manifest=await repository.addAccount({secretHex:SECRET_TWO,label:"Savings",createdAt:"2026-07-15T12:01:00.000Z",backupConfirmed:false});
  manifest=await repository.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:false});
  assert.deepEqual(manifest.accounts.map((item)=>item.label),["Main","Savings"]);
  assert.equal(manifest.selectedAccountId,walletIdentity(SECRET_ONE).account);
  manifest=await repository.confirmBackup(walletIdentity(SECRET_ONE).account);
  assert.equal(manifest.accounts[0]?.backupConfirmed,true);
  manifest=await repository.selectAccount(walletIdentity(SECRET_TWO).account);
  assert.equal(manifest.selectedAccountId,walletIdentity(SECRET_TWO).account);
  manifest=await repository.renameAccount(walletIdentity(SECRET_TWO).account,"Treasury");
  assert.equal(manifest.accounts.find((item)=>item.account===walletIdentity(SECRET_TWO).account)?.label,"Treasury");
  assert.equal((await new WalletRepository(storage).load()).manifest.accounts.find((item)=>item.account===walletIdentity(SECRET_TWO).account)?.label,"Treasury");
  manifest=await repository.deleteAccount(walletIdentity(SECRET_TWO).account);
  assert.equal(manifest.selectedAccountId,walletIdentity(SECRET_ONE).account);
  await assert.rejects(repository.accountSecret(walletIdentity(SECRET_TWO).account),/missing/);
});

test("legacy identity is never decrypted on load and explicit restore preserves its account", async () => {
  const storage=new MemorySecureStorage(), identity=walletIdentity(SECRET_ONE);
  storage.values.set(LEGACY_IDENTITY_KEY,JSON.stringify({schemaVersion:1,account:identity.account,accountSecret:SECRET_ONE,deviceSecret:"41".repeat(32)}));
  const before=await new WalletRepository(storage).load();
  assert.equal(before.manifest.accounts.length,0);
  assert.equal(before.migrated,false);
  assert.equal(privateReads(storage).length,0);
  assert.equal(storage.values.has(LEGACY_IDENTITY_KEY),true);
  const first=await new WalletRepository(storage).migrateLegacyIdentity();
  assert.equal(first.migrated,true);
  assert.equal(first.manifest.accounts[0]?.label,"Migrated account");
  assert.equal(storage.values.has(LEGACY_IDENTITY_KEY),false);
  assert.equal(JSON.stringify([...storage.values.values()]).includes("41".repeat(32)),false);
  const restart=await new WalletRepository(storage).load();
  assert.equal(restart.migrated,false);
  assert.deepEqual(restart.manifest,first.manifest);
});

test("deterministic restart preserves manifest selection using public identity verification", async () => {
  const storage=new MemorySecureStorage(), repository=new WalletRepository(storage);
  await repository.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:true});
  const before=(await repository.load()).manifest;
  const after=(await new WalletRepository(storage).load()).manifest;
  assert.deepEqual(after,before);
  assert.equal(await new WalletRepository(storage).accountSecret(before.selectedAccountId!),SECRET_ONE);
});

test("load, rename, select and backup confirmation never read private account material", async () => {
  const { storage, repository } = await twoAccounts();
  const before = new Map(storage.values);
  await new WalletRepository(storage).load();
  assert.deepEqual(storage.values,before);
  await repository.renameAccount(accountOne,"Renamed");
  await repository.selectAccount(accountOne);
  await repository.confirmBackup(accountOne);
  assert.deepEqual(privateReads(storage),[]);
  for (const account of [accountOne,accountTwo]) assert.equal(storage.values.get(secretKey(account)),before.get(secretKey(account)));
});

for (const fault of ["missing","malformed","different-account"] as const) test(`an account with ${fault} material does not block the other account or public inventory`, async () => {
  const {storage,repository}=await twoAccounts();
  if(fault==="missing")storage.values.delete(secretKey(accountOne));
  if(fault==="malformed")storage.values.set(secretKey(accountOne),"not-json");
  if(fault==="different-account")storage.values.set(secretKey(accountOne),JSON.stringify({schemaVersion:3,account:accountOne,secretHex:SECRET_TWO}));
  assert.equal((await repository.load()).manifest.accounts.length,2);
  assert.deepEqual(privateReads(storage),[]);
  assert.equal(await repository.accountSecret(accountTwo),SECRET_TWO);
  assert.deepEqual(privateReads(storage),[secretKey(accountTwo)]);
  await assert.rejects(repository.accountSecret(accountOne));
  assert.equal((await repository.renameAccount(accountTwo,"Healthy")).accounts[1]?.label,"Healthy");
});

test("public address and valid public key substitution fails without decrypting any secret", async () => {
  const {storage,repository}=await twoAccounts();
  const raw=JSON.parse(storage.values.get(MANIFEST_KEY)!);
  raw.accounts[0].accountPublicKey=walletIdentity(SECRET_TWO).accountPublicKey;
  storage.values.set(MANIFEST_KEY,JSON.stringify(raw));
  await assert.rejects(repository.load(),/public account identity failed verification/);
  await assert.rejects(repository.accountSecret(accountTwo),/verification/);
  assert.deepEqual(privateReads(storage),[]);
});

test("an OS denial for one account does not block public metadata or another account", async () => {
  const {storage,repository}=await twoAccounts();
  storage.beforeGet=async(key)=>{if(key===secretKey(accountOne))throw new Error("OS denied this account access")};
  await assert.rejects(repository.accountSecret(accountOne),/OS denied/);
  assert.equal((await repository.load()).manifest.accounts.length,2);
  assert.equal((await repository.confirmBackup(accountTwo)).accounts[1]?.backupConfirmed,true);
  assert.equal(await repository.accountSecret(accountTwo),SECRET_TWO);
  assert.deepEqual(privateReads(storage),[secretKey(accountOne),secretKey(accountTwo)]);
});

for (const stage of ["intent","manifest","secret","cleanup"] as const) test(`account deletion recovers after ${stage} storage failure`, async () => {
  const {storage,repository}=await twoAccounts();
  const originalManifest=storage.values.get(MANIFEST_KEY),originalSecret=storage.values.get(secretKey(accountOne));
  storage.beforeSet=(key)=>{if(stage==="intent"&&key===DELETION_JOURNAL_KEY||stage==="manifest"&&key===MANIFEST_KEY)throw new Error("Injected write failure")};
  storage.beforeDelete=(key)=>{if(stage==="secret"&&key===secretKey(accountOne)||stage==="cleanup"&&key===DELETION_JOURNAL_KEY)throw new Error("Injected delete failure")};
  await assert.rejects(repository.deleteAccount(accountOne),/Injected/);
  const inventory=(await new WalletRepository(storage).load()).manifest;
  if(stage==="intent"||stage==="manifest"){
    assert.equal(storage.values.get(MANIFEST_KEY),originalManifest);
    assert.equal(storage.values.get(secretKey(accountOne)),originalSecret);
    assert.equal(inventory.accounts.length,2);
  }else{
    assert.deepEqual(inventory.accounts.map(item=>item.account),[accountTwo]);
    assert.equal(storage.values.has(DELETION_JOURNAL_KEY),true);
    await assert.rejects(repository.accountSecret(accountOne),/missing/);
  }
  assert.equal(await repository.accountSecret(accountTwo),SECRET_TWO);
  storage.beforeSet=undefined;storage.beforeDelete=undefined;
  await new WalletRepository(storage).deleteAccount(accountOne);
  assert.equal(storage.values.has(secretKey(accountOne)),false);
  assert.equal(storage.values.has(DELETION_JOURNAL_KEY),false);
  assert.equal(await repository.accountSecret(accountTwo),SECRET_TWO);
});

test("ambiguous manifest write failure is resolved from the committed public inventory", async () => {
  const {storage,repository}=await twoAccounts();
  storage.afterSet=(key)=>{if(key===MANIFEST_KEY)throw new Error("Write persisted before transport failed")};
  await assert.rejects(repository.deleteAccount(accountOne),/persisted/);
  assert.equal(storage.values.has(secretKey(accountOne)),true);
  assert.equal((await repository.load()).manifest.accounts.length,1);
  storage.afterSet=undefined;
  await new WalletRepository(storage).retryPendingDeletions();
  assert.equal(storage.values.has(secretKey(accountOne)),false);
  assert.equal(storage.values.has(DELETION_JOURNAL_KEY),false);
});

test("recovering an uncommitted deletion leaves its account and secret untouched", async () => {
  const {storage,repository}=await twoAccounts();
  const before=new Map(storage.values);
  storage.beforeSet=(key)=>{if(key===MANIFEST_KEY)throw new Error("Manifest unavailable")};
  await assert.rejects(repository.deleteAccount(accountOne),/unavailable/);
  storage.beforeSet=undefined;
  await new WalletRepository(storage).retryPendingDeletions();
  assert.deepEqual(storage.values,before);
});

test("a pending deletion cannot erase a newly imported copy of the same identity", async () => {
  const {storage,repository}=await twoAccounts();
  storage.beforeDelete=(key)=>{if(key===secretKey(accountOne))throw new Error("Delete unavailable")};
  await assert.rejects(repository.deleteAccount(accountOne),/unavailable/);
  const input={secretHex:SECRET_ONE,label:"Restored",createdAt:"2026-07-16T12:00:00.000Z",backupConfirmed:true};
  await assert.rejects(repository.addAccount(input),/pending account removal/);
  storage.beforeDelete=undefined;
  await repository.retryPendingDeletions();
  await repository.addAccount(input);
  await repository.retryPendingDeletions();
  assert.equal(await repository.accountSecret(accountOne),SECRET_ONE);
});

test("operation guards prevent private reads or initial writes after cancellation", async () => {
  for(const operation of ["read","add","delete"] as const){
    const {storage,repository}=await twoAccounts();let active=true;
    const guard=()=>{if(!active)throw new Error("Operation cancelled")};
    storage.beforeGet=async(key)=>{if(key===MANIFEST_KEY)active=false};
    if(operation==="read")await assert.rejects(repository.accountSecret(accountOne,guard),/cancelled/);
    if(operation==="add")await assert.rejects(repository.addAccount({secretHex:"0".repeat(63)+"3",label:"Third",createdAt:"2026-07-16T12:00:00.000Z",backupConfirmed:true},guard),/cancelled/);
    if(operation==="delete")await assert.rejects(repository.deleteAccount(accountOne,guard),/cancelled/);
    assert.deepEqual(privateReads(storage),[]);assert.deepEqual(storage.writes,[]);assert.deepEqual(storage.deletions,[]);
  }
});

test("cancellation after deletion intent stops secret deletion until an explicit retry", async () => {
  const {storage,repository}=await twoAccounts();let active=true;
  const guard=()=>{if(!active)throw new Error("Operation cancelled")};
  storage.afterSet=(key)=>{if(key===DELETION_JOURNAL_KEY)active=false};
  await assert.rejects(repository.deleteAccount(accountOne,guard),/cancelled/);
  assert.equal(storage.values.has(secretKey(accountOne)),true);
  assert.equal(storage.values.has(DELETION_JOURNAL_KEY),true);
  assert.equal((await repository.load()).manifest.accounts.length,2);
  storage.afterSet=undefined;
  await repository.deleteAccount(accountOne);
  assert.equal(storage.values.has(secretKey(accountOne)),false);
});

test("cancellation at the last pre-write await leaves every account record unchanged", async () => {
  for(const operation of ["add","delete","migrate"] as const){
    const {storage,repository}=operation==="migrate"?{storage:new MemorySecureStorage(),repository:null}:await twoAccounts();
    const target=repository??new WalletRepository(storage);
    if(operation==="migrate")storage.values.set(LEGACY_IDENTITY_KEY,JSON.stringify({schemaVersion:1,account:accountOne,accountSecret:SECRET_ONE,deviceSecret:"41".repeat(32)}));
    const before=new Map(storage.values);let active=true;
    const guard=()=>{if(!active)throw new Error("Operation cancelled")};
    storage.beforeGet=async(key)=>{if(key===DELETION_JOURNAL_KEY)active=false};
    if(operation==="add")await assert.rejects(target.addAccount({secretHex:"0".repeat(63)+"3",label:"Third",createdAt:"2026-07-16T12:00:00.000Z",backupConfirmed:true},guard),/cancelled/);
    if(operation==="delete")await assert.rejects(target.deleteAccount(accountOne,guard),/cancelled/);
    if(operation==="migrate")await assert.rejects(target.migrateLegacyIdentity(guard),/cancelled/);
    assert.deepEqual(storage.values,before);assert.deepEqual(storage.writes,[]);assert.deepEqual(storage.deletions,[]);
  }
});

test("cancellation while an account read is pending prevents returning its material", async () => {
  const {storage,repository}=await twoAccounts();let active=true;
  const guard=()=>{if(!active)throw new Error("Operation cancelled")};
  storage.beforeGet=async(key)=>{if(key===secretKey(accountOne))active=false};
  await assert.rejects(repository.accountSecret(accountOne,guard),/cancelled/);
  assert.deepEqual(privateReads(storage),[secretKey(accountOne)]);
});

test("a targeted secret read cannot return after its public account has been deleted", async () => {
  const {storage,repository}=await twoAccounts();
  const originalGet=storage.getItem.bind(storage);
  storage.getItem=async(key)=>{
    const value=await originalGet(key);
    if(key===secretKey(accountOne))await repository.deleteAccount(accountOne);
    return value;
  };
  await assert.rejects(repository.accountSecret(accountOne),/changed/);
  assert.deepEqual(privateReads(storage),[secretKey(accountOne)]);
});

test("metadata mutations are serialized across repository instances sharing one adapter", async () => {
  const {storage,repository}=await twoAccounts(),second=new WalletRepository(storage);
  await Promise.all([repository.renameAccount(accountOne,"First renamed"),second.renameAccount(accountTwo,"Second renamed"),repository.confirmBackup(accountOne)]);
  const manifest=(await repository.load()).manifest;
  assert.deepEqual(manifest.accounts.map(item=>item.label),["First renamed","Second renamed"]);
  assert.equal(manifest.accounts[0]?.backupConfirmed,true);
  assert.deepEqual(privateReads(storage),[]);
});

test("malformed deletion journal blocks destructive retry without blocking healthy account reads", async () => {
  const {storage,repository}=await twoAccounts();
  storage.values.set(DELETION_JOURNAL_KEY,JSON.stringify({schemaVersion:1,accounts:[{account:accountOne,accountPublicKey:walletIdentity(SECRET_TWO).accountPublicKey}]}));
  await assert.rejects(repository.retryPendingDeletions(),/verification/);
  assert.equal((await repository.load()).manifest.accounts.length,2);
  assert.equal(await repository.accountSecret(accountTwo),SECRET_TWO);
  assert.deepEqual(storage.deletions,[]);
});

test("explicit legacy restore cannot overwrite existing accounts or read legacy material while cancelled", async () => {
  const {storage,repository}=await twoAccounts();
  const legacy=JSON.stringify({schemaVersion:1,account:accountOne,accountSecret:SECRET_ONE,deviceSecret:"41".repeat(32)});
  storage.values.set(LEGACY_IDENTITY_KEY,legacy);
  await assert.rejects(repository.migrateLegacyIdentity(),/cannot be overwritten/);
  assert.equal(storage.values.get(LEGACY_IDENTITY_KEY),legacy);
  assert.deepEqual(privateReads(storage),[]);
  const empty=new MemorySecureStorage();empty.values.set(LEGACY_IDENTITY_KEY,legacy);
  await assert.rejects(new WalletRepository(empty).migrateLegacyIdentity(()=>{throw new Error("Cancelled")}),/Cancelled/);
  assert.deepEqual(privateReads(empty),[]);
});

test("legacy migration interrupted before manifest commit retains the original identity for retry", async () => {
  const storage=new MemorySecureStorage();
  const legacy=JSON.stringify({schemaVersion:1,account:accountOne,accountSecret:SECRET_ONE,deviceSecret:"41".repeat(32)});
  storage.values.set(LEGACY_IDENTITY_KEY,legacy);
  storage.beforeSet=(key)=>{if(key===MANIFEST_KEY)throw new Error("Manifest unavailable")};
  await assert.rejects(new WalletRepository(storage).migrateLegacyIdentity(),/unavailable/);
  assert.equal(storage.values.get(LEGACY_IDENTITY_KEY),legacy);
  storage.beforeSet=undefined;
  const restored=await new WalletRepository(storage).migrateLegacyIdentity();
  assert.equal(restored.manifest.accounts[0]?.account,accountOne);
  assert.equal(await new WalletRepository(storage).accountSecret(accountOne),SECRET_ONE);
});

test("legacy cleanup failure preserves the committed account and its original recovery record", async () => {
  const storage=new MemorySecureStorage();
  const legacy=JSON.stringify({schemaVersion:1,account:accountOne,accountSecret:SECRET_ONE,deviceSecret:"41".repeat(32)});
  storage.values.set(LEGACY_IDENTITY_KEY,legacy);
  storage.beforeDelete=(key)=>{if(key===LEGACY_IDENTITY_KEY)throw new Error("Legacy cleanup unavailable")};
  await assert.rejects(new WalletRepository(storage).migrateLegacyIdentity(),/cleanup unavailable/);
  storage.reads.length=0;
  const restored=(await new WalletRepository(storage).load()).manifest;
  assert.equal(restored.selectedAccountId,accountOne);
  assert.deepEqual(privateReads(storage),[]);
  assert.equal(await new WalletRepository(storage).accountSecret(accountOne),SECRET_ONE);
  assert.equal(storage.values.get(LEGACY_IDENTITY_KEY),legacy);
});

test("rejects manifest, metadata and secret tampering", async () => {
  const storage=new MemorySecureStorage(), repository=new WalletRepository(storage);
  const manifest=await repository.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:true});
  const raw=JSON.parse(storage.values.get(MANIFEST_KEY)!);
  storage.values.set(MANIFEST_KEY,JSON.stringify({...raw,unexpected:true}));
  await assert.rejects(repository.load(),/unknown or missing/);
  storage.values.set(MANIFEST_KEY,JSON.stringify({...raw,accounts:[{...raw.accounts[0],accountPublicKey:`03${"00".repeat(32)}`}]}));
  await assert.rejects(repository.load(),/verification/);
  assert.equal(manifest.accounts.length,1);
});

test("offline recovery reconstructs only the native account and never restores product sessions", async () => {
  const lostDevice=new MemorySecureStorage(),replacementDevice=new MemorySecureStorage();
  const original=new WalletRepository(lostDevice);
  const before=await original.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:true});
  lostDevice.values.set("ynx.wallet.auth-nonces.v1",JSON.stringify([["used_nonce_abcdefghijklmnopqrstuvwxyz12","2026-07-15T12:04:00.000Z"]]));
  lostDevice.values.set("ynx.wallet.authorization-audit.v1","[]");
  const restored=await new WalletRepository(replacementDevice).addAccount({secretHex:SECRET_ONE,label:"Recovered",createdAt:"2026-07-16T12:00:00.000Z",backupConfirmed:true});
  assert.equal(restored.accounts[0]?.account,before.accounts[0]?.account);
  assert.equal(restored.accounts[0]?.accountPublicKey,before.accounts[0]?.accountPublicKey);
  assert.equal(replacementDevice.values.has("ynx.wallet.auth-nonces.v1"),false);
  assert.equal(replacementDevice.values.has("ynx.wallet.authorization-audit.v1"),false);
  assert.equal([...replacementDevice.values.keys()].some((key)=>key.includes("session")),false);
});

const legacySecretKey = (account:string) => `ynx.wallet.account.v2.${account}`;
const protectionKey = (account:string) => `ynx.wallet.protection.v1.${account}`;
const migrationAuthorization = {allowLegacyMigration:true} as const;
async function legacyV2Account() {
  const {storage,repository}=await twoAccounts();
  storage.values.delete(secretKey(accountOne));storage.values.delete(protectionKey(accountOne));
  storage.values.set(legacySecretKey(accountOne),JSON.stringify({schemaVersion:2,account:accountOne,secretHex:SECRET_ONE}));
  storage.reads.length=0;storage.writes.length=0;storage.deletions.length=0;
  return {storage,repository};
}

test("an old account is retained on startup and cannot be silently migrated by a secret read",async()=>{
  const {storage,repository}=await legacyV2Account();
  assert.equal((await repository.load()).manifest.accounts.length,2);
  assert.deepEqual(privateReads(storage),[]);
  await assert.rejects(repository.accountSecret(accountOne),WalletSecretMigrationRequired);
  assert.equal(storage.reads.includes(legacySecretKey(accountOne)),false);
  assert.equal(storage.values.has(legacySecretKey(accountOne)),true);
  assert.equal(storage.writes.length,0);
});

test("authorized v2 migration verifies the OS-protected readback before deleting its old record",async()=>{
  const {storage,repository}=await legacyV2Account();
  let protectedReadback=false;
  storage.beforeGet=async(key)=>{if(key===secretKey(accountOne)&&storage.values.has(key))protectedReadback=true};
  storage.beforeDelete=(key)=>{if(key===legacySecretKey(accountOne))assert.equal(protectedReadback,true)};
  assert.equal(await repository.accountSecret(accountOne,undefined,migrationAuthorization),SECRET_ONE);
  assert.equal(storage.values.has(legacySecretKey(accountOne)),false);
  assert.equal(JSON.parse(storage.values.get(secretKey(accountOne))!).schemaVersion,3);
  assert.equal(JSON.parse(storage.values.get(protectionKey(accountOne))!).state,"complete");
  for(const [key,value] of storage.values) if(!key.startsWith("ynx.wallet.account.")) assert.equal(value.includes(SECRET_ONE),false);
});

test("a protected write failure preserves the old record and resumes after restart",async()=>{
  const {storage,repository}=await legacyV2Account();
  const legacy=storage.values.get(legacySecretKey(accountOne));
  storage.beforeSet=(key)=>{if(key===secretKey(accountOne))throw new Error("OS authenticated write denied")};
  await assert.rejects(repository.accountSecret(accountOne,undefined,migrationAuthorization),/denied/);
  assert.equal(storage.values.get(legacySecretKey(accountOne)),legacy);
  assert.equal(storage.values.has(secretKey(accountOne)),false);
  storage.beforeSet=undefined;
  assert.equal(await new WalletRepository(storage).accountSecret(accountOne,undefined,migrationAuthorization),SECRET_ONE);
  assert.equal(storage.values.has(legacySecretKey(accountOne)),false);
});

test("a mismatching protected readback preserves the old key and never returns the mismatching material",async()=>{
  const {storage,repository}=await legacyV2Account();
  storage.afterSet=(key)=>{if(key===secretKey(accountOne))storage.values.set(key,JSON.stringify({schemaVersion:3,account:accountOne,secretHex:SECRET_TWO}))};
  await assert.rejects(repository.accountSecret(accountOne,undefined,migrationAuthorization),/verification/);
  assert.equal(storage.values.has(legacySecretKey(accountOne)),true);
  assert.equal(storage.deletions.includes(legacySecretKey(accountOne)),false);
  assert.equal(JSON.parse(storage.values.get(protectionKey(accountOne))!).state,"pending");
  storage.afterSet=undefined;
  // Explicit offline import can repair a partial or corrupted protected record.
  await repository.restoreAccountSecret(accountOne,SECRET_ONE);
  assert.equal(await repository.accountSecret(accountOne),SECRET_ONE);
});

for(const phase of ["protected-write","readback","verified-marker"] as const) test(`cancellation after ${phase} preserves the legacy key and never starts cleanup`,async()=>{
  const {storage,repository}=await legacyV2Account();let active=true;
  const guard=()=>{if(!active)throw new Error("Operation cancelled")};
  storage.afterSet=(key)=>{
    if(phase==="protected-write"&&key===secretKey(accountOne))active=false;
    if(phase==="verified-marker"&&key===protectionKey(accountOne)&&JSON.parse(storage.values.get(key)!).state==="protected")active=false;
  };
  storage.beforeGet=async(key)=>{if(phase==="readback"&&key===secretKey(accountOne)&&storage.values.has(key))active=false};
  await assert.rejects(repository.accountSecret(accountOne,guard,migrationAuthorization),/cancelled/);
  assert.equal(storage.values.has(legacySecretKey(accountOne)),true);
  assert.equal(storage.deletions.includes(legacySecretKey(accountOne)),false);
  storage.afterSet=undefined;storage.beforeGet=undefined;
  assert.equal(await new WalletRepository(storage).accountSecret(accountOne,undefined,migrationAuthorization),SECRET_ONE);
  assert.equal(storage.values.has(legacySecretKey(accountOne)),false);
});

test("an enrollment-invalidated protected key never downgrades to a retained old copy",async()=>{
  const {storage,repository}=await legacyV2Account();
  storage.beforeDelete=(key)=>{if(key===legacySecretKey(accountOne))throw new Error("cleanup interrupted")};
  await assert.rejects(repository.accountSecret(accountOne,undefined,migrationAuthorization),/interrupted/);
  storage.beforeDelete=undefined;storage.values.delete(secretKey(accountOne));storage.reads.length=0;
  await assert.rejects(new WalletRepository(storage).accountSecret(accountOne,undefined,migrationAuthorization),WalletSecretRecoveryRequired);
  assert.equal(storage.reads.includes(legacySecretKey(accountOne)),false);
  assert.equal((await repository.load()).manifest.accounts.length,2);
  await assert.rejects(repository.restoreAccountSecret(accountOne,SECRET_TWO),/verification/);
  storage.beforeSet=(key)=>{if(key===secretKey(accountOne))throw new Error("recovery write denied")};
  await assert.rejects(repository.restoreAccountSecret(accountOne,SECRET_ONE),/denied/);
  assert.equal(JSON.parse(storage.values.get(protectionKey(accountOne))!).state,"recovery-pending");
  storage.reads.length=0;
  await assert.rejects(repository.accountSecret(accountOne,undefined,migrationAuthorization),WalletSecretRecoveryRequired);
  assert.equal(storage.reads.includes(legacySecretKey(accountOne)),false);
  assert.equal(storage.values.has(legacySecretKey(accountOne)),true);
  storage.beforeSet=undefined;
  await repository.restoreAccountSecret(accountOne,SECRET_ONE);
  assert.equal(await repository.accountSecret(accountOne),SECRET_ONE);
});

test("native authentication cancellation does not trigger an old-key fallback",async()=>{
  const {storage,repository}=await legacyV2Account();
  storage.beforeGet=async(key)=>{if(key===secretKey(accountOne))throw new Error("Native biometric cancelled")};
  await assert.rejects(repository.accountSecret(accountOne,undefined,migrationAuthorization),/cancelled/);
  assert.equal(storage.reads.includes(legacySecretKey(accountOne)),false);
  assert.equal(storage.values.has(legacySecretKey(accountOne)),true);
});

for(const transition of ["background","switch","lock"] as const) test(`real operation lifecycle ${transition} during migration stops late private reads and cleanup`,async()=>{
  const {storage,repository}=await legacyV2Account();
  const operations=new WalletOperationLifecycle();operations.setAppState("active");operations.setAccount(accountOne);
  const scope=operations.scope(),lease=scope.begin({account:accountOne,requireUnlocked:false});
  storage.afterSet=(key)=>{if(key===secretKey(accountOne)){
    if(transition==="background")operations.setAppState("background");
    if(transition==="switch")operations.setAccount(accountTwo);
    if(transition==="lock")operations.lock();
  }};
  await assert.rejects(repository.accountSecret(accountOne,lease.assert,migrationAuthorization),/cancelled|expired|changed/i);
  assert.equal(storage.values.has(legacySecretKey(accountOne)),true);
  assert.equal(privateReads(storage).filter(key=>key===secretKey(accountOne)).length,1);
  assert.equal(storage.deletions.length,0);
  lease.finish();
});

test("restarting an interrupted v1 cleanup verifies protected material then removes the retained legacy record",async()=>{
  const storage=new MemorySecureStorage();
  storage.values.set(LEGACY_IDENTITY_KEY,JSON.stringify({schemaVersion:1,account:accountOne,accountSecret:SECRET_ONE,deviceSecret:"41".repeat(32)}));
  storage.beforeDelete=(key)=>{if(key===LEGACY_IDENTITY_KEY)throw new Error("cleanup interrupted")};
  await assert.rejects(new WalletRepository(storage).migrateLegacyIdentity(),/interrupted/);
  storage.beforeDelete=undefined;storage.reads.length=0;
  const result=await new WalletRepository(storage).migrateLegacyIdentity();
  assert.equal(result.manifest.accounts[0]?.account,accountOne);
  assert.equal(storage.values.has(LEGACY_IDENTITY_KEY),false);
  assert.equal(storage.reads.includes(LEGACY_IDENTITY_KEY),false);
});

test("an adapter without authenticated secret support fails closed before creating an account",async()=>{
  const memory=new MemorySecureStorage();
  const storage:SecureStorageAdapter={getItem:key=>memory.getItem(key),setItem:(key,value)=>memory.setItem(key,value),deleteItem:key=>memory.deleteItem(key)};
  const repository=new WalletRepository(storage);
  assert.equal((await repository.load()).manifest.accounts.length,0);
  await assert.rejects(repository.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:true}),/OS-authenticated/);
  assert.equal(memory.values.size,0);
});

test("deleting an interrupted v1 migration removes both protected and retained legacy copies",async()=>{
  const storage=new MemorySecureStorage();
  storage.values.set(LEGACY_IDENTITY_KEY,JSON.stringify({schemaVersion:1,account:accountOne,accountSecret:SECRET_ONE,deviceSecret:"41".repeat(32)}));
  storage.beforeDelete=(key)=>{if(key===LEGACY_IDENTITY_KEY)throw new Error("cleanup interrupted")};
  const repository=new WalletRepository(storage);
  await assert.rejects(repository.migrateLegacyIdentity(),/interrupted/);
  storage.beforeDelete=undefined;storage.reads.length=0;
  await repository.deleteAccount(accountOne);
  assert.equal(storage.values.has(LEGACY_IDENTITY_KEY),false);
  assert.equal(storage.values.has(secretKey(accountOne)),false);
  assert.equal(storage.values.has(protectionKey(accountOne)),false);
  assert.deepEqual(privateReads(storage),[]);
});

test("cancellation after public removal retains the deletion journal and both secret copies for explicit retry",async()=>{
  const {storage,repository}=await legacyV2Account();let active=true;
  const guard=()=>{if(!active)throw new Error("Operation cancelled")};
  storage.afterSet=(key)=>{if(key===MANIFEST_KEY)active=false};
  await assert.rejects(repository.deleteAccount(accountOne,guard),/cancelled/);
  assert.equal(storage.values.has(legacySecretKey(accountOne)),true);
  assert.equal(storage.values.has(DELETION_JOURNAL_KEY),true);
  assert.equal(storage.deletions.length,0);
  storage.afterSet=undefined;
  await new WalletRepository(storage).retryPendingDeletions();
  assert.equal(storage.values.has(legacySecretKey(accountOne)),false);
  assert.equal(storage.values.has(DELETION_JOURNAL_KEY),false);
});

test("offline restore after v1 cleanup failure and enrollment invalidation retains then removes the original v1 copy",async()=>{
  const storage=new MemorySecureStorage(),repository=new WalletRepository(storage);
  const legacy=JSON.stringify({schemaVersion:1,account:accountOne,accountSecret:SECRET_ONE,deviceSecret:"41".repeat(32)});
  storage.values.set(LEGACY_IDENTITY_KEY,legacy);
  storage.beforeDelete=(key)=>{if(key===LEGACY_IDENTITY_KEY)throw new Error("v1 cleanup interrupted")};
  await assert.rejects(repository.migrateLegacyIdentity(),/interrupted/);
  const manifest=(await repository.load()).manifest;
  storage.beforeDelete=undefined;storage.values.delete(secretKey(accountOne));storage.reads.length=0;
  await assert.rejects(repository.accountSecret(accountOne,undefined,migrationAuthorization),WalletSecretRecoveryRequired);
  assert.equal(storage.reads.includes(LEGACY_IDENTITY_KEY),false);
  storage.beforeSet=(key)=>{if(key===secretKey(accountOne))throw new Error("replacement protected write denied")};
  await assert.rejects(repository.restoreAccountSecret(accountOne,SECRET_ONE),/denied/);
  assert.equal(storage.values.get(LEGACY_IDENTITY_KEY),legacy);
  assert.equal(JSON.parse(storage.values.get(protectionKey(accountOne))!).source,"legacy-v1");
  storage.beforeSet=undefined;
  assert.deepEqual(await new WalletRepository(storage).restoreAccountSecret(accountOne,SECRET_ONE),manifest);
  assert.equal(storage.values.has(LEGACY_IDENTITY_KEY),false);
  assert.equal(storage.values.has(legacySecretKey(accountOne)),false);
  assert.equal(JSON.parse(storage.values.get(protectionKey(accountOne))!).source,"legacy-v1");
  assert.equal(JSON.parse(storage.values.get(protectionKey(accountOne))!).state,"complete");
  assert.equal(await repository.accountSecret(accountOne),SECRET_ONE);
});
