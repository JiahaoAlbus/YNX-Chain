import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {FilePermissionStore} from '../src/desktop-permission-store.mjs';
import {DesktopWalletAuthority} from '../src/desktop-wallet-authority.mjs';

const local='ynx-wallet:local-pq',account='0x'+'11'.repeat(20);
const invalid=e=>e?.data?.code==='PERMISSION_STORE_INVALID';
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ynx-local-permission-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const file=path.join(directory,'permissions.json');
  return {directory,file,store:new FilePermissionStore(file)};
}

test('real file-store local preview reaches its original source gate without granting or writing a website permission',async t=>{
  const f=await fixture(t);let keyCalls=0;
  const vault={authorization:{current:()=>({account,assert(){}})},withPQKeys:async()=>{keyCalls++;throw Error('No key entry');}};
  const authority=new DesktopWalletAuthority({vault,permissions:f.store});
  await assert.rejects(authority.previewTransfer({to:'0x'+'22'.repeat(20),amount:'1'}),e=>e?.data?.code==='PQ_AUTHORIZATION_SOURCE_NOT_SUPPLIED');
  assert.equal(keyCalls,0);assert.equal(authority.pending.size,0);
  assert.deepEqual(await fs.readdir(f.directory),[]);
});

test('only the exact Main cancellation domain is accepted; local leases never become persisted account grants',async t=>{
  const f=await fixture(t);f.store.authorizationLease(local).assert();
  for(const origin of ['ynx-wallet:local-pq/','ynx-wallet:foreign','http://dapp.test','file:///wallet','https://dapp.test/path'])assert.throws(()=>f.store.authorizationLease(origin),invalid);
  for(const run of [()=>f.store.grantAccount(local,account,new Date().toISOString()),()=>f.store.hasAccount(local,account),()=>f.store.list(local),()=>f.store.revoke(local)])await assert.rejects(run(),invalid);
  assert.deepEqual(await fs.readdir(f.directory),[]);
});

test('account-wide permission retirement invalidates local leases across real file-store instances',async t=>{
  const f=await fixture(t),old=f.store.authorizationLease(local);
  await new FilePermissionStore(f.file).revokeAll();
  assert.throws(()=>old.assert(),e=>e?.data?.code==='ACCOUNT_PERMISSION_REVOKED');
  f.store.authorizationLease(local).assert();
  assert.deepEqual(JSON.parse(await fs.readFile(f.file,'utf8')),{schemaVersion:1,origins:{}});
});

test('damaged persisted grants remain refused and unchanged, and failed retirement still invalidates local review',async t=>{
  const f=await fixture(t),bytes=Buffer.from('original malformed permission record');
  await fs.writeFile(f.file,bytes,{mode:0o600});const old=f.store.authorizationLease(local);
  await assert.rejects(f.store.hasAccount('https://dapp.test',account),invalid);
  await assert.rejects(f.store.revokeAll(),invalid);
  assert.throws(()=>old.assert(),e=>e?.data?.code==='ACCOUNT_PERMISSION_REVOKED');
  assert.deepEqual(await fs.readFile(f.file),bytes);
});
