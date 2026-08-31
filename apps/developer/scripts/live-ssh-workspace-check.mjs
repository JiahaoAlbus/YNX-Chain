import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import WebSocket from "ws";

const base=process.env.YNX_CODE_CHECK_BASE||"http://127.0.0.1:4210",host=required("YNX_CODE_SSH_HOST"),user=required("YNX_CODE_SSH_USER"),keyPath=required("YNX_CODE_SSH_KEY_PATH"),port=Number(process.env.YNX_CODE_SSH_PORT||22),projectId=`ssh-live-${Date.now().toString(36)}`;
assert.ok(Number.isInteger(port)&&port>0&&port<=65535,"Invalid SSH port.");
const health=await fetch(`${base}/runtime/health`),cookie=health.headers.get("set-cookie")?.split(";")[0];
assert.equal(health.status,200);assert.ok(cookie,"Gateway did not issue a signed workspace session.");
const request=async(path,options={})=>{const response=await fetch(`${base}${path}`,{...options,headers:{cookie,...(options.body?{"content-type":"application/json"}:{}),...options.headers}}),value=await response.json();if(!response.ok)throw new Error(`${path}: ${JSON.stringify(value)}`);return value};
const target={protocolVersion:"ynx-code-runtime/v1",host,port,user},inspection=await request("/runtime/profiles/ssh/inspect",{method:"POST",body:JSON.stringify(target)}),privateKey=await readFile(keyPath,"utf8"),saved=await request("/runtime/profiles/ssh",{method:"POST",body:JSON.stringify({...target,approval:"connect-ssh-once",label:"YNX SSH live gate",reviewedHostKey:inspection.hostKey,privateKey})}),profileId=saved.profile.profileId,runtimeId=`ssh-${profileId}`;
let websocket;
try{
  await request(`/runtime/workspaces/${projectId}`,{method:"PUT",body:JSON.stringify({protocolVersion:"ynx-code/v1",expectedRevision:0,idempotencyKey:`${projectId}-seed`,workspace:{name:"SSH live gate",folders:["src"],files:{"src/main.txt":"seed\n"},open:["src/main.txt"],active:"src/main.txt"}})});
  const messages=[];websocket=new WebSocket(`${base.replace(/^http/,"ws")}/runtime/terminals?projectId=${projectId}&runtimeId=${runtimeId}`,"ynx-code-terminal-v1",{headers:{cookie,origin:base}});
  websocket.on("message",raw=>{const value=JSON.parse(String(raw));messages.push(value);if(value.type==="ready")websocket.send(JSON.stringify({type:"input",data:"printf SSH_REMOTE_OK > src/remote.txt; exit\n"}))});
  await waitFor(()=>messages.some(value=>value.type==="exit"),60_000,()=>messages.map(value=>value.type).join(","));
  const ready=messages.find(value=>value.type==="ready");assert.equal(ready.sandbox.kind,"remote-ssh");assert.equal(ready.sandbox.network,true);
  const workspace=await request(`/runtime/workspaces/${projectId}`);assert.equal(workspace.workspace.files["src/remote.txt"],"SSH_REMOTE_OK");assert.equal(workspace.workspace.revision,2);
  console.log(`Remote SSH workspace passed · ${inspection.fingerprint} · revision ${workspace.workspace.revision}`);
}finally{websocket?.close();for(let attempt=0;attempt<20;attempt++){try{await request(`/runtime/profiles/ssh/${profileId}`,{method:"DELETE"});break}catch(error){if(attempt===19||!String(error).includes("ssh_workspace_busy"))throw error;await new Promise(resolve=>setTimeout(resolve,250))}}}

function required(name){const value=process.env[name];if(!value)throw new Error(`${name} is required.`);return value}
async function waitFor(predicate,timeout,evidence){const started=Date.now();while(Date.now()-started<timeout){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25))}throw new Error(`Timed out waiting for the Remote SSH workspace gate (${evidence?.()||"no events"}).`)}
