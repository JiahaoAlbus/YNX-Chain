import assert from "node:assert/strict";

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
}finally{await request(`/runtime/profiles/lxd/leases/${runtimeId}`,{method:"DELETE"})}
console.log("YNX cloud container language gate passed.");
