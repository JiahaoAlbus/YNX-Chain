import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FilePermissionStore} from '../src/desktop-permission-store.mjs';
import {PrivateFilePolicy} from '../src/platform-private-file.mjs';
import {DesktopWalletAuthority} from '../src/desktop-wallet-authority.mjs';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
const account='0x'+'11'.repeat(20),origin='https://independent-permission.invalid',time='2026-10-04T00:00:00.000Z';
async function fixture(t){const dir=await fs.mkdtemp(fileURLToPath(new URL('./qa-private-',import.meta.url)));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return{dir,file:path.join(dir,'permissions.json')}}
const denied=e=>e?.data?.code==='PERMISSION_STORE_INVALID';
test('actual inode replacement between fstat and policy binding refuses and closes the original descriptor',async t=>{
 const f=await fixture(t),store=new FilePermissionStore(f.file);await store.grantAccount(origin,account,time);let closed=0;
 const replacement=JSON.stringify({schemaVersion:1,origins:{}})+'\n';
 const io={...fs,open:async(...args)=>{const h=await fs.open(...args);return{stat:async()=>{const s=await h.stat();const n=path.join(f.dir,'replacement');await fs.writeFile(n,replacement,{mode:0o600});await fs.rename(n,f.file);return s},read:o=>h.read(o),close:async()=>{closed++;await h.close()}}}};
 await assert.rejects(new FilePermissionStore(f.file,{io}).hasAccount(origin,account),denied);assert.equal(closed,1);assert.equal(await fs.readFile(f.file,'utf8'),replacement);
});
test('real post-publication failure reports refusal while preserving published bytes rather than claiming rollback',async t=>{
 const f=await fixture(t),store=new FilePermissionStore(f.file);await store.grantAccount(origin,account,time);
 const p=new PrivateFilePolicy(),policy={available:(...a)=>p.available(...a),directory:(...a)=>p.directory(...a),protect:(...a)=>p.protect(...a),assertPrivate:(...a)=>p.assertPrivate(...a),replace:async(...a)=>{await p.replace(...a);throw Error('publication-return-lost')}};
 await assert.rejects(new FilePermissionStore(f.file,{filePolicy:policy}).grantAccount('https://second.invalid',account,time),denied);
 assert.equal(await store.hasAccount('https://second.invalid',account),true);assert.deepEqual(await fs.readdir(f.dir),['permissions.json']);
});
test('a completed same-process origin revocation prevents late approval from entering key access',async t=>{
 const f=await fixture(t),store=new FilePermissionStore(f.file);await store.grantAccount(origin,account,time);
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let hold=false,paused=false,keyCalls=0;
 const io={...fs,open:async(...args)=>{const h=await fs.open(...args);return{stat:()=>h.stat(),writeFile:(...a)=>h.writeFile(...a),sync:()=>h.sync(),read:async o=>{if(hold&&!paused){paused=true;entered.resolve();await release.promise}return h.read(o)},close:()=>h.close()}}};
 // A key-access sentinel throws immediately: no key, Wallet profile, signature or transaction exists.
 // Actual lifecycle/AsyncLocalStorage lease, with controlled availability only; no OS authorization claim.
 const lifecycle=new DesktopKeyLifecycle({focused:()=>true,authorizer:{available:()=>true,authenticate:async()=>{},method:'controlled-only'}});
 lifecycle.setAccount(account);await lifecycle.unlock();t.after(()=>lifecycle.lock());
 const vault={authorization:lifecycle,status:async()=>({initialized:true,account}),withSecret:async()=>{lifecycle.current().assert();keyCalls++;throw Object.assign(Error('KEY_ACCESS_SENTINEL'),{code:'KEY_ACCESS_SENTINEL'})}};
 const authority=new DesktopWalletAuthority({vault,permissions:new FilePermissionStore(f.file,{io})});
 const review=await lifecycle.run(()=>authority.request({origin,method:'personal_sign',params:['0x01',account]}));
 hold=true;const pending=lifecycle.run(()=>authority.approve(review.request.id)).catch(e=>e);await entered.promise;
 await authority.revokeOrigin(origin);assert.equal(await store.hasAccount(origin,account),false);
 release.resolve();const result=await pending;
 console.log(JSON.stringify({revocationCompletedBeforeReadRelease:true,keyCalls,resultCode:result?.code,permissionOnDisk:await store.hasAccount(origin,account)}));
 assert.equal(keyCalls,0,'late approval reached key access after revocation completed');
});
