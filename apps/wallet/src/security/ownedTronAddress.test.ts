import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WalletRepository, type SecureStorageAdapter} from '../storage/walletRepository';
import {WalletOperationCancelled, WalletOperationLifecycle} from './operationLifecycle';
import {readOwnedTronAddress, type TronReceiveSelection} from './ownedTronAddress';

// Published BIP39 zero-entropy vectors only; never used with funds or OS storage.
const vectors = [
  ['00'.repeat(16), 'abandon '.repeat(11)+'about', 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH'],
  ['00'.repeat(32), 'abandon '.repeat(23)+'art', 'TEfhiqsW1SdN44DeHrAWVmbyr8ZbvChrtS'],
] as const;
const fields = {label:'Public fixture',createdAt:'2026-11-13T00:00:00.000Z',backupConfirmed:true};
const guard = () => {};
class MemoryStorage implements SecureStorageAdapter {
  values = new Map<string,string>();
  secrets = new Map<string,string>();
  onRead = () => {};
  readCount = 0;
  getItem = async (key:string) => this.values.get(key) ?? null;
  setItem = async (key:string,value:string) => { this.values.set(key,value); };
  deleteItem = async (key:string) => { this.values.delete(key); };
  assertSecretProtectionAvailable = async () => {};
  authenticatedSecrets = {
    getItem:async (key:string) => { this.readCount++; this.onRead(); return this.secrets.get(key) ?? null; },
    setItem:async (key:string,value:string) => { this.secrets.set(key,value); },
    deleteItem:async (key:string) => { this.secrets.delete(key); },
  };
}
function fixture(repository:WalletRepository,vaultAccount:string) {
  let time=0, network:TronReceiveSelection['network']='nile';
  const operations=new WalletOperationLifecycle(()=>time); operations.setAccount(vaultAccount);
  const scope=operations.scope(), unlock=scope.begin({requireUnlocked:false}); operations.unlock(unlock); unlock.finish();
  const dependencies={scope, repository, checkBiometrics:async (assertCurrent:()=>void)=>assertCurrent(),
    assertSelectionCurrent:(selection:TronReceiveSelection)=>{ if (selection.network!==network) throw new WalletOperationCancelled(); }};
  return {operations, scope, dependencies, select:(next:typeof network)=>{network=next;}, expire:()=>{time=120_000;},
    read:()=>readOwnedTronAddress(dependencies,{network,vaultAccount})};
}
async function mnemonicFixture(entropyHex:string=vectors[0][0]) {
  const storage=new MemoryStorage(), repository=new WalletRepository(storage);
  const saved=await repository.addMnemonicAccount({...fields,entropyHex},guard), vaultAccount=saved.accounts[0]!.account;
  return {storage, repository, vaultAccount, ...fixture(repository,vaultAccount)};
}
for (const [entropyHex,phrase,address] of vectors) test(`owned TRON after ${entropyHex.length===32?12:24}-word recovery matches fixed public vector`,async()=>{
  const f=await mnemonicFixture(entropyHex), before=await f.read();
  await f.repository.restoreAccountMnemonic(f.vaultAccount,phrase,guard);
  const after=await f.read();
  assert.deepEqual(after,before); assert.equal(after.address,address); assert.equal(after.path,"m/44'/195'/0'/0/0");
  assert.equal(after.vaultAccount,f.vaultAccount); assert.equal(after.networkVerified,false); assert(Object.isFrozen(after));
  assert.deepEqual(Object.keys(after).sort(),['address','family','hexAddress','index','network','networkVerified','path','vaultAccount']);
  f.select('shasta'); assert.deepEqual(await f.read(),{...after,network:'shasta'});
});
test('legacy raw-key account refuses recovery phrase and stays unmodified',async()=>{
  const storage=new MemoryStorage(), repository=new WalletRepository(storage);
  const saved=await repository.addAccount({...fields,secretHex:'0'.repeat(63)+'1'},guard);
  const f=fixture(repository,saved.accounts[0]!.account), original=[...storage.secrets];
  await assert.rejects(f.read(),/private-key backup/);
  assert.deepEqual([...storage.secrets],original);
});
test('locked account fails before biometrics or protected read',async()=>{
  const f=await mnemonicFixture(), before=f.storage.readCount; let checks=0;
  f.dependencies.checkBiometrics=async()=>{checks++;}; f.operations.lock();
  await assert.rejects(f.read(),WalletOperationCancelled); assert.equal(checks,0); assert.equal(f.storage.readCount,before);
});
for (const event of ['lock','background','account','close','network','expiry'] as const) test(`${event} during protected read prevents address projection`,async()=>{
  const f=await mnemonicFixture();
  f.storage.onRead=()=>{
    if(event==='lock')f.operations.lock(); else if(event==='background')f.operations.setAppState('background');
    else if(event==='account')f.operations.setAccount('PUBLIC successor'); else if(event==='close')f.scope.cancel();
    else if(event==='network')f.select('mainnet'); else f.expire();
  };
  await assert.rejects(f.read(),WalletOperationCancelled);
});
test('post-derivation fence rejects changed selection and releases same scope',async()=>{
  const f=await mnemonicFixture(); let reads=0, afterRead=0;
  const read=f.repository.accountMnemonic.bind(f.repository);
  f.repository.accountMnemonic=async(...args)=>{ const result=await read(...args); reads++; return result; };
  f.dependencies.assertSelectionCurrent=()=>{ if(reads && ++afterRead===2)throw new WalletOperationCancelled(); };
  await assert.rejects(f.read(),WalletOperationCancelled); assert.equal(reads,1);
  f.dependencies.assertSelectionCurrent=guard; assert.equal((await f.read()).address,vectors[0][2]);
});
test('biometric failure stays the first error and never opens protected storage',async()=>{
  const f=await mnemonicFixture(), reads=f.storage.readCount, first=new Error('Public biometric refusal');
  f.dependencies.checkBiometrics=async()=>{throw first;};
  await assert.rejects(f.read(),error=>error===first);
  assert.equal(f.storage.readCount,reads);
});
test('mismatched repository account or entropy cannot publish a public address',async()=>{
  const f=await mnemonicFixture(), read=f.repository.accountMnemonic.bind(f.repository);
  f.repository.accountMnemonic=async(...args)=>({...await read(...args),account:'PUBLIC successor'});
  await assert.rejects(f.read(),{code:'TRON_RECEIVE_ACCOUNT_CHANGED'});
  f.repository.accountMnemonic=async(...args)=>({...await read(...args),entropyHex:'ff'.repeat(16)});
  await assert.rejects(f.read(),{code:'TRON_RECEIVE_MNEMONIC_INVALID'});
});
