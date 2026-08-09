import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import WebSocket from "ws";
import { createWorkspaceRuntime } from "../../workspace-agent/src/runtime.mjs";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createTerminalService } from "../src/service.mjs";

test("authenticated PTY streams output and synchronizes text workspace changes",async t=>{
  const root=await mkdtemp(join(tmpdir(),"ynx-terminal-test-")),store=createWorkspaceStore({filename:join(root,"workspaces.sqlite")}),runtime=createWorkspaceRuntime({sessionKey:"terminal-test-session-key-that-is-long-enough",workspaceStore:store}),server=createServer(async(request,response)=>{if(!await runtime.handler(request,response)){response.statusCode=404;response.end()}}),terminal=createTerminalService({workspaceStore:store,ownerForRequest:request=>runtime.ownerForRequest(request),root:join(root,"sessions"),idleMs:30_000,hardMs:30_000});server.on("upgrade",terminal.handleUpgrade);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(async()=>{await terminal.close();await new Promise(resolve=>server.close(resolve));store.close()});const address=server.address(),base=`http://127.0.0.1:${address.port}`;
  const health=await fetch(`${base}/runtime/health`),cookie=health.headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
  const saved=await fetch(`${base}/runtime/workspaces/pty-project`,{method:"PUT",headers:{cookie,"content-type":"application/json"},body:JSON.stringify({protocolVersion:"ynx-code/v1",expectedRevision:0,idempotencyKey:"terminal-seed-0001",workspace:{name:"PTY Project",folders:["src"],files:{"src/main.cpp":"int main(){}\n"},open:["src/main.cpp"],active:"src/main.cpp"}})});assert.equal(saved.status,200);
  const messages=[],websocket=new WebSocket(`ws://127.0.0.1:${address.port}/runtime/terminals?projectId=pty-project`,"ynx-code-terminal-v1",{headers:{cookie,origin:base}});websocket.on("message",raw=>messages.push(JSON.parse(String(raw))));await waitFor(()=>messages.some(value=>value.type==="ready"));websocket.send(JSON.stringify({type:"resize",cols:120,rows:40}));websocket.send(JSON.stringify({type:"input",data:"printf 'PTY-STREAM-OK\\n'; printf 'created-through-pty\\n' > src/terminal.txt; exit\n"}));await waitFor(()=>messages.some(value=>value.type==="exit"),10_000);assert.match(messages.filter(value=>value.type==="output").map(value=>value.data).join(""),/PTY-STREAM-OK/);const sync=messages.find(value=>value.type==="workspace-synced");assert.equal(sync.revision,2);const owner=runtime.ownerForRequest({headers:{cookie}});assert.equal(store.get(owner,"pty-project").files["src/terminal.txt"],"created-through-pty\n");
});

test("terminal upgrade rejects missing session and cross-origin requests",async()=>{
  const writes=[],socket={write:value=>writes.push(value),destroy(){this.destroyed=true}},service=createTerminalService({workspaceStore:{},ownerForRequest:()=>null,sandbox:{kind:"test",ready:true}});service.handleUpgrade({url:"/runtime/terminals?projectId=x",headers:{host:"localhost",origin:"https://evil.example"}},socket,Buffer.alloc(0));assert.equal(socket.destroyed,true);assert.match(writes.join(""),/403 Forbidden/);await service.close();
});

async function waitFor(predicate,timeout=5000){const started=Date.now();while(Date.now()-started<timeout){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25))}throw new Error("Timed out waiting for terminal event.")}
