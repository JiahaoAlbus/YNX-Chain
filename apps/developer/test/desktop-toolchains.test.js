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
  assert.equal(status.model,"vscode-style-editing-extensions-plus-local-toolchain-adapters");
  assert.ok(status.adapters.length>=35,`expected a broad extensible toolchain catalog, got ${status.adapters.length}`);
  for(const id of ["c","cpp","typescript","python","java","go","rust","swift","csharp","dart","scala","haskell","fortran","powershell"]){assert.ok(status.adapters.some((item)=>item.id===id),`missing built-in ${id} adapter`);}
  const javascript=status.adapters.find((item)=>item.id==="javascript");assert.equal(javascript.available,true);assert.ok(javascript.command);
  const compile=async(source)=>{const response=await fetch(`http://127.0.0.1:${port}/runtime/task`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({task:"compile-active",activePath:"src/main.js",projectId:`js-${Math.random().toString(16).slice(2)}`,files:{"src/main.js":source}})});assert.equal(response.status,200);return response.json();};
  const passing=await compile("const answer = 42;\nconsole.log(answer);\n");assert.equal(passing.ok,true);assert.equal(passing.code,0);assert.equal(passing.language,"javascript");assert.equal(passing.network,false);assert.equal(passing.bounded,true);
  const failing=await compile("const = ;\n");assert.equal(failing.ok,false);assert.notEqual(failing.code,0);assert.match(failing.output,/SyntaxError|Unexpected token/i);
  const adapter={schemaVersion:1,id:"ynx-script",extensions:[".json"],executable:"$node",args:["--check","${file}"]};
  const denied=await fetch(`http://127.0.0.1:${port}/runtime/toolchains/register`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({adapter})});assert.equal(denied.status,403);
  const registered=await fetch(`http://127.0.0.1:${port}/runtime/toolchains/register`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approval:"register-local-toolchain-once",adapter})});assert.equal(registered.status,201);const registration=await registered.json();assert.equal(registration.adapter.custom,true);assert.equal(registration.adapter.available,true);
  const customResponse=await fetch(`http://127.0.0.1:${port}/runtime/task`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({task:"compile-active",activePath:"src/main.json",projectId:"custom-adapter",files:{"src/main.json":"const custom = true;\n"}})});assert.equal(customResponse.status,200);const custom=await customResponse.json();assert.equal(custom.ok,true);assert.equal(custom.language,"ynx-script");assert.equal(custom.toolchain.verifiedInstalled,true);
  const overrideAdapter={schemaVersion:1,id:"alternate-javascript",extensions:[".js"],executable:"$node",args:["--check","${file}"]};
  const overrideRegistration=await fetch(`http://127.0.0.1:${port}/runtime/toolchains/register`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approval:"register-local-toolchain-once",adapter:overrideAdapter})});assert.equal(overrideRegistration.status,201);
  const overridden=await compile("const overridden = true;\n");assert.equal(overridden.language,"alternate-javascript");assert.equal(overridden.ok,true);
  const refreshed=await (await fetch(`http://127.0.0.1:${port}/runtime/toolchains`)).json();assert.equal(refreshed.adapters.find((item)=>item.id==="ynx-script")?.custom,true);
  const removeDenied=await fetch(`http://127.0.0.1:${port}/runtime/toolchains/remove`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:"ynx-script"})});assert.equal(removeDenied.status,403);
  const removed=await fetch(`http://127.0.0.1:${port}/runtime/toolchains/remove`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approval:"remove-local-toolchain-once",id:"ynx-script"})});assert.equal(removed.status,200);
  const overrideRemoved=await fetch(`http://127.0.0.1:${port}/runtime/toolchains/remove`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({approval:"remove-local-toolchain-once",id:"alternate-javascript"})});assert.equal(overrideRemoved.status,200);
  const restored=await compile("const restored = true;\n");assert.equal(restored.language,"javascript");
  const afterRemoval=await (await fetch(`http://127.0.0.1:${port}/runtime/toolchains`)).json();assert.equal(afterRemoval.adapters.some((item)=>item.id==="ynx-script"),false);
});

test("macOS package linker includes the Security framework required by the Keychain bridge",async()=>{
  const native=await (await import("node:fs/promises")).readFile(`${root}/desktop/macos/main.m`,`utf8`);
  const packager=await (await import("node:fs/promises")).readFile(`${root}/scripts/package-local-macos.sh`,`utf8`);
  assert.match(packager,/-framework Cocoa -framework Security -framework WebKit/);
  assert.match(native,/YNXWalletStorageSelfTest/);
  assert.match(native,/SecItemAdd/);
  assert.match(native,/SecItemCopyMatching/);
  assert.match(native,/SecItemDelete/);
  assert.match(native,/YNXWalletAvailability/);
  assert.match(native,/URLForApplicationToOpenURL/);
  assert.match(packager,/arm64\|x86_64/);
  assert.match(packager,/platform="macos-/);
  const verifier=await (await import("node:fs/promises")).readFile(`${root}/scripts/verify-local-macos-package.sh`,`utf8`);
  assert.match(verifier,/YNX Wallet scheme state: installed=/);
});

test("Linux server appliance scripts require a protected source and verify a bounded cold start",async()=>{
  const fs=await import("node:fs/promises");
  const packager=await fs.readFile(`${root}/scripts/package-linux-server.sh`,`utf8`);
  const verifier=await fs.readFile(`${root}/scripts/verify-linux-server-package.sh`,`utf8`);
  assert.match(packager,/YNX_DEVELOPER_EXPECTED_SOURCE_COMMIT/);
  assert.match(packager,/YNX_DEVELOPER_PROTECTED_EVIDENCE_DIR/);
  assert.match(packager,/evidence-sha256\.txt/);
  assert.match(packager,/Linux x86_64 is required/);
  assert.match(packager,/workspaceState:false/);
  assert.match(packager,/operatorEnvironment:false/);
  assert.match(verifier,/cold start/);
  assert.match(verifier,/sandboxReady/);
  assert.match(verifier,/curl --fail/);
});
