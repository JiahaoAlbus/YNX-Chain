import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {FilePermissionStore} from "../src/desktop-permission-store.mjs";
import {DesktopWalletAuthority,APPROVAL_TTL_MS} from "../src/desktop-wallet-authority.mjs";
import {PermissionEpoch,bindPermissionGuard} from "../src/permission-lease.mjs";
const account="0x"+"11".repeat(20),origin="https://independent-permission.invalid",time="2026-10-04T00:00:00.000Z";
const denied=error=>error?.data?.code==="ACCOUNT_PERMISSION_REVOKED";
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(tmpdir(),"wallet-permission-epoch-"));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,"permissions.json"),store=new FilePermissionStore(file);
  await store.grantAccount(origin,account,time);return {file,store};
}
for(const revoke of ["authority","provider","second-instance","all"]) test(`real held permission FD cannot enter key access after ${revoke} revocation`,async t=>{
  const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers();let hold=false,paused=false,keyCalls=0;
  const io={...fs,open:async(...args)=>{const h=await fs.open(...args);return {
    stat:()=>h.stat(),writeFile:(...a)=>h.writeFile(...a),sync:()=>h.sync(),close:()=>h.close(),
    read:async o=>{if(hold&&!paused){paused=true;entered.resolve();await release.promise;}return h.read(o);}
  };}};
  const vault={status:async()=>({initialized:true,account}),withSecret:async()=>{keyCalls++;throw Error("KEY_ACCESS_SENTINEL");}};
  const authority=new DesktopWalletAuthority({vault,permissions:new FilePermissionStore(f.file,{io})});
  const review=await authority.request({origin,method:"personal_sign",params:["0x01",account]});
  hold=true;const pending=authority.approve(review.request.id).catch(error=>error);await entered.promise;
  if(revoke==="authority")await authority.revokeOrigin(origin);
  else if(revoke==="provider")await authority.request({origin,method:"wallet_revokePermissions",params:[{eth_accounts:{}}]});
  else if(revoke==="all")await f.store.revokeAll();
  else await f.store.revoke(origin);
  assert.equal(await f.store.hasAccount(origin,account),false);
  release.resolve();assert.ok(denied(await pending));assert.equal(keyCalls,0);
});
test("revoke and explicit regrant cannot resurrect a consumed old review",async t=>{
  const f=await fixture(t);let keyCalls=0;
  const authority=new DesktopWalletAuthority({vault:{status:async()=>({initialized:true,account}),withSecret:async()=>{keyCalls++;}},permissions:f.store});
  const old=await authority.request({origin,method:"personal_sign",params:["0x01",account]});
  await new FilePermissionStore(f.file).revoke(origin);await f.store.grantAccount(origin,account,time);
  await assert.rejects(authority.approve(old.request.id),denied);assert.equal(keyCalls,0);
  assert.equal(await f.store.hasAccount(origin,account),true);
  assert.equal((await authority.request({origin,method:"personal_sign",params:["0x01",account]})).status,"approval-required");
});
test("revocation during the actual vault callback prevents signing even if a vault awaited after entry",async t=>{
  const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers();let signCalls=0;
  const vault={status:async()=>({initialized:true,account}),withSecret:async(action,lease)=>{entered.resolve();await release.promise;lease.assert();signCalls++;return action("not-a-key",{account});}};
  const authority=new DesktopWalletAuthority({vault,permissions:f.store});
  const review=await authority.request({origin,method:"personal_sign",params:["0x01",account]});
  const pending=authority.approve(review.request.id).catch(error=>error);await entered.promise;
  await f.store.revoke(origin);release.resolve();assert.ok(denied(await pending));assert.equal(signCalls,0);
});
test("queued old connect approval cannot grant permission after revocation",async t=>{
  const f=await fixture(t),lease=f.store.authorizationLease(origin);
  await f.store.revoke(origin);await assert.rejects(f.store.grantAccount(origin,account,time,lease),denied);
  assert.equal(await f.store.hasAccount(origin,account),false);
});
test("failed revocation invalidates old leases without erasing existing records",async t=>{
  const f=await fixture(t),lease=f.store.authorizationLease(origin),bytes=await fs.readFile(f.file);
  const store=new FilePermissionStore(f.file,{io:{...fs,open:async()=>{throw Error("read failed");}}});
  await assert.rejects(store.revoke(origin));assert.throws(()=>lease.assert(),denied);
  assert.deepEqual(await fs.readFile(f.file),bytes);
});
test("composed guard blocks late signing steps and outward effects, retaining original effect lifecycle",async()=>{
  const epoch=new PermissionEpoch(),permission=epoch.lease(origin),entered=Promise.withResolvers(),release=Promise.withResolvers();let submits=0;
  const original={account,step:async action=>action(),submit:async action=>{submits++;return action();}};
  const guard=bindPermissionGuard(original,permission);
  const pending=guard.step(async()=>{entered.resolve();await release.promise;return "old result";}).catch(error=>error);
  await entered.promise;await epoch.revoke(origin,async()=>{});release.resolve();assert.ok(denied(await pending));
  assert.throws(()=>guard.submit(()=>"never delivered"),denied);assert.equal(submits,0);
});
test("unrelated origin remains usable after revocation and process epochs do not alter serialized schema",async t=>{
  const f=await fixture(t),other="https://other.invalid";
  await f.store.grantAccount(other,account,time);const lease=f.store.authorizationLease(other);
  await f.store.revoke(origin);lease.assert();assert.equal(await f.store.hasAccount(other,account),true);
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(f.file,"utf8"))).sort(),["origins","schemaVersion"]);
});
for(const stop of ["transport-expire","cancel-all","review-deadline"])test(`taken review remains cancellable at key callback by ${stop}`,async t=>{
  const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers();let now=Date.parse(time),signCalls=0;
  const vault={status:async()=>({initialized:true,account}),withSecret:async(action,lease)=>{entered.resolve();await release.promise;lease.assert();signCalls++;return action("not-a-key",{account});}};
  const authority=new DesktopWalletAuthority({vault,permissions:f.store,clock:()=>new Date(now)});
  const review=await authority.request({origin,method:"personal_sign",params:["0x01",account]});
  const pending=authority.approve(review.request.id).catch(error=>error);await entered.promise;
  if(stop==="transport-expire"){assert.equal(authority.expire(review.request.id),true);assert.equal(authority.expire(review.request.id),false);}
  else if(stop==="cancel-all")authority.cancelAll();else now+=APPROVAL_TTL_MS;
  release.resolve();const result=await pending;assert.equal(result?.data?.code,stop==="review-deadline"?"REQUEST_EXPIRED":"UNKNOWN_OR_EXPIRED_REQUEST");
  assert.equal(signCalls,0);assert.equal(await f.store.hasAccount(origin,account),true);
});
