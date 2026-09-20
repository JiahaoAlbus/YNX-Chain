import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtemp,writeFile,rm,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createAuthorityReader} from "../scripts/build-authority.mjs";

const bytes=Buffer.from('public synthetic build authority\n'),sha=(name,value)=>createHash(name).update(value).digest("hex");
const entry={commit:"a".repeat(40),path:"release/fixture.json",blob:sha("sha1",Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])),sha256:sha("sha256",bytes),contentBase64:bytes.toString("base64")};
const contract={path:entry.path,blob:entry.blob,sha256:entry.sha256};
test("standalone authority requires exact embedded mapping and both hashes",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"ynx-build-authority-"));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,"authority.json");
  await writeFile(file,JSON.stringify({schemaVersion:1,records:[entry]}));
  const good=createAuthorityReader({repository:join(dir,"no-repository"),archiveFile:file});assert.deepEqual(good.read(entry.commit,contract),bytes);assert.deepEqual(good.finish(),{schemaVersion:1,records:[entry]});
  for(const change of [{commit:"b".repeat(40)},{path:"release/other.json"},{blob:"b".repeat(40)},{sha256:"b".repeat(64)}]){
    const altered={...entry,...change},reader=createAuthorityReader({archiveFile:file});
    assert.throws(()=>reader.read(altered.commit,{path:altered.path,blob:altered.blob,sha256:altered.sha256}),/Missing or changed|mismatch/);
  }
  assert.throws(()=>createAuthorityReader({repository:join(dir,"no-repository")}).read(entry.commit,contract));
});
test("preverified archive bytes are copied once and cannot race a later mutation",()=>{
  const raw=Buffer.from(JSON.stringify({schemaVersion:1,records:[entry]}));
  const reader=createAuthorityReader({archiveBytes:raw});
  raw.fill(0);
  assert.deepEqual(reader.read(entry.commit,contract),bytes);
  assert.deepEqual(reader.finish(),{schemaVersion:1,records:[entry]});
  assert.throws(()=>createAuthorityReader({archiveFile:"unused",archiveBytes:Buffer.alloc(0)}),/Choose one/);
});
test("archive corruption, duplicates and unused authorities never silently pass",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"ynx-build-authority-fault-"));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,"authority.json");
  for(const value of [
    {schemaVersion:2,records:[entry]}, {schemaVersion:1,records:[]}, {schemaVersion:1,records:[entry,entry]},
    {schemaVersion:1,records:[{...entry,extra:true}]}, {schemaVersion:1,records:[{...entry,path:"../escape"}]},
    {schemaVersion:1,records:[{...entry,contentBase64:entry.contentBase64+"\n"}]},
    {schemaVersion:1,records:[{...entry,blob:"b".repeat(40)}]},
    {schemaVersion:1,records:[{...entry,sha256:"b".repeat(64)}]},
    {schemaVersion:1,records:[{...entry,contentBase64:Buffer.from("tampered").toString("base64")}]},
  ]){await writeFile(file,JSON.stringify(value));assert.throws(()=>createAuthorityReader({archiveFile:file}));}
  await writeFile(file,JSON.stringify({schemaVersion:1,records:[entry,{...entry,commit:"b".repeat(40)}]}));
  const extra=createAuthorityReader({archiveFile:file});extra.read(entry.commit,contract);assert.throws(()=>extra.finish(),/unused/);
});
test("Git cross-verification skips an unavailable pinned commit but rejects reachable tampering",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"ynx-build-authority-git-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  execFileSync("git",["init","--quiet"],{cwd:dir});
  const missing=createAuthorityReader({repository:dir});
  assert.equal(missing.readIfCommitAvailable(entry.commit,contract),null);
  assert.deepEqual(missing.finish(),{schemaVersion:1,records:[]});

  await mkdir(join(dir,"release"));
  await writeFile(join(dir,entry.path),"tampered authority\n");
  execFileSync("git",["add",entry.path],{cwd:dir});
  execFileSync("git",["-c","user.name=YNX Test","-c","user.email=test@ynx.invalid","commit","--quiet","-m","fixture"],{cwd:dir});
  const reachableCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:dir,encoding:"utf8"}).trim();
  const reachable=createAuthorityReader({repository:dir});
  assert.throws(()=>reachable.readIfCommitAvailable(reachableCommit,contract),/Immutable authority mismatch/);
});
