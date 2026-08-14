import assert from "node:assert/strict";
import { test } from "node:test";
import { walletIdentity } from "@ynx-chain/wallet-auth";
import { emptyManifest, LEGACY_IDENTITY_KEY, MANIFEST_KEY, MUTATION_KEY, type SecureStorageAdapter, WalletRepository } from "./walletRepository";

const SECRET_ONE = `${"00".repeat(31)}01`;
const SECRET_TWO = `${"00".repeat(31)}02`;

class MemorySecureStorage implements SecureStorageAdapter {
  readonly values = new Map<string,string>();
  async getItem(key:string){return this.values.get(key)??null;}
  async setItem(key:string,value:string){this.values.set(key,value);}
  async deleteItem(key:string){this.values.delete(key);}
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

test("migrates the strict v1 identity once and discards its cross-product device secret", async () => {
  const storage=new MemorySecureStorage(), identity=walletIdentity(SECRET_ONE);
  storage.values.set(LEGACY_IDENTITY_KEY,JSON.stringify({schemaVersion:1,account:identity.account,accountSecret:SECRET_ONE,deviceSecret:"41".repeat(32)}));
  const first=await new WalletRepository(storage).load();
  assert.equal(first.migrated,true);
  assert.equal(first.manifest.accounts[0]?.label,"Migrated account");
  assert.equal(storage.values.has(LEGACY_IDENTITY_KEY),false);
  assert.equal(JSON.stringify([...storage.values.values()]).includes("41".repeat(32)),false);
  const restart=await new WalletRepository(storage).load();
  assert.equal(restart.migrated,false);
  assert.deepEqual(restart.manifest,first.manifest);
});

test("restart completes legacy cleanup only when v1 identity matches the verified v2 manifest",async()=>{
  const storage=new MemorySecureStorage(),identity=walletIdentity(SECRET_ONE),legacy=JSON.stringify({schemaVersion:1,account:identity.account,accountSecret:SECRET_ONE,deviceSecret:"41".repeat(32)}),repository=new WalletRepository(storage);
  storage.values.set(LEGACY_IDENTITY_KEY,legacy);
  const migrated=await repository.load();
  storage.values.set(LEGACY_IDENTITY_KEY,legacy);
  assert.deepEqual((await new WalletRepository(storage).load()).manifest,migrated.manifest);
  assert.equal(storage.values.has(LEGACY_IDENTITY_KEY),false);

  const conflicting=walletIdentity(SECRET_TWO);
  storage.values.set(LEGACY_IDENTITY_KEY,JSON.stringify({schemaVersion:1,account:conflicting.account,accountSecret:SECRET_TWO,deviceSecret:"42".repeat(32)}));
  await assert.rejects(new WalletRepository(storage).load(),/conflicts/);
  assert.equal(storage.values.has(LEGACY_IDENTITY_KEY),true);
});

test("deterministic restart preserves only manifest selection and starts from verified secrets", async () => {
  const storage=new MemorySecureStorage(), repository=new WalletRepository(storage);
  await repository.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:true});
  const before=(await repository.load()).manifest;
  const after=(await new WalletRepository(storage).load()).manifest;
  assert.deepEqual(after,before);
  assert.equal(await new WalletRepository(storage).accountSecret(before.selectedAccountId!),SECRET_ONE);
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

test("dismissed sensitive attempts cannot add or delete account material",async()=>{
  const storage=new MemorySecureStorage(),repository=new WalletRepository(storage),blocked=()=>{throw new Error("backgrounded")};
  await assert.rejects(repository.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:true},blocked),/backgrounded/);
  assert.deepEqual((await repository.load()).manifest,emptyManifest());
  assert.equal(storage.values.size,0);
  const manifest=await repository.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:true});
  await assert.rejects(repository.deleteAccount(manifest.selectedAccountId!,blocked),/backgrounded/);
  assert.deepEqual((await repository.load()).manifest,manifest);
  assert.equal(await repository.accountSecret(manifest.selectedAccountId!),SECRET_ONE);
});

test("restart journal rolls back incomplete add and completes interrupted delete without secret leakage",async()=>{
  const seedStorage=new MemorySecureStorage(),seedRepository=new WalletRepository(seedStorage);
  const seeded=await seedRepository.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:true}),account=seeded.selectedAccountId!;
  const secretEntry=[...seedStorage.values.entries()].find(([key])=>key.startsWith("ynx.wallet.account.v2."))!;

  const interruptedAdd=new MemorySecureStorage();
  interruptedAdd.values.set(secretEntry[0],secretEntry[1]);
  interruptedAdd.values.set(MUTATION_KEY,JSON.stringify({schemaVersion:1,kind:"add",account}));
  assert.deepEqual((await new WalletRepository(interruptedAdd).load()).manifest,emptyManifest());
  assert.equal(interruptedAdd.values.has(secretEntry[0]),false);
  assert.equal(interruptedAdd.values.has(MUTATION_KEY),false);

  seedStorage.values.set(MANIFEST_KEY,JSON.stringify(emptyManifest()));
  seedStorage.values.set(MUTATION_KEY,JSON.stringify({schemaVersion:1,kind:"delete",account}));
  assert.deepEqual((await new WalletRepository(seedStorage).load()).manifest,emptyManifest());
  assert.equal(seedStorage.values.has(secretEntry[0]),false);
  assert.equal(seedStorage.values.has(MUTATION_KEY),false);
});

test("committed add journal preserves verified secret while tampered journal fails closed",async()=>{
  const storage=new MemorySecureStorage(),repository=new WalletRepository(storage),manifest=await repository.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:false}),account=manifest.selectedAccountId!;
  storage.values.set(MUTATION_KEY,JSON.stringify({schemaVersion:1,kind:"add",account}));
  assert.deepEqual((await new WalletRepository(storage).load()).manifest,manifest);
  assert.equal(await repository.accountSecret(account),SECRET_ONE);
  storage.values.set(MUTATION_KEY,JSON.stringify({schemaVersion:1,kind:"add",account,unknown:true}));
  await assert.rejects(new WalletRepository(storage).load(),/unknown|journal/);
  assert.equal(storage.values.has(MUTATION_KEY),true);
});

test("concurrent manifest mutations serialize without lost account metadata",async()=>{
  const storage=new MemorySecureStorage(),repository=new WalletRepository(storage),manifest=await repository.addAccount({secretHex:SECRET_ONE,label:"Main",createdAt:"2026-07-15T12:00:00.000Z",backupConfirmed:false}),account=manifest.selectedAccountId!;
  await Promise.all([repository.renameAccount(account,"Primary"),repository.confirmBackup(account)]);
  const current=(await repository.load()).manifest.accounts[0]!;
  assert.equal(current.label,"Primary");
  assert.equal(current.backupConfirmed,true);
});
