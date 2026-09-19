import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtemp,mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {buildPackage,PACKAGE_FILES} from "./build-testnet-alias-package.mjs";

async function fixture() {
  const base=await mkdtemp(path.join(os.tmpdir(),"ynx-alias-package-test-")),root=path.join(base,"repo");
  await mkdir(root);
  const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
  git("init","-q");git("config","user.name","Isolated Fixture");git("config","user.email","fixture@example.invalid");
  for(const file of PACKAGE_FILES) {await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),"synthetic package input\n");}
  git("add",".");git("commit","-qm","fixture");
  return {root,output:path.join(base,"package"),sourceCommit:git("rev-parse","HEAD")};
}
test("exact-source additive package has checksums and never promotes release",async()=>{
  const options=await fixture();const {manifest}=await buildPackage(options);
  assert.equal(manifest.files.length,5);assert.equal(manifest.artifacts.length,0);
  for(const key of ["mainnetEnabled","publicDeployed","publicVerified","dnsChangeAuthorized","consumerActivationAllowed","rollbackReady"]) assert.equal(manifest[key],false);
  const sums=await readFile(path.join(options.output,"SHA256SUMS"),"utf8");assert.equal(sums.trim().split("\n").length,6);
  await assert.rejects(buildPackage(options),/new directory/);
});
test("source and output guards fail before packaging",async()=>{
  const options=await fixture();
  await assert.rejects(buildPackage({...options,sourceCommit:"a".repeat(40)}),/exact checkout/);
  await assert.rejects(buildPackage({...options,output:path.join(options.root,"output")}),/outside/);
  await writeFile(path.join(options.root,"untracked"),"fixture");
  await assert.rejects(buildPackage(options),/must be clean/);
});
