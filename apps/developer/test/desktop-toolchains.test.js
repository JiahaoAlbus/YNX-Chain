import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const {port}=server.address();server.close(()=>resolve(port));});});
const waitFor=async(url)=>{let last;for(let attempt=0;attempt<80;attempt+=1){try{const response=await fetch(url);if(response.ok)return response;}catch(error){last=error;}await new Promise((resolve)=>setTimeout(resolve,50));}throw last||new Error("desktop runtime did not start");};

test("desktop runtime detects toolchains and returns real bounded compiler exits",async(t)=>{
  const port=await freePort();const home=await mkdtemp(path.join(os.tmpdir(),"ynx-developer-toolchains-"));
  const child=spawn(process.execPath,[`${root}/desktop/server.mjs`],{cwd:root,env:{...process.env,PORT:String(port),HOME:home},stdio:"ignore"});
  t.after(async()=>{child.kill("SIGTERM");await rm(home,{recursive:true,force:true});});
  const status=await (await waitFor(`http://127.0.0.1:${port}/runtime/toolchains`)).json();
  const javascript=status.adapters.find((item)=>item.id==="javascript");assert.equal(javascript.available,true);assert.ok(javascript.command);
  const compile=async(source)=>{const response=await fetch(`http://127.0.0.1:${port}/runtime/task`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({task:"compile-active",activePath:"src/main.js",projectId:`js-${Math.random().toString(16).slice(2)}`,files:{"src/main.js":source}})});assert.equal(response.status,200);return response.json();};
  const passing=await compile("const answer = 42;\nconsole.log(answer);\n");assert.equal(passing.ok,true);assert.equal(passing.code,0);assert.equal(passing.language,"javascript");assert.equal(passing.network,false);assert.equal(passing.bounded,true);
  const failing=await compile("const = ;\n");assert.equal(failing.ok,false);assert.notEqual(failing.code,0);assert.match(failing.output,/SyntaxError|Unexpected token/i);
  const adapter={schemaVersion:1,id:"ynx-script",extensions:[".json"],executable:"$node",args:["--check","${file}"]};
  const denied=await fetch(`http://127.0.0.1:${port}/runtime/toolchains/register`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({adapter})});assert.equal(denied.status,403);
  const registered=await fetch(`http://127.0.0.1:${port}/runtime/toolchains/register`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approval:"register-local-toolchain-once",adapter})});assert.equal(registered.status,201);const registration=await registered.json();assert.equal(registration.adapter.custom,true);assert.equal(registration.adapter.available,true);
  const customResponse=await fetch(`http://127.0.0.1:${port}/runtime/task`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({task:"compile-active",activePath:"src/main.json",projectId:"custom-adapter",files:{"src/main.json":"const custom = true;\n"}})});assert.equal(customResponse.status,200);const custom=await customResponse.json();assert.equal(custom.ok,true);assert.equal(custom.language,"ynx-script");assert.equal(custom.toolchain.verifiedInstalled,true);
  const refreshed=await (await fetch(`http://127.0.0.1:${port}/runtime/toolchains`)).json();assert.equal(refreshed.adapters.find((item)=>item.id==="ynx-script")?.custom,true);
  const removeDenied=await fetch(`http://127.0.0.1:${port}/runtime/toolchains/remove`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:"ynx-script"})});assert.equal(removeDenied.status,403);
  const removed=await fetch(`http://127.0.0.1:${port}/runtime/toolchains/remove`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approval:"remove-local-toolchain-once",id:"ynx-script"})});assert.equal(removed.status,200);
  const afterRemoval=await (await fetch(`http://127.0.0.1:${port}/runtime/toolchains`)).json();assert.equal(afterRemoval.adapters.some((item)=>item.id==="ynx-script"),false);
});
