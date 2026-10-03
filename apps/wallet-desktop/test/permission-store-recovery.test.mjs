import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {FilePermissionStore} from "../src/desktop-permission-store.mjs";
import {DesktopWalletAuthority} from "../src/desktop-wallet-authority.mjs";

const origin="https://permission-fixture.test",account="0x"+"11".repeat(20),other="0x"+"22".repeat(20),time="2026-10-03T00:00:00.000Z";
const record=()=>({parentCapability:"eth_accounts",accounts:[account],approvedAt:time});
const state=()=>({schemaVersion:1,origins:{[origin]:record()}});
const denied=error=>error?.data?.code==="PERMISSION_STORE_INVALID"&&!error.message.includes("PRIVATE_PATH");
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),"ynx-permission-recovery-"));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const filePath=path.join(directory,"wallet-permissions-v1.json");return{directory,filePath,store:new FilePermissionStore(filePath),write:value=>fs.writeFile(filePath,JSON.stringify(value),{mode:0o600})}}

test("a stored substring account is not an exact previous origin approval",async t=>{
  const f=await fixture(t),data=state();data.origins[origin].accounts="prefix"+account+"suffix";await f.write(data);
  const before=await fs.readFile(f.filePath);
  await assert.rejects(f.store.hasAccount(origin,account),denied);assert.deepEqual(await fs.readFile(f.filePath),before);
});
test("every nested permission and top-level schema is verified before any origin is trusted",async t=>{
  const f=await fixture(t);
  for(const change of [r=>r.accounts=[],r=>r.accounts=[account,other],r=>r.accounts=[account.toUpperCase()],r=>r.parentCapability="personal_sign",r=>r.approvedAt="bad-date",r=>r.extra=true]){
    const data=state();data.origins["https://another-fixture.test"]=record();change(data.origins["https://another-fixture.test"]);await f.write(data);
    await assert.rejects(f.store.hasAccount(origin,account),denied);
  }
  for(const key of ["http://insecure.test","https://permission-fixture.test/path","__proto__"]){const data=state();Object.defineProperty(data.origins,key,{value:record(),enumerable:true});await f.write(data);await assert.rejects(f.store.list(origin),denied)}
});
test("ordinary schema1 permissions retain exact accounts and immutable public lists across restart",async t=>{
  const f=await fixture(t);assert.equal(await f.store.hasAccount(origin,account),false);
  await f.store.grantAccount(origin,account,time);await f.store.grantAccount("https://another-fixture.test",other,time);
  const reopened=new FilePermissionStore(f.filePath);assert.equal(await reopened.hasAccount(origin,account),true);assert.equal(await reopened.hasAccount(origin,other),false);
  const listed=await reopened.list(origin);assert.deepEqual(listed,[record()]);assert.ok(Object.isFrozen(listed[0].accounts));
  await reopened.revoke(origin);assert.equal(await reopened.hasAccount(origin,account),false);assert.equal(await reopened.hasAccount("https://another-fixture.test",other),true);
  await reopened.revokeAll();assert.deepEqual(await reopened.list("https://another-fixture.test"),[]);
});
test("concurrent same-file store instances preserve all grants without a shared temporary-file collision",async t=>{
  const f=await fixture(t),second=new FilePermissionStore(f.filePath);
  const origins=Array.from({length:8},(_,index)=>`https://permission-${index}.test`);
  const results=await Promise.allSettled(origins.map((value,index)=>(index%2?f.store:second).grantAccount(value,account,time)));
  assert.ok(results.every(value=>value.status==="fulfilled"));
  for(const value of origins)assert.equal(await second.hasAccount(value,account),true);
  assert.deepEqual((await fs.readdir(f.directory)).sort(),["wallet-permissions-v1.json"]);
});
test("a pending grant completes before a later revokeAll and cannot resurrect an old permission",async t=>{
  const f=await fixture(t);await f.store.grantAccount(origin,account,time);
  const entered=Promise.withResolvers(),release=Promise.withResolvers();let blocked=true;
  const {PrivateFilePolicy}=await import("../src/platform-private-file.mjs");const original=new PrivateFilePolicy();
  const policy={available:(...args)=>original.available(...args),directory:(...args)=>original.directory(...args),protect:(...args)=>original.protect(...args),assertPrivate:(...args)=>original.assertPrivate(...args),replace:async(...args)=>{if(blocked){blocked=false;entered.resolve();await release.promise}return original.replace(...args)}};
  const guarded=new FilePermissionStore(f.filePath,{filePolicy:policy});assert.equal(guarded.filePolicy,policy);
  const grant=guarded.grantAccount(origin,account,time);await entered.promise;
  const revoke=new FilePermissionStore(f.filePath).revokeAll();release.resolve();await Promise.all([grant,revoke]);
  assert.equal(await f.store.hasAccount(origin,account),false);
});
test("oversized valid JSON permission files are refused without clearing original authority records",async t=>{
  const f=await fixture(t),text=JSON.stringify(state())+" ".repeat(1_048_576);await fs.writeFile(f.filePath,text,{mode:0o600});
  await assert.rejects(f.store.hasAccount(origin,account),denied);assert.equal(await fs.readFile(f.filePath,"utf8"),text);
});
test("same-inode growth after fstat is read-bounded and cannot become an accepted permission",async t=>{
  const f=await fixture(t);await f.write(state());let bulk=0,requested=0,closed=0;
  const io={...fs,open:async(...args)=>{const handle=await fs.open(...args);return{stat:async()=>{const stat=await handle.stat();await fs.appendFile(f.filePath," ".repeat(1_048_576));return stat},read:async options=>{requested+=options.length;return handle.read(options)},readFile:async()=>{bulk++;return handle.readFile("utf8")},close:async()=>{closed++;await handle.close()}}}};
  const store=new FilePermissionStore(f.filePath,{io});assert.equal(store.io,io);await assert.rejects(store.hasAccount(origin,account),denied);
  assert.equal(requested,1_048_577);assert.equal(bulk,0);assert.equal(closed,1);assert.ok((await fs.stat(f.filePath)).size>1_048_576);
});
test("post-open absence and close failures remain refusals, not a new empty permission store",async()=>{
  const text=Buffer.from(JSON.stringify(state())),policy={available:async()=>{},assertPrivate:async()=>{}};
  for(const phase of ["stat","read","close"]){let closed=0;const missing=()=>{throw Object.assign(Error("PRIVATE_PATH"),{code:"ENOENT"})};
    const io={open:async()=>({stat:async()=>phase==="stat"?missing():{isFile:()=>true,size:text.length},read:async({buffer,offset,length,position})=>{if(phase==="read")missing();const size=Math.min(length,Math.max(0,text.length-position));text.copy(buffer,offset,position,position+size);return{bytesRead:size}},close:async()=>{closed++;if(phase==="close")missing()}})};
    const store=new FilePermissionStore("/controlled/permission.json",{io,filePolicy:policy});assert.equal(store.io,io);await assert.rejects(store.hasAccount(origin,account),denied);assert.equal(closed,1);
  }
});
test("unverifiable existing permissions cannot be silently replaced by grant, revoke or account-switch revocation",async t=>{
  const f=await fixture(t);await fs.writeFile(f.filePath,"unreadable-json-fixture",{mode:0o600});const before=await fs.readFile(f.filePath);
  for(const action of [()=>f.store.grantAccount(origin,account,time),()=>f.store.revoke(origin),()=>f.store.revokeAll()]){await assert.rejects(action(),denied);assert.deepEqual(await fs.readFile(f.filePath),before)}
});
test("actual Desktop authority cannot expose or prepare a signature using a malformed previous permission",async t=>{
  const f=await fixture(t),data=state();data.origins[origin].accounts="prefix"+account;await f.write(data);let keyCalls=0;
  const vault={status:async()=>({initialized:true,account}),withSecret:async()=>{keyCalls++;throw Error("never access a key")}};
  const authority=new DesktopWalletAuthority({vault,permissions:f.store});
  for(const method of ["eth_accounts","personal_sign"])await assert.rejects(authority.request({origin,method,params:["0x01",account]}),denied);
  assert.equal(keyCalls,0);assert.equal(authority.pending.size,0);
});
test("failed staged writes preserve original records, clean only their own temporary file and release the mutation queue",async t=>{
  const f=await fixture(t);await f.store.grantAccount(origin,account,time);const before=await fs.readFile(f.filePath);
  const io={...fs,open:async(file,...args)=>{const handle=await fs.open(file,...args);if(!String(file).endsWith(".tmp")||args[0]!=="wx")return handle;return{writeFile:async()=>{throw Error("PRIVATE_PATH")},sync:()=>handle.sync(),close:()=>handle.close()}}};
  const store=new FilePermissionStore(f.filePath,{io});assert.equal(store.io,io);
  await assert.rejects(store.grantAccount("https://failed-fixture.test",other,time),denied);
  assert.deepEqual(await fs.readFile(f.filePath),before);assert.deepEqual(await fs.readdir(f.directory),["wallet-permissions-v1.json"]);
  await f.store.grantAccount("https://later-fixture.test",other,time);
  assert.equal(await f.store.hasAccount(origin,account),true);assert.equal(await f.store.hasAccount("https://later-fixture.test",other),true);
});
test("lost staged or final publication readback never claims an account grant was saved",async t=>{
  for(const phase of ["staged","final"]){
    const f=await fixture(t);await f.store.grantAccount(origin,account,time);const before=await fs.readFile(f.filePath);
    const {PrivateFilePolicy}=await import("../src/platform-private-file.mjs");const original=new PrivateFilePolicy();
    const policy={available:(...args)=>original.available(...args),directory:(...args)=>original.directory(...args),protect:(...args)=>original.protect(...args),assertPrivate:(...args)=>original.assertPrivate(...args),replace:async()=>{}};
    const io={...fs,open:async(file,...args)=>{const handle=await fs.open(file,...args);if(phase!=="staged"||args[0]!=="wx")return handle;return{writeFile:async()=>{},sync:()=>handle.sync(),close:()=>handle.close()}}};
    const store=new FilePermissionStore(f.filePath,{io,filePolicy:policy});assert.equal(store.filePolicy,policy);
    await assert.rejects(store.grantAccount("https://lost-fixture.test",other,time),denied);
    assert.deepEqual(await fs.readFile(f.filePath),before);assert.equal(await f.store.hasAccount("https://lost-fixture.test",other),false);
    assert.deepEqual(await fs.readdir(f.directory),["wallet-permissions-v1.json"]);
  }
});
test("permission corruption after a signature review invalidates that old approval before any key access",async t=>{
  const f=await fixture(t);await f.store.grantAccount(origin,account,time);let keyCalls=0;
  const vault={status:async()=>({initialized:true,account}),withSecret:async()=>{keyCalls++;throw Error("never access a key")}};
  const authority=new DesktopWalletAuthority({vault,permissions:f.store});
  const review=await authority.request({origin,method:"personal_sign",params:["0x01",account]});
  assert.equal(review.status,"approval-required");await fs.writeFile(f.filePath,"corrupt-retained-record",{mode:0o600});
  await assert.rejects(authority.approve(review.request.id),denied);assert.equal(keyCalls,0);assert.equal(authority.pending.size,0);
  assert.equal(await fs.readFile(f.filePath,"utf8"),"corrupt-retained-record");
});
test("failed permission revocation cancels old reviews but never changes, imports or replaces an existing account",async t=>{
  const f=await fixture(t);await fs.writeFile(f.filePath,"corrupt-retained-record",{mode:0o600});let accountChanges=0;
  const vault={selectAccount:async()=>{accountChanges++},importAccount:async()=>{accountChanges++},addAccountAndSelect:async()=>{accountChanges++}};
  const authority=new DesktopWalletAuthority({vault,permissions:f.store});
  for(const change of [()=>authority.selectAccount(other),()=>authority.importAccount({}),()=>authority.addAccountAndSelect()]){
    authority.pending.set("old-review",{});await assert.rejects(change(),denied);assert.equal(authority.pending.size,0);
    assert.equal(accountChanges,0);assert.equal(await fs.readFile(f.filePath,"utf8"),"corrupt-retained-record");
  }
});
