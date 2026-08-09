import assert from "node:assert/strict";
import WebSocket from "ws";

const base=process.env.YNX_CODE_CHECK_BASE||"http://127.0.0.1:4204",projectId="cloud-language-gate";
const health=await fetch(`${base}/runtime/health`),cookie=health.headers.get("set-cookie")?.split(";")[0];
assert.equal(health.status,200);assert.ok(cookie,"Gateway did not issue a signed workspace session.");
const request=async(path,options={})=>{const response=await fetch(`${base}${path}`,{...options,headers:{cookie,...(options.body?{"content-type":"application/json"}:{}),...options.headers}}),value=await response.json();if(!response.ok)throw new Error(`${path}: ${JSON.stringify(value)}`);return value};
const created=await request("/runtime/profiles/lxd/leases",{
  method:"POST",
  body:JSON.stringify({protocolVersion:"ynx-code-runtime/v1",approval:"create-container-once",projectId,image:"ubuntu-24.04"}),
});
const runtimeId=created.runtime.runtimeId;
try{
  assert.match(created.runtime.evidence.imageFingerprint,/^[a-f0-9]{64}$/);assert.equal(created.runtime.evidence.network,"disabled");
  const cases=[
    ["src/main.cpp",'#include <iostream>\nint main(){std::cout<<"GATE_CPP_OK";}',"GATE_CPP_OK"],
    ["src/main.js",'console.log("GATE_JS_OK")',"GATE_JS_OK"],
    ["src/main.ts",'const value: number=42; console.log("GATE_TS_OK",value)',"GATE_TS_OK"],
    ["src/main.py",'print("GATE_PY_OK")',"GATE_PY_OK"],
    ["src/main.go",'package main\nimport "fmt"\nfunc main(){fmt.Print("GATE_GO_OK")}',"GATE_GO_OK"],
    ["src/main.rs",'fn main(){println!("GATE_RUST_OK");}',"GATE_RUST_OK"],
    ["contracts/Gate.sol",'// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20; contract Gate { function ok() external pure returns(bool){return true;} }',"compile>"],
  ];
  for(const[activePath,source,expected]of cases){const value=await request(`/runtime/profiles/lxd/leases/${runtimeId}/tasks`,{method:"POST",body:JSON.stringify({protocolVersion:"ynx-code-runtime/v1",approval:"execute-container-once",projectId,activePath,files:{[activePath]:source}})});assert.equal(value.ok,true,`${activePath}: ${value.output}`);assert.match(value.output,new RegExp(expected));assert.equal(value.sandbox.kind,"lxd-container");assert.equal(value.sandbox.network,false);assert.notEqual(value.compiler.version,"unavailable",`${value.language} version evidence is unavailable`);console.log(`${value.language}: ${value.compiler.version}`)}
  const seeded=await request(`/runtime/workspaces/${projectId}`,{method:"PUT",body:JSON.stringify({protocolVersion:"ynx-code/v1",expectedRevision:0,idempotencyKey:"cloud-terminal-live-seed",workspace:{name:"Cloud language gate",folders:["src"],files:{"src/main.cpp":"int main(){}\n"},open:["src/main.cpp"],active:"src/main.cpp"}})});assert.equal(seeded.workspace.revision,1);
  const terminalMessages=[],wsBase=base.replace(/^http/,"ws"),websocket=new WebSocket(`${wsBase}/runtime/terminals?projectId=${projectId}&runtimeId=${runtimeId}`,"ynx-code-terminal-v1",{headers:{cookie,origin:base}});websocket.on("message",raw=>{const value=JSON.parse(String(raw));terminalMessages.push(value);if(value.type==="ready")websocket.send(JSON.stringify({type:"input",data:"printf CLOUD_TERMINAL_OK > src/terminal.txt; exit\n"}))});await waitFor(()=>terminalMessages.some(value=>value.type==="exit"),20_000);assert.equal(terminalMessages.find(value=>value.type==="ready").sandbox.kind,"lxd-container");const synchronized=await request(`/runtime/workspaces/${projectId}`);assert.equal(synchronized.workspace.files["src/terminal.txt"],"CLOUD_TERMINAL_OK");console.log("terminal: remote PTY and workspace synchronization passed")
}finally{await request(`/runtime/profiles/lxd/leases/${runtimeId}`,{method:"DELETE"})}
console.log("YNX cloud container language gate passed.");

async function waitFor(predicate,timeout){const started=Date.now();while(Date.now()-started<timeout){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25))}throw new Error("Timed out waiting for the cloud terminal gate.")}
