import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";

test("Windows-style Git checkout preserves exact protocol and registry bytes with autocrlf enabled",async()=>{
  const repository=fileURLToPath(new URL("../../../",import.meta.url));
  const paths=["packages/wallet-auth/src/product-session-v2.js","packages/wallet-auth/product-session-registry.json"];
  const directory=await mkdtemp(join(tmpdir(),"ynx-authority-checkout-"));
  const git=args=>execFileSync("git",args,{cwd:directory,stdio:["ignore","pipe","pipe"]});
  try{
    git(["init","--quiet"]);git(["config","core.autocrlf","true"]);
    await writeFile(join(directory,".gitattributes"),await readFile(join(repository,".gitattributes")));
    const originals=new Map();
    for(const path of paths){const bytes=await readFile(join(repository,path));originals.set(path,bytes);await mkdir(dirname(join(directory,path)),{recursive:true});await writeFile(join(directory,path),bytes)}
    await writeFile(join(directory,"unprotected-control.js"),"// control\n// CRLF conversion must actually occur\n");
    git(["add","--",".gitattributes",...paths,"unprotected-control.js"]);
    for(const path of [...paths,"unprotected-control.js"])await rm(join(directory,path));
    git(["checkout-index","--all","--force"]);
    for(const path of paths){const actual=await readFile(join(directory,path));assert.deepEqual(actual,originals.get(path),`${path} must retain exact authority bytes`);assert.ok(!actual.includes(Buffer.from("\r\n")))}
    assert.ok((await readFile(join(directory,"unprotected-control.js"))).includes(Buffer.from("\r\n")),"the unprotected control confirms autocrlf conversion was exercised");
  }finally{await rm(directory,{recursive:true,force:true})}
});
