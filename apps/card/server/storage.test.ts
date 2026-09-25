import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CardStore} from './storage.ts';
import {backupCardDatabase} from './backup.ts';

const key=Buffer.alloc(32,9); // Local storage fixture only, never a Wallet key.
function fixture(t:any){const directory=mkdtempSync(join(tmpdir(),'ynx-card-storage-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return {directory,path:join(directory,'card.sqlite')}}
test('new database has explicit schema version and private filesystem mode',t=>{
  const f=fixture(t),store=new CardStore(f.path,key);store.close();
  const db=new DatabaseSync(f.path);try{assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,1)}finally{db.close()}
  assert.equal(statSync(f.path).mode&0o777,0o600);assert.equal(key[0],9);
});
test('legacy version zero upgrades without rewriting encrypted owners or global claims',t=>{
  const f=fixture(t),first=new CardStore(f.path,key);
  first.transaction('owner-a',()=>({value:0}),s=>{s.value=7;first.claim('6423','hash','owner-a','intent-a')});first.close();
  const db=new DatabaseSync(f.path);const body=db.prepare('SELECT body FROM owners').get()?.body;db.exec('PRAGMA user_version=0');db.close();
  const restored=new CardStore(f.path,key);try{
    assert.deepEqual(restored.read('owner-a',()=>null),{value:7});
    assert.throws(()=>restored.transaction('owner-b',()=>({}),()=>restored.claim('6423','hash','owner-b','other')),/TRANSACTION_ALREADY_CLAIMED/);
  }finally{restored.close()}
  const inspect=new DatabaseSync(f.path);try{assert.equal(inspect.prepare('SELECT body FROM owners').get()?.body,body);assert.equal(inspect.prepare('PRAGMA user_version').get()?.user_version,1)}finally{inspect.close()}
});
test('future database versions fail closed and retain their version',t=>{
  const f=fixture(t),db=new DatabaseSync(f.path);db.exec('PRAGMA user_version=2');db.close();
  assert.throws(()=>new CardStore(f.path,key),/Unsupported Card database version/);
  const check=new DatabaseSync(f.path);try{assert.equal(check.prepare('PRAGMA user_version').get()?.user_version,2)}finally{check.close()}
});
test('malformed legacy schema rolls back migration without marking version one',t=>{
  const f=fixture(t),db=new DatabaseSync(f.path);db.exec('CREATE TABLE owners(owner TEXT PRIMARY KEY, wrong TEXT)');db.close();
  assert.throws(()=>new CardStore(f.path,key),/Unsupported Card database schema/);
  const check=new DatabaseSync(f.path);try{assert.equal(check.prepare('PRAGMA user_version').get()?.user_version,0);assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='funding_claims'").get()?.n,0)}finally{check.close()}
});
test('live WAL backup restores encrypted owner state and cross-owner transaction deduplication',async t=>{
  const f=fixture(t),store=new CardStore(f.path,key);
  try{
    store.transaction('owner-a',()=>({marker:'private-card-ledger-marker',availableWei:'10'}),()=>store.claim('6423','funding-hash','owner-a','intent-a'));
    const result=await backupCardDatabase(f.path,f.directory);
    assert.equal(result.sqliteIntegrity,'ok');assert.equal(result.encryptionKeyIncluded,false);assert.equal(result.decryptionVerified,false);
    assert.equal(statSync(result.directory).mode&0o777,0o700);
    assert.equal(statSync(join(result.directory,'card.sqlite')).mode&0o777,0o600);
    assert.equal(readFileSync(join(result.directory,'card.sqlite')).includes(Buffer.from('private-card-ledger-marker')),false);
    const recovered=new CardStore(join(result.directory,'card.sqlite'),key);
    try{
      assert.equal(recovered.read('owner-a',()=>({availableWei:''})).availableWei,'10');
      assert.throws(()=>recovered.transaction('owner-b',()=>({}),()=>recovered.claim('6423','funding-hash','owner-b','intent-b')),/TRANSACTION_ALREADY_CLAIMED/);
      assert.deepEqual(recovered.read('owner-b',()=>({empty:true})),{empty:true});
    }finally{recovered.close()}
    const second=await backupCardDatabase(f.path,f.directory);assert.notEqual(second.directory,result.directory);
    const wrongKey=new CardStore(join(second.directory,'card.sqlite'),Buffer.alloc(32,8));
    try{assert.throws(()=>wrongKey.read('owner-a',()=>null))}finally{wrongKey.close()}
  }finally{store.close()}
});
test('failed business mutation rolls back both the owner state and global transaction claim',t=>{
  const f=fixture(t),store=new CardStore(f.path,key);
  try{
    assert.throws(()=>store.transaction('owner-a',()=>({balance:0}),s=>{s.balance=9;store.claim('6423','new-hash','owner-a','intent-a');throw Error('interrupted')}));
    assert.deepEqual(store.read('owner-a',()=>({balance:0})),{balance:0});
    assert.doesNotThrow(()=>store.transaction('owner-b',()=>({}),()=>store.claim('6423','new-hash','owner-b','intent-b')));
  }finally{store.close()}
});
