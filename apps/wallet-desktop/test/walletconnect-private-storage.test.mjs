import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, stat, chmod, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createPrivateWalletConnectStorage } from "../src/walletconnect-private-storage.mjs";

test("the real locked SDK store survives a new process and remains confined to its private profile", async t => {
  const directory=await mkdtemp(path.join(tmpdir(),"ynx-wc-private-qa-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const database=path.join(directory,"walletconnect.db"),storage=await createPrivateWalletConnectStorage(database);
  await storage.setItem("ynx-public-fixture",{value:"public-qa-only"});
  const module=new URL("../src/walletconnect-private-storage.mjs",import.meta.url).href;
  const script=`import {createPrivateWalletConnectStorage} from ${JSON.stringify(module)};const s=await createPrivateWalletConnectStorage(${JSON.stringify(database)});console.log(JSON.stringify({restored:(await s.getItem("ynx-public-fixture"))?.value==="public-qa-only"}));`;
  const {stdout}=await promisify(execFile)(process.execPath,["--input-type=module","-e",script]);
  assert.equal(JSON.parse(stdout).restored,true);
  assert.equal((await stat(database)).isDirectory(),true);
  if(process.platform!=="win32")for(const file of await readdir(database))assert.equal((await stat(path.join(database,file))).mode&0o077,0);
  const other=await createPrivateWalletConnectStorage(path.join(directory,"other-profile"));
  assert.equal(await other.getItem("ynx-public-fixture"),undefined);
  await storage.removeItem("ynx-public-fixture");
  assert.equal(await storage.getItem("ynx-public-fixture"),undefined);
});

test("an unsafe storage identity is retained and rejected instead of reset", async t => {
  const directory=await mkdtemp(path.join(tmpdir(),"ynx-wc-identity-qa-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const database=path.join(directory,"walletconnect.db"),storage=await createPrivateWalletConnectStorage(database);
  await storage.setItem("ynx-public-fixture",{value:"retained"});
  if(process.platform!=="win32"){
    const record=path.join(database,(await readdir(database))[0]);
    await chmod(record,0o644);
    await assert.rejects(createPrivateWalletConnectStorage(database));
    await chmod(record,0o600);
    assert.equal((await storage.getItem("ynx-public-fixture")).value,"retained");
    const linked=path.join(directory,"linked.db");await symlink(database,linked);
    await assert.rejects(createPrivateWalletConnectStorage(linked));
  }
});
