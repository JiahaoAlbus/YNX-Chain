import assert from "node:assert/strict";
import { test } from "node:test";
import { walletIdentity } from "@ynx-chain/wallet-auth";
import { LEGACY_IDENTITY_KEY, MANIFEST_KEY, type SecureStorageAdapter, WalletRepository } from "./walletRepository";

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
