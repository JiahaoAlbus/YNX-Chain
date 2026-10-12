import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { GROK_BUILD_PIN, GrokBuildACPClient } from "../desktop/grok-build-sidecar.mjs";

function mockProcess() {
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit("close",0,null);
  child.stdin.on("data",(data)=>{for(const line of String(data).trim().split("\n")){const message=JSON.parse(line);if(message.method==="initialize")child.stdout.write(`${JSON.stringify({jsonrpc:"2.0",id:message.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}})}\n`);}});
  return child;
}

test("Grok Build ACP adapter uses pinned stdio command and completes JSON-RPC lifecycle",async()=>{
  const children=[];const client=new GrokBuildACPClient({binaryPath:"/approved/grok",cwd:"/project",spawnFactory:(_binary,args,options)=>{assert.deepEqual(args,["agent","stdio"]);assert.equal(options.shell,false);const child=mockProcess();children.push(child);return child;}}).start();
  const result=await client.request("initialize",{protocolVersion:1});assert.equal(result.protocolVersion,1);assert.equal(client.exportAudit().some((entry)=>entry.event==="acp.response"),true);client.close();assert.equal(GROK_BUILD_PIN.commit,"98c3b2438aa922fbbe6178a5c0a4c48f85edc8ce");
});

test("Grok Build ACP adapter rejects unallowlisted client methods and denies agent requests by default",async()=>{
  const child=mockProcess();const client=new GrokBuildACPClient({binaryPath:"/approved/grok",cwd:"/project",spawnFactory:()=>child}).start();
  assert.throws(()=>client.request("fs/delete",{}),/not allowlisted/);child.stdout.write(`${JSON.stringify({jsonrpc:"2.0",id:"agent-1",method:"session/request_permission",params:{tool:"terminal"}})}\n`);
  await new Promise((resolve)=>setImmediate(resolve));assert.equal(client.exportAudit().find((entry)=>entry.event==="acp.agent-request").details.allowed,false);client.close();
});
