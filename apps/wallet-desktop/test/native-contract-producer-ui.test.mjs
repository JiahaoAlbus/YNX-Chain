import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {NativeContractClient} from "../src/native-contract.mjs";
import {createNativeContractService} from "../src/native-contract-service.mjs";
import {createNativeContractUI} from "../src/native-contract-ui.mjs";
import {id} from "ethers";
const bft=JSON.parse(await readFile(new URL("../../wallet/src/chain/testdata/bft-contract-go-audit-v1.json",import.meta.url),"utf8"));
const legacy=JSON.parse(await readFile(new URL("../../wallet/src/chain/testdata/source-analyzer-go-v1.json",import.meta.url),"utf8"));
const origin="https://rpc-testnet.ynxweb4.com";
for(const runtime of ["bft","legacy","legacy-bytecode"])for(const action of ["lookup","read"])test(`original ${runtime} ${action} client/service/UI composes full public DTO without SDK or signer`,async()=>{
  // Original parsers, pinned artifact and client/service execute with controlled
  // literal public Go fixtures. This is neither live chain nor private authority.
  const mode=runtime==="bft"?"bft":"legacy",artifact=structuredClone(mode==="bft"?bft:legacy.artifact),calls=[],views=[];
  let read=legacy.reads[0];
  if(runtime==="legacy-bytecode"){
    // Controlled existing legacy bytecode-runtime shape, not a deployed-node
    // claim. The original client validates selectors and interpreter evidence.
    artifact.artifactKind="pinned-solc-bytecode-artifact";artifact.runtimeMode="hardhat-artifact-local-evm-opcode-staticcall-subset";
    artifact.functions=artifact.functions.map(row=>({...row,selector:id(row.signature).slice(0,10),selectorSource:"hardhat-ethers-keccak-selector-metadata",bytecodeSelectorMatched:true}));
    read={...read,selector:id(read.signature).slice(0,10),artifactKind:artifact.artifactKind,runtimeMode:artifact.runtimeMode,executionStatus:"evm_opcode_interpreter_staticcall_subset",executionEngine:"local-bounded-evm-opcode-interpreter",opcodeStepCount:24,bytecodeSelectorMatched:true};
  }
  const client=new NativeContractClient(origin,async(url,init)=>{
    const route=url.slice(origin.length),body=init.body===undefined?null:JSON.parse(init.body);calls.push({route,body});
    const payload=route==="/evm"?{jsonrpc:"2.0",id:body.id,result:"0x1917"}:route==="/ide/call"?(mode==="bft"?{address:artifact.address,runtimeMode:artifact.runtimeMode,encodedResult:"0x"+"0".repeat(63)+"7",opcodeStepCount:24}:read):artifact;
    return new Response(JSON.stringify(payload));
  });
  const request=createNativeContractService({client,getContext:()=>({account:artifact.address,revision:1,focused:true,changing:false})});
  const ui=createNativeContractUI({getContext:()=>({open:true,account:artifact.address,keyRevision:1}),request:async input=>({ok:true,value:await request(input)}),render:view=>views.push(view)});
  await ui.run({mode,action,address:artifact.address,...(action==="read"?{function:mode==="bft"?"0x06661abd":read.selector}:{})});
  const view=views.at(-1);assert.equal(view.error,null);assert.equal(view.busy,false);assert.ok(view.result);assert.equal(Object.isFrozen(view.result),true);
  if(action==="lookup"){assert.equal(view.result.artifact.address,artifact.address);assert.ok(view.result.methods.length>0);assert.equal(Object.isFrozen(view.result.methods),true);}
  else{assert.equal(view.result.read.artifact.address,artifact.address);assert.equal(view.result.read.returnValue,"7");assert.match(view.result.read.truthfulStatus,/no-sign-no-broadcast$/);assert.equal(Object.isFrozen(view.result.read.artifact),true);}
  assert.equal(calls.some(row=>row.route==="/ide/deploy"||row.route==="/ide/execute"||row.body?.method==="eth_sendRawTransaction"),false);
});
