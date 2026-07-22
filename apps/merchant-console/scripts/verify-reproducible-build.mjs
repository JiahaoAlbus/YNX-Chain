import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const repoRoot=resolve(appRoot,"../..");
const sourceCommit=process.argv[2]??"";
if(!/^[0-9a-f]{40}$/.test(sourceCommit))throw new Error("exact 40-character source commit is required");
const head=execFileSync("git",["rev-parse","HEAD"],{cwd:repoRoot,encoding:"utf8"}).trim();
if(head!==sourceCommit)throw new Error(`source commit mismatch: HEAD is ${head}`);
const dirty=execFileSync("git",["status","--porcelain","--untracked-files=no"],{cwd:repoRoot,encoding:"utf8"}).trim();
if(dirty)throw new Error("tracked worktree changes must be committed before reproducibility verification");
const files=["a11y.css","app.js","index.html","manifest.webmanifest","runtime-config.js","styles.css"];
const build=async()=>{
  execFileSync(process.execPath,[resolve(appRoot,"scripts/build.mjs")],{cwd:appRoot,stdio:"ignore"});
  const result={};for(const file of files){const raw=await readFile(resolve(appRoot,"dist",file));result[file]={sha256:createHash("sha256").update(raw).digest("hex"),bytes:raw.byteLength}}
  return result;
};
const first=await build();const second=await build();
if(JSON.stringify(first)!==JSON.stringify(second))throw new Error("production bundle is not byte-reproducible across two clean build executions");
const evidence={schemaVersion:1,classification:"local-unsigned-reproducible-build-check",sourceCommit,buildCommand:"node scripts/build.mjs",runs:2,artifacts:second,byteIdentical:true,limitations:["Local darwin/arm64 process; not an independent builder or signed provenance.","Dependency cache and operating system were shared between both runs."]};
const output=resolve(appRoot,"evidence/reproducible-build.json");await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(evidence,null,2)+"\n");
console.log(`production bundle reproduced across two runs for ${sourceCommit}`);
