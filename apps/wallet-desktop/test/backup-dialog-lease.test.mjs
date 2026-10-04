import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as fs from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import {DesktopKeyLifecycle} from "../src/key-lifecycle.mjs";
const source=readFileSync(new URL("../src/main.mjs",import.meta.url),"utf8"),start=source.indexOf('handleWalletIPC("wallet:save-backup"'),end=source.indexOf('handleWalletIPC("wallet:create-account"',start);
assert.ok(start>=0&&end>start);
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes});return{promise,resolve}};
const account="0x"+"11".repeat(20),other="0x"+"22".repeat(20);
for(const boundary of ["owned-transient-blur","screen-lock","account-switch","TTL"])test(`actual main backup handler's original ALS lease across ${boundary} cannot borrow a new account/unlock`,async t=>{
  const directory=await fs.mkdtemp(join(tmpdir(),"ynx-backup-dialog-lease-"));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  let now=0,writes=0,handler;const entered=deferred(),release=deferred(),filePath=join(directory,"backup.json");
  const life=new DesktopKeyLifecycle({now:()=>now,authorizer:{available:()=>true,authenticate:async()=>{},method:"fixture-no-key-custody"}});
  life.setFocused(true);life.setAccount(account);await life.unlock();t.after(()=>life.lock());
  const context={mainWindow:{},keyAccess:life,handleWalletIPC:(name,fn)=>{assert.equal(name,"wallet:save-backup");handler=fn},sensitiveIPC:operation=>life.run(operation),
    walletAuthority:{accountStatus:async()=>({initialized:true,account}),vault:{encryptedBackup:async()=>{life.current().assert();return"known synthetic ciphertext, not a Wallet key"}}},
    dialog:{showSaveDialog:async()=>{life.setFocused(false);entered.resolve();await release.promise;life.setFocused(true);return{canceled:false,filePath}}},
    writeFile:async(...args)=>{writes++;return fs.writeFile(...args)}};
  runInNewContext(source.slice(start,end),context);
  const saving=handler(null,"fictional backup password").then(value=>({value}),error=>({error}));await entered.promise;
  if(boundary==="screen-lock")life.lock();if(boundary==="account-switch")life.setAccount(other);if(boundary==="TTL")now=120_001;
  if(boundary==="screen-lock"||boundary==="account-switch")await assert.rejects(life.unlock(),error=>error.data.code==="WALLET_OPERATION_BUSY");
  release.resolve();const result=await saving;
  if(boundary==="owned-transient-blur"){
    assert.deepEqual(JSON.parse(JSON.stringify(result.value)),{saved:true,account});assert.equal(writes,1);
    assert.equal(await fs.readFile(filePath,"utf8"),"known synthetic ciphertext, not a Wallet key");
    if(process.platform!=="win32")assert.equal((await fs.stat(filePath)).mode&0o777,0o600);
  }else{
    assert.equal(result.error?.data?.code,"WALLET_OPERATION_CANCELLED");assert.equal(writes,0);
    await assert.rejects(fs.stat(filePath),error=>error.code==="ENOENT");
  }
});
