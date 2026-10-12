import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
const exec = promisify(execFile);
test("native folder selection resolves aliases while launch rejects noncanonical paths", {skip:process.platform!=="darwin",timeout:60000},async t=>{
 const temporary=await mkdtemp(join(tmpdir(),"ynx-native-folder-boundary-"));t.after(()=>rm(temporary,{recursive:true,force:true}));const root=await realpath(temporary);
 await mkdir(join(root,"Chosen Project"));await writeFile(join(root,"file.txt"),"preserved");await symlink(join(root,"Chosen Project"),join(root,"alias"));const executable=join(root,"folder-proof");
 await exec("/usr/bin/clang",["-fobjc-arc",`-fmodules-cache-path=${root}/module-cache`,fileURLToPath(new URL("./fixtures/macos-native-folder.m",import.meta.url)),"-o",executable,"-framework","Cocoa","-framework","Security","-framework","WebKit"],{timeout:45000});
 const result=await exec(executable,[root]);assert.match(result.stdout,/boundaries PASS/);
});
