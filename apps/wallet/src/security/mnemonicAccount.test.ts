import assert from "node:assert/strict";
import {test} from "node:test";
import {HDNodeWallet} from "ethers";
import {walletIdentity} from "@ynx-chain/wallet-auth";
import {createMobileMnemonic, importMobileMnemonic, mobileMnemonicFromEntropy, MOBILE_MNEMONIC_PATH} from "./mnemonicAccount";
import {MnemonicInputController} from "../state/mnemonicInput";
import {WalletRepository, MANIFEST_KEY, type SecureStorageAdapter} from "../storage/walletRepository";

// Published BIP39 zero-entropy vectors only, never real accounts or OS storage.
const PHRASE12="abandon ".repeat(11)+"about",PHRASE24="abandon ".repeat(23)+"art";
const now="2026-10-14T00:00:00.000Z",guard=()=>{};
class PublicStorage implements SecureStorageAdapter{
  readonly publicValues=new Map<string,string>();
  readonly protectedValues=new Map<string,string>();
  beforeProtectedSet?:()=>void; afterProtectedSet?:()=>void; beforeProtectedGet?:()=>void;
  assertSecretProtectionAvailable=async()=>{};
  getItem=async(key:string)=>this.publicValues.get(key)??null;
  setItem=async(key:string,value:string)=>{this.publicValues.set(key,value)};
  deleteItem=async(key:string)=>{this.publicValues.delete(key)};
  authenticatedSecrets={getItem:async(key:string)=>{this.beforeProtectedGet?.();return this.protectedValues.get(key)??null;},setItem:async(key:string,value:string)=>{this.beforeProtectedSet?.();this.protectedValues.set(key,value);this.afterProtectedSet?.();},deleteItem:async(key:string)=>{this.protectedValues.delete(key)}};
}
const input=(entropyHex="00".repeat(16))=>({entropyHex,label:"PUBLIC mnemonic QA",createdAt:now,backupConfirmed:true});
async function stored(){const storage=new PublicStorage(),repo=new WalletRepository(storage),manifest=await repo.addMnemonicAccount(input(),guard);return{storage,repo,account:manifest.accounts[0]!.account};}
for(const [phrase,count] of [[PHRASE12,12],[PHRASE24,24]] as const)test(`R24 public ${count}-word vector has same Mac path/native principal`,()=>{
  const material=importMobileMnemonic(phrase);
  assert.equal(material.wordCount,count);assert.equal(material.path,"m/44'/60'/0'/0/0");
  const reference=HDNodeWallet.fromPhrase(phrase,"",MOBILE_MNEMONIC_PATH);
  assert.equal(material.secretHex,reference.privateKey.slice(2));assert.equal(material.account,walletIdentity(material.secretHex).account);
  assert.equal(material.phrase,phrase);
});
test("R24 recovery phrase rejects invalid checksum and unsupported passphrase",()=>{
  assert.throws(()=>importMobileMnemonic("abandon ".repeat(12).trim()),/valid English/);
  assert.throws(()=>importMobileMnemonic(PHRASE12,"not-empty"),/Passphrase/);
  assert.throws(()=>importMobileMnemonic("abandon ".repeat(15).trim()),/valid English/);
});
for(const count of [12,24] as const)test(`R24 ${count}-word generation zeros random byte buffer on success`,async()=>{
  let raw:Uint8Array|undefined;const material=await createMobileMnemonic(count,async n=>raw=new Uint8Array(n).fill(1),guard);
  assert.equal(material.wordCount,count);assert.ok(raw?.every(value=>value===0));
});
test("R24 generation cancellation wipes entropy and returns no material",async()=>{
  let live=true,raw:Uint8Array|undefined;
  await assert.rejects(createMobileMnemonic(12,async n=>{raw=new Uint8Array(n).fill(2);live=false;return raw;},()=>{if(!live)throw Error("cancelled");}),/cancelled/);
  assert.ok(raw?.every(value=>value===0));
});
test("R24 grid matches selection without truncating pasted words",()=>{
  const form=new MnemonicInputController();form.begin(12);form.setWord(0,PHRASE12);const old=form.view();
  assert.equal(old.complete,true);assert.throws(()=>form.setWord(0,PHRASE24),/nothing was truncated/);assert.deepEqual(form.view(),old);
  form.select(24);assert.equal(form.view().words.length,24);assert.ok(form.view().words.every(word=>word===""));form.setWord(0,PHRASE24);assert.equal(form.review().material.wordCount,24);
});
test("R24 numbered input hides by default, clears visibility and invalidates reviewed material",()=>{
  const form=new MnemonicInputController();form.begin();form.setWord(0,PHRASE12);assert.equal(form.view().visible,false);form.toggleVisibility();assert.equal(form.view().visible,true);
  const review=form.review();form.clear();assert.equal(form.view().visible,false);assert.ok(form.view().words.every(word=>word===""));assert.throws(review.assertCurrent,/closed/);
});
test("R24 edit after review cannot authorize an obsolete import",()=>{
  const form=new MnemonicInputController();form.begin();form.setWord(0,PHRASE12);const review=form.review();form.setWord(11,"wrong");assert.throws(review.assertCurrent,/changed/);
});
test("R24 entropy stays solely inside existing authenticated secret envelope",async()=>{
  const {storage,repo,account}=await stored();const encoded=storage.protectedValues.get(`ynx.wallet.account.auth.v3.${account}`)!;
  assert.equal(JSON.parse(encoded).schemaVersion,4);
  for(const value of storage.publicValues.values()){assert.ok(!value.includes("entropyHex"));assert.ok(!value.includes("secretHex"));assert.ok(!value.includes(PHRASE12));}
  assert.equal((await repo.accountMnemonic(account,guard)).phrase,PHRASE12);
  assert.equal(await repo.accountSecret(account,guard),importMobileMnemonic(PHRASE12).secretHex);
  storage.beforeProtectedGet=()=>{throw Error("public load must not decrypt")};assert.equal((await repo.load()).manifest.accounts[0]?.account,account);
});
test("R24 unconfirmed backup and failed strong-biometric preflight write nothing",async()=>{
  const s=new PublicStorage(),repo=new WalletRepository(s);await assert.rejects(repo.addMnemonicAccount({...input(),backupConfirmed:false},guard),/Confirm/);assert.equal(s.publicValues.size,0);assert.equal(s.protectedValues.size,0);
  s.assertSecretProtectionAvailable=async()=>{throw Error("strong biometrics required")};await assert.rejects(repo.addMnemonicAccount(input(),guard),/biometrics/);assert.equal(s.publicValues.size,0);assert.equal(s.protectedValues.size,0);
});
test("R24 losing entropy in secret readback cannot publish a successful account",async()=>{
  const s=new PublicStorage(),repo=new WalletRepository(s);s.afterProtectedSet=()=>{for(const [key,value]of s.protectedValues){const record=JSON.parse(value);s.protectedValues.set(key,JSON.stringify({schemaVersion:3,account:record.account,secretHex:record.secretHex}));}};
  await assert.rejects(repo.addMnemonicAccount(input(),guard),/readback/);assert.ok(!s.publicValues.has(MANIFEST_KEY));assert.equal(s.protectedValues.size,1);
});
test("R24 lock during secret save retains protected original but reports no success",async()=>{
  const s=new PublicStorage(),repo=new WalletRepository(s);let live=true;s.afterProtectedSet=()=>{live=false};await assert.rejects(repo.addMnemonicAccount(input(),()=>{if(!live)throw Error("locked");}),/locked/);assert.equal(s.protectedValues.size,1);assert.ok(!s.publicValues.has(MANIFEST_KEY));
});
test("R24 protected entropy/path substitution and foreign phrase cannot recover an account",async()=>{
  const {storage,repo,account}=await stored(),key=`ynx.wallet.account.auth.v3.${account}`,original=storage.protectedValues.get(key)!;
  const record=JSON.parse(original);record.derivationPath="m/44'/60'/0'/0/1";storage.protectedValues.set(key,JSON.stringify(record));await assert.rejects(repo.accountSecret(account,guard),/Mnemonic custody/);
  storage.protectedValues.set(key,original);await assert.rejects(repo.restoreAccountMnemonic(account,PHRASE24,guard),/does not match/);assert.equal(storage.protectedValues.get(key),original);
});
test("R24 legacy raw key remains exact and cannot be fabricated into a mnemonic",async()=>{
  const s=new PublicStorage(),repo=new WalletRepository(s),secret="00".repeat(31)+"01",manifest=await repo.addAccount({secretHex:secret,label:"Legacy",createdAt:now,backupConfirmed:true});const account=manifest.accounts[0]!.account;
  assert.equal(await repo.accountSecret(account),secret);await assert.rejects(repo.accountMnemonic(account,guard),/cannot be converted/);assert.equal(JSON.parse(s.protectedValues.get(`ynx.wallet.account.auth.v3.${account}`)!).schemaVersion,3);
});
test("R24 explicit same-key recovery preserves available mnemonic and UNKNOWN outbox",async()=>{
  const {storage,repo,account}=await stored(),secret=await repo.accountSecret(account),unknown=`ynx.wallet.native-outbox.v1.${account}`;storage.publicValues.set(unknown,"PUBLIC retained UNKNOWN");
  await repo.restoreAccountSecret(account,secret,guard);assert.equal((await repo.accountMnemonic(account,guard)).phrase,PHRASE12);assert.equal(storage.publicValues.get(unknown),"PUBLIC retained UNKNOWN");
});
test("R24 phrase recovers unavailable protected key without replacing public identity",async()=>{
  const {storage,repo,account}=await stored(),publicBefore=storage.publicValues.get(MANIFEST_KEY);storage.protectedValues.clear();await repo.restoreAccountMnemonic(account,PHRASE12,guard);assert.equal(storage.publicValues.get(MANIFEST_KEY),publicBefore);assert.equal((await repo.accountMnemonic(account,guard)).phrase,PHRASE12);
});
test("R24 account removal deletes whole protected phrase envelope while preserving transaction evidence",async()=>{
  const {storage,repo,account}=await stored(),unknown=`ynx.wallet.native-outbox.v1.${account}`;storage.publicValues.set(unknown,"PUBLIC UNKNOWN retained");await repo.deleteAccount(account,guard);assert.equal(storage.protectedValues.size,0);assert.equal(storage.publicValues.get(unknown),"PUBLIC UNKNOWN retained");
});
test("R24 export rejects lost operation authority after authenticated read",async()=>{
  const {storage,repo,account}=await stored();let live=true;storage.beforeProtectedGet=()=>{live=false};await assert.rejects(repo.accountMnemonic(account,()=>{if(!live)throw Error("focus lost");}),/focus lost/);
});
test("R24 followup substituted entropy cannot retain the original signing principal",async()=>{
  const {storage,repo,account}=await stored(),key=`ynx.wallet.account.auth.v3.${account}`,record=JSON.parse(storage.protectedValues.get(key)!);record.entropyHex="01".repeat(16);storage.protectedValues.set(key,JSON.stringify(record));await assert.rejects(repo.accountSecret(account,guard),/Mnemonic custody/);
});
test("R24 followup unavailable cipher-bound adapter cannot fall back to ordinary storage",async()=>{
  const publicValues=new Map<string,string>(),storage:SecureStorageAdapter={getItem:async key=>publicValues.get(key)??null,setItem:async(key,value)=>{publicValues.set(key,value)},deleteItem:async key=>{publicValues.delete(key)}};
  await assert.rejects(new WalletRepository(storage).addMnemonicAccount(input(),guard),/OS-authenticated/);assert.equal(publicValues.size,0);
});
test("R24 followup unknown seed envelope fields are refused without modifying backups",async()=>{
  const {storage,repo,account}=await stored(),key=`ynx.wallet.account.auth.v3.${account}`,record=JSON.parse(storage.protectedValues.get(key)!);record.unapprovedPath="m/0";storage.protectedValues.set(key,JSON.stringify(record));const before=new Map(storage.protectedValues);await assert.rejects(repo.accountMnemonic(account,guard),/unknown or missing fields/);assert.deepEqual(storage.protectedValues,before);
});
test("R24 captured backup approval is not reread across custody preparation",async()=>{
  const s=new PublicStorage(),repo=new WalletRepository(s),value=input();let reads=0;Object.defineProperty(value,"backupConfirmed",{enumerable:true,get:()=>++reads===1});const manifest=await repo.addMnemonicAccount(value,guard);assert.equal(reads,1);assert.equal(manifest.accounts[0]?.backupConfirmed,true);
});
test("R24 recovery selector reads each protected legacy or phrase backup only once",async()=>{
  for(const mnemonic of [false,true]){
    const s=new PublicStorage(),repo=new WalletRepository(s);const manifest=mnemonic?await repo.addMnemonicAccount(input(),guard):await repo.addAccount({secretHex:"00".repeat(31)+"01",label:"Legacy",createdAt:now,backupConfirmed:true});let reads=0;s.beforeProtectedGet=()=>{reads++};const result=await repo.accountRecoveryMaterial(manifest.accounts[0]!.account,guard);assert.equal(result.kind,mnemonic?"mnemonic":"private-key");assert.equal(reads,1);
  }
});
