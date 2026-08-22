import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createCollaborationService } from "../src/service.mjs";

const PROTOCOL = "ynx-code-collaboration-v1";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "ynx-code-collab-test-"));
  const workspaceStore = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") });
  workspaceStore.put("owner-a", "shared-project", { expectedRevision: 0, idempotencyKey: "seed-project-1", payload: { name: "Shared project", folders: ["src"], files: { "src/main.ts": "export const value = 1;\n" }, open: ["src/main.ts"], active: "src/main.ts" } });
  const collaborationFile=join(root,"collaboration.sqlite"),service = createCollaborationService({ filename: collaborationFile, workspaceStore, ownerForRequest: request => request.headers["x-owner"] || null, maxConnections: 8, maxRoomConnections: 4 });
  const server = createServer((request, response) => service.handler(request, response).then(handled => { if (!handled) response.writeHead(404).end(); }));
  server.on("upgrade", (request, socket, head) => { if (!service.handleUpgrade(request, socket, head)) socket.destroy(); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await service.close(); await new Promise(resolve => server.close(resolve)); workspaceStore.close(); await rm(root, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${server.address().port}`, workspaceStore, service, collaborationFile };
}

async function request(base, owner, path, body, method = "POST") {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-owner": owner }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, value: await response.json() };
}
async function connect(base, owner, roomId, origin = base) {
  const url = `${base.replace("http", "ws")}/runtime/collaboration?roomId=${encodeURIComponent(roomId)}`;
  const websocket = new WebSocket(url, PROTOCOL, { headers: { origin, "x-owner": owner } });
  const inbox = messageInbox(websocket);
  await new Promise((resolve, reject) => { websocket.once("open", resolve); websocket.once("error", reject); });
  return { websocket, inbox };
}
function messageInbox(websocket) {
  const queue = [], waiters = [];
  websocket.on("message", raw => { const value = JSON.parse(String(raw)), index = waiters.findIndex(item => item.predicate(value)); if (index >= 0) { const [waiter] = waiters.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(value); } else queue.push(value); });
  return function next(predicate = () => true, timeout = 3000) { const index = queue.findIndex(predicate); if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]); return new Promise((resolve, reject) => { const waiter = { predicate, resolve, timer: setTimeout(() => { const at = waiters.indexOf(waiter); if (at >= 0) waiters.splice(at, 1); reject(new Error(`Timed out waiting for collaboration message; queued=${queue.map(value => `${value.type}:${value.code || value.action || ""}`).join(",")}`)); }, timeout) }; waiters.push(waiter); }); };
}

test("one-time ACL invitation enables real CRDT editing, presence, chat and revision checkpoint", async t => {
  const { base, workspaceStore, service, collaborationFile } = await fixture(t);
  const created = await request(base, "owner-a", "/runtime/collaboration/rooms", { projectId: "shared-project" });
  assert.equal(created.response.status, 200); assert.equal(created.value.role, "owner");
  const invited = await request(base, "owner-a", "/runtime/collaboration/invites", { roomId: created.value.roomId, role: "editor", expiresMinutes: 5 });
  assert.equal(invited.response.status, 201); assert.equal(invited.value.singleUse, true);
  const redeemed = await request(base, "editor-b", "/runtime/collaboration/invites/redeem", { token: invited.value.token });
  assert.equal(redeemed.response.status, 200); assert.equal(redeemed.value.role, "editor");
  const replay = await request(base, "other-c", "/runtime/collaboration/invites/redeem", { token: invited.value.token });
  assert.equal(replay.response.status, 410);

  const owner = await connect(base, "owner-a", created.value.roomId), editor = await connect(base, "editor-b", created.value.roomId);
  t.after(() => { owner.websocket.close(); editor.websocket.close(); });
  const ownerReady = await owner.inbox(value => value.type === "ready"), editorReady = await editor.inbox(value => value.type === "ready");
  assert.equal(ownerReady.role, "owner"); assert.equal(editorReady.role, "editor"); assert.deepEqual(editorReady.paths, ["src/main.ts"]);
  const ownerDoc = new Y.Doc(), editorDoc = new Y.Doc();
  Y.applyUpdate(ownerDoc, Buffer.from(ownerReady.update, "base64")); Y.applyUpdate(editorDoc, Buffer.from(editorReady.update, "base64"));
  let incremental; editorDoc.once("update", update => { incremental = update; });
  const text = editorDoc.getText("file:src/main.ts"); editorDoc.transact(() => { text.delete(0, text.length); text.insert(0, "export const value = 42;\n"); });
  editor.websocket.send(JSON.stringify({ type: "update", update: Buffer.from(incremental).toString("base64") }));
  const updateOutcome = await editor.inbox(value => value.type === "ack" || value.type === "error"); assert.equal(updateOutcome.type, "ack", JSON.stringify(updateOutcome));
  const remoteUpdate = await owner.inbox(value => value.type === "update"); Y.applyUpdate(ownerDoc, Buffer.from(remoteUpdate.update, "base64"));
  assert.equal(ownerDoc.getText("file:src/main.ts").toString(), "export const value = 42;\n");
  let createUpdate; editorDoc.once("update", update => { createUpdate = update; }); editorDoc.transact(() => { editorDoc.getMap("paths").set("src/shared.ts", true); editorDoc.getText("file:src/shared.ts").insert(0, "export const shared = true;\n"); });
  editor.websocket.send(JSON.stringify({ type: "update", update: Buffer.from(createUpdate).toString("base64") }));
  assert.equal((await editor.inbox(value => value.type === "ack" || value.type === "error")).type, "ack");
  Y.applyUpdate(ownerDoc, Buffer.from((await owner.inbox(value => value.type === "update")).update, "base64"));
  assert.equal(ownerDoc.getText("file:src/shared.ts").toString(), "export const shared = true;\n");
  editor.websocket.send(JSON.stringify({ type: "presence", path: "src/main.ts", anchor: 24, head: 24, name: "Editor B" }));
  assert.equal((await owner.inbox(value => value.type === "presence" && value.action === "update")).name, "Editor B");
  owner.websocket.send(JSON.stringify({ type: "chat", text: "Ready for review" }));
  assert.equal((await editor.inbox(value => value.type === "chat")).text, "Ready for review");
  editor.websocket.send(JSON.stringify({ type: "checkpoint" }));
  const checkpoint = await owner.inbox(value => value.type === "checkpoint"); assert.equal(checkpoint.revision, 2);
  assert.equal(workspaceStore.get("owner-a", "shared-project").files["src/main.ts"], "export const value = 42;\n");
  assert.equal(workspaceStore.get("owner-a", "shared-project").files["src/shared.ts"], "export const shared = true;\n");
  assert.equal(service.status().connections, 2);
  const recoveredService=createCollaborationService({filename:collaborationFile,workspaceStore,ownerForRequest:request=>request.headers["x-owner"]||null,maxConnections:4,maxRoomConnections:4}),recoveredServer=createServer((request,response)=>recoveredService.handler(request,response).then(handled=>{if(!handled)response.writeHead(404).end()}));recoveredServer.on("upgrade",(request,socket,head)=>{if(!recoveredService.handleUpgrade(request,socket,head))socket.destroy()});await new Promise(resolve=>recoveredServer.listen(0,"127.0.0.1",resolve));t.after(async()=>{await recoveredService.close();await new Promise(resolve=>recoveredServer.close(resolve))});const recoveredBase=`http://127.0.0.1:${recoveredServer.address().port}`,recovered=await connect(recoveredBase,"owner-a",created.value.roomId);t.after(()=>recovered.websocket.close());const recoveredReady=await recovered.inbox(value=>value.type==="ready"),recoveredDoc=new Y.Doc();Y.applyUpdate(recoveredDoc,Buffer.from(recoveredReady.update,"base64"));assert.equal(recoveredDoc.getText("file:src/shared.ts").toString(),"export const shared = true;\n");
});

test("viewer updates and cross-origin sockets fail closed", async t => {
  const { base } = await fixture(t), created = await request(base, "owner-a", "/runtime/collaboration/rooms", { projectId: "shared-project" });
  const invited = await request(base, "owner-a", "/runtime/collaboration/invites", { roomId: created.value.roomId, role: "viewer", expiresMinutes: 5 });
  await request(base, "viewer-b", "/runtime/collaboration/invites/redeem", { token: invited.value.token });
  const viewer = await connect(base, "viewer-b", created.value.roomId); t.after(() => viewer.websocket.close());
  const ready = await viewer.inbox(value => value.type === "ready"), doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(ready.update, "base64"));
  let update; doc.once("update", value => { update = value; }); doc.getText("file:src/main.ts").insert(0, "blocked");
  viewer.websocket.send(JSON.stringify({ type: "update", update: Buffer.from(update).toString("base64") }));
  assert.equal((await viewer.inbox(value => value.type === "error")).code, "collaboration_read_only");
  const bad = new WebSocket(`${base.replace("http", "ws")}/runtime/collaboration?roomId=${created.value.roomId}`, PROTOCOL, { headers: { origin: "https://attacker.invalid", "x-owner": "owner-a" } });
  const status = await new Promise(resolve => { bad.once("unexpected-response", (_request, response) => resolve(response.statusCode)); bad.once("error", () => resolve(0)); });
  assert.equal(status, 403);
});

test("owner revocation closes active sockets and prevents reconnect", async t => {
  const { base } = await fixture(t),
    created = await request(base, "owner-a", "/runtime/collaboration/rooms", { projectId: "shared-project" }),
    invited = await request(base, "owner-a", "/runtime/collaboration/invites", { roomId: created.value.roomId, role: "editor", expiresMinutes: 5 });
  await request(base, "editor-b", "/runtime/collaboration/invites/redeem", { token: invited.value.token });
  const access = await request(base, "owner-a", `/runtime/collaboration/rooms/${created.value.roomId}`, undefined, "GET");
  assert.deepEqual(access.value.members.map(member => [member.subjectId, member.role]), [["owner-a", "owner"], ["editor-b", "editor"]]);
  const editorAccess = await request(base, "editor-b", `/runtime/collaboration/rooms/${created.value.roomId}`, undefined, "GET");
  assert.equal(editorAccess.value.members, undefined);
  const editor = await connect(base, "editor-b", created.value.roomId);
  await editor.inbox(value => value.type === "ready");
  const unapproved = await request(base, "owner-a", `/runtime/collaboration/rooms/${created.value.roomId}/members/editor-b`, undefined, "DELETE");
  assert.equal(unapproved.response.status, 403);
  const closeCode = new Promise(resolve => editor.websocket.once("close", resolve));
  const revoked = await request(base, "owner-a", `/runtime/collaboration/rooms/${created.value.roomId}/members/editor-b?approval=revoke-member-once`, undefined, "DELETE");
  assert.equal(revoked.response.status, 200);
  assert.deepEqual(revoked.value.members.map(member => member.subjectId), ["owner-a"]);
  assert.equal((await editor.inbox(value => value.type === "access-revoked")).roomId, created.value.roomId);
  assert.equal(await closeCode, 4003);
  const denied = await request(base, "editor-b", `/runtime/collaboration/rooms/${created.value.roomId}`, undefined, "GET");
  assert.equal(denied.response.status, 403);
  const reconnect = new WebSocket(
    `${base.replace("http", "ws")}/runtime/collaboration?roomId=${created.value.roomId}`,
    PROTOCOL,
    { headers: { origin: base, "x-owner": "editor-b" } },
  );
  const reconnectStatus = await new Promise(resolve => {
    reconnect.once("unexpected-response", (_request, response) => resolve(response.statusCode));
    reconnect.once("error", () => resolve(0));
  });
  assert.equal(reconnectStatus, 403);
});

test("concurrent editors converge and per-room connection capacity is enforced",async t=>{const{base}=await fixture(t),created=await request(base,"owner-a","/runtime/collaboration/rooms",{projectId:"shared-project"});for(const editor of ["editor-b","editor-c"]){const invited=await request(base,"owner-a","/runtime/collaboration/invites",{roomId:created.value.roomId,role:"editor",expiresMinutes:5});await request(base,editor,"/runtime/collaboration/invites/redeem",{token:invited.value.token})}const owner=await connect(base,"owner-a",created.value.roomId),first=await connect(base,"editor-b",created.value.roomId),second=await connect(base,"editor-c",created.value.roomId);t.after(()=>{owner.websocket.close();first.websocket.close();second.websocket.close()});const ready=await Promise.all([owner.inbox(value=>value.type==="ready"),first.inbox(value=>value.type==="ready"),second.inbox(value=>value.type==="ready")]),documents=ready.map(value=>{const doc=new Y.Doc();Y.applyUpdate(doc,Buffer.from(value.update,"base64"));return doc}),updates=[];documents[1].once("update",value=>updates[0]=value);documents[1].getText("file:src/main.ts").insert(0,"// editor B\n");documents[2].once("update",value=>updates[1]=value);documents[2].getText("file:src/main.ts").insert(documents[2].getText("file:src/main.ts").length,"// editor C\n");first.websocket.send(JSON.stringify({type:"update",update:Buffer.from(updates[0]).toString("base64")}));second.websocket.send(JSON.stringify({type:"update",update:Buffer.from(updates[1]).toString("base64")}));assert.equal((await first.inbox(value=>value.type==="ack"||value.type==="error")).type,"ack");assert.equal((await second.inbox(value=>value.type==="ack"||value.type==="error")).type,"ack");for(let index=0;index<2;index++)Y.applyUpdate(documents[0],Buffer.from((await owner.inbox(value=>value.type==="update")).update,"base64"));const merged=documents[0].getText("file:src/main.ts").toString();assert.match(merged,/editor B/);assert.match(merged,/editor C/);const fourth=await connect(base,"owner-a",created.value.roomId);t.after(()=>fourth.websocket.close());const fourthReady=await fourth.inbox(value=>value.type==="ready"),fourthDoc=new Y.Doc();Y.applyUpdate(fourthDoc,Buffer.from(fourthReady.update,"base64"));assert.equal(fourthDoc.getText("file:src/main.ts").toString(),merged);const fifth=new WebSocket(`${base.replace("http","ws")}/runtime/collaboration?roomId=${created.value.roomId}`,PROTOCOL,{headers:{origin:base,"x-owner":"owner-a"}}),status=await new Promise(resolve=>{fifth.once("unexpected-response",(_request,response)=>resolve(response.statusCode));fifth.once("error",()=>resolve(0))});assert.equal(status,403)});
