import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { WebSocketServer } from "ws";
import * as Y from "yjs";

const PROTOCOL = "ynx-code-collaboration-v1";
const ROLES = new Set(["editor", "reviewer", "viewer", "terminal"]);
const WRITERS = new Set(["owner", "editor"]);
const SAFE_PATH = /^[A-Za-z0-9_./ +@-]+$/;

export function createCollaborationService(options) {
  const { workspaceStore, ownerForRequest, filename } = options;
  const maxConnections = bounded(options.maxConnections, 256, 1, 4096);
  const maxRoomConnections = bounded(options.maxRoomConnections, 32, 1, 256);
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS collaboration_resources(room_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(owner_id,project_id));
    CREATE TABLE IF NOT EXISTS collaboration_acl(room_id TEXT NOT NULL, subject_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(room_id,subject_id), FOREIGN KEY(room_id) REFERENCES collaboration_resources(room_id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS collaboration_invites(invite_hash TEXT PRIMARY KEY, room_id TEXT NOT NULL, role TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_by TEXT, consumed_at TEXT, FOREIGN KEY(room_id) REFERENCES collaboration_resources(room_id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS collaboration_documents(room_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, paths_json TEXT NOT NULL, state BLOB NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(room_id) REFERENCES collaboration_resources(room_id) ON DELETE CASCADE);`);
  const statements = {
    resourceByOwner: db.prepare("SELECT room_id,owner_id,project_id FROM collaboration_resources WHERE owner_id=? AND project_id=?"),
    resourceById: db.prepare("SELECT room_id,owner_id,project_id FROM collaboration_resources WHERE room_id=?"),
    insertResource: db.prepare("INSERT INTO collaboration_resources(room_id,owner_id,project_id,created_at) VALUES(?,?,?,?)"),
    access: db.prepare("SELECT role FROM collaboration_acl WHERE room_id=? AND subject_id=?"),
    listAccess: db.prepare("SELECT subject_id,role,created_at FROM collaboration_acl WHERE room_id=? ORDER BY created_at,subject_id"),
    grant: db.prepare("INSERT INTO collaboration_acl(room_id,subject_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(room_id,subject_id) DO UPDATE SET role=excluded.role"),
    revoke: db.prepare("DELETE FROM collaboration_acl WHERE room_id=? AND subject_id=? AND role<>'owner'"),
    invite: db.prepare("INSERT INTO collaboration_invites(invite_hash,room_id,role,expires_at) VALUES(?,?,?,?)"),
    inviteByHash: db.prepare("SELECT invite_hash,room_id,role,expires_at,consumed_by FROM collaboration_invites WHERE invite_hash=?"),
    consume: db.prepare("UPDATE collaboration_invites SET consumed_by=?,consumed_at=? WHERE invite_hash=? AND consumed_by IS NULL"),
    document: db.prepare("SELECT revision,paths_json,state FROM collaboration_documents WHERE room_id=?"),
    saveDocument: db.prepare("INSERT INTO collaboration_documents(room_id,revision,paths_json,state,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(room_id) DO UPDATE SET revision=excluded.revision,paths_json=excluded.paths_json,state=excluded.state,updated_at=excluded.updated_at"),
  };
  const rooms = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  async function handler(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (!url.pathname.startsWith("/runtime/collaboration/")) return false;
    const subject = ownerForRequest(request);
    if (!subject) return json(response, 401, { error: "A canonical product session is required.", code: "collaboration_session_required" }), true;
    try {
      if (url.pathname === "/runtime/collaboration/rooms" && request.method === "POST") {
        const body = await readJson(request);
        if (!validId(body.projectId)) throw fault("A valid project is required.", "invalid_project", 400);
        if (!workspaceStore.get(subject, body.projectId)) throw fault("Workspace was not found.", "workspace_not_found", 404);
        const value = ensureResource(subject, body.projectId);
        return json(response, 200, { protocolVersion: PROTOCOL, roomId: value.room_id, projectId: value.project_id, role: "owner" }), true;
      }
      const roomMatch = url.pathname.match(/^\/runtime\/collaboration\/rooms\/([-A-Za-z0-9_]{1,160})$/);
      if (roomMatch && request.method === "GET") {
        const resource = requireAccess(roomMatch[1], subject);
        return json(response, 200, {
          protocolVersion: PROTOCOL,
          roomId: resource.room_id,
          projectId: resource.project_id,
          role: resource.role,
          ...(resource.role === "owner" ? { members: members(resource.room_id) } : {}),
        }), true;
      }
      const memberMatch = url.pathname.match(/^\/runtime\/collaboration\/rooms\/([-A-Za-z0-9_]{1,160})\/members\/([-A-Za-z0-9_]{1,160})$/);
      if (memberMatch && request.method === "DELETE") {
        const resource = statements.resourceById.get(memberMatch[1]);
        if (!resource || resource.owner_id !== subject)
          throw fault("Only the workspace owner can revoke collaborators.", "collaboration_forbidden", 403);
        if (url.searchParams.get("approval") !== "revoke-member-once")
          throw fault("Revocation requires one-time approval.", "collaboration_revoke_approval_required", 403);
        const memberId = memberMatch[2], access = statements.access.get(resource.room_id, memberId);
        if (!access) throw fault("Collaboration member was not found.", "collaboration_member_not_found", 404);
        if (access.role === "owner") throw fault("Room owner access cannot be revoked.", "collaboration_owner_revoke_forbidden", 409);
        statements.revoke.run(resource.room_id, memberId);
        disconnectSubject(resource.room_id, memberId);
        return json(response, 200, {
          protocolVersion: PROTOCOL,
          roomId: resource.room_id,
          revokedSubject: memberId,
          members: members(resource.room_id),
        }), true;
      }
      if (url.pathname === "/runtime/collaboration/invites" && request.method === "POST") {
        const body = await readJson(request), resource = statements.resourceById.get(body.roomId);
        if (!resource || resource.owner_id !== subject) throw fault("Only the workspace owner can invite collaborators.", "collaboration_forbidden", 403);
        if (!ROLES.has(body.role)) throw fault("A supported collaboration role is required.", "invalid_collaboration_role", 400);
        const minutes = bounded(body.expiresMinutes, 60, 5, 24 * 60), token = randomBytes(32).toString("base64url"), expiresAt = Date.now() + minutes * 60_000;
        statements.invite.run(hashToken(token), resource.room_id, body.role, expiresAt);
        return json(response, 201, { protocolVersion: PROTOCOL, token, roomId: resource.room_id, role: body.role, expiresAt: new Date(expiresAt).toISOString(), singleUse: true }), true;
      }
      if (url.pathname === "/runtime/collaboration/invites/redeem" && request.method === "POST") {
        const body = await readJson(request);
        if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) throw fault("A valid invitation token is required.", "invalid_collaboration_invite", 400);
        const digest = hashToken(body.token), invite = statements.inviteByHash.get(digest);
        if (!invite || invite.consumed_by || invite.expires_at < Date.now()) throw fault("Invitation is invalid, expired or already used.", "collaboration_invite_unavailable", 410);
        db.exec("BEGIN IMMEDIATE");
        try {
          const current = statements.inviteByHash.get(digest);
          if (!current || current.consumed_by || current.expires_at < Date.now()) throw fault("Invitation is invalid, expired or already used.", "collaboration_invite_unavailable", 410);
          statements.grant.run(current.room_id, subject, current.role, new Date().toISOString());
          if (statements.consume.run(subject, new Date().toISOString(), digest).changes !== 1) throw fault("Invitation was already used.", "collaboration_invite_unavailable", 410);
          db.exec("COMMIT");
          const resource = statements.resourceById.get(current.room_id);
          return json(response, 200, { protocolVersion: PROTOCOL, roomId: current.room_id, projectId: resource.project_id, role: current.role }), true;
        } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
      }
      return json(response, 404, { error: "Collaboration route was not found.", code: "collaboration_route_not_found" }), true;
    } catch (error) {
      return json(response, error.status || 400, { error: error.message || "Collaboration request failed.", code: error.code || "collaboration_request_failed" }), true;
    }
  }

  function handleUpgrade(request, socket, head) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname !== "/runtime/collaboration") return false;
    const subject = ownerForRequest(request), roomId = url.searchParams.get("roomId");
    let resource;
    try { resource = subject && sameOrigin(request) && request.headers["sec-websocket-protocol"] === PROTOCOL ? requireAccess(roomId, subject) : null; } catch {}
    const roomConnections = resource ? [...wss.clients].filter(client => client.roomId === resource.room_id).length : maxRoomConnections;
    if (!resource || wss.clients.size >= maxConnections || roomConnections >= maxRoomConnections) { reject(socket); return true; }
    wss.handleUpgrade(request, socket, head, websocket => wss.emit("connection", websocket, request, { subject, resource }));
    return true;
  }

  wss.on("connection", (websocket, _request, identity) => connect(websocket, identity).catch(error => { send(websocket, { type: "error", code: error.code || "collaboration_start_failed", message: error.message || "Collaboration could not start." }); websocket.close(1011, "Collaboration start failed"); }));

  async function connect(websocket, { subject, resource }) {
    const room = await loadRoom(resource), clientId = randomUUID(), role = resource.role;
    websocket.roomId = room.roomId; websocket.clientId = clientId; websocket.subject = subject; websocket.role = role;
    room.clients.set(clientId, { websocket, subject, role, presence: null });
    send(websocket, { type: "ready", protocolVersion: PROTOCOL, roomId: room.roomId, clientId, role, revision: room.revision, paths: [...room.paths], participants: [...room.clients.entries()].map(([id, client]) => ({ clientId: id, role: client.role, ...(client.presence?.name ? { name: client.presence.name } : {}) })), update: Buffer.from(Y.encodeStateAsUpdate(room.document)).toString("base64") });
    broadcast(room, { type: "presence", action: "join", clientId, role }, clientId);
    websocket.on("message", raw => message(room, websocket, raw).catch(error => send(websocket, { type: "error", code: error.code || "collaboration_message_failed", message: error.message || "Collaboration message failed." })));
    websocket.on("close", () => leave(room, clientId));
    websocket.on("error", () => leave(room, clientId));
  }

  async function message(room, websocket, raw) {
    const currentAccess = statements.access.get(room.roomId, websocket.subject);
    if (!currentAccess || currentAccess.role !== websocket.role) {
      websocket.close(4003, "Collaboration access revoked");
      throw fault("Collaboration access was revoked.", "collaboration_access_revoked", 403);
    }
    let value;
    try { value = JSON.parse(String(raw)); } catch { throw fault("Collaboration messages must be JSON.", "invalid_collaboration_message", 400); }
    if (value.type === "update") {
      if (!WRITERS.has(websocket.role)) throw fault("This collaboration role cannot edit files.", "collaboration_read_only", 403);
      const update = decodeUpdate(value.update), candidate = new Y.Doc(); candidate.getMap("paths"); for (const path of room.paths) candidate.getText(`file:${path}`);
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.document)); Y.applyUpdate(candidate, update); materializeRootTypes(candidate); const nextPaths = validateDocument(candidate);
      Y.applyUpdate(room.document, update); for (const path of nextPaths) room.document.getText(`file:${path}`); room.paths = nextPaths; persistRoom(room);
      broadcast(room, { type: "update", clientId: websocket.clientId, update: Buffer.from(update).toString("base64") }, websocket.clientId);
      return send(websocket, { type: "ack", operation: "update", stateVector: Buffer.from(Y.encodeStateVector(room.document)).toString("base64") });
    }
    if (value.type === "presence") {
      const presence = validatePresence(value, room.paths); room.clients.get(websocket.clientId).presence = presence;
      return broadcast(room, { type: "presence", action: "update", clientId: websocket.clientId, role: websocket.role, ...presence }, websocket.clientId);
    }
    if (value.type === "chat") {
      if (typeof value.text !== "string" || !value.text.trim() || Buffer.byteLength(value.text) > 2000) throw fault("Chat message is invalid.", "invalid_collaboration_chat", 400);
      return broadcast(room, { type: "chat", clientId: websocket.clientId, role: websocket.role, text: value.text.trim(), sentAt: new Date().toISOString() });
    }
    if (value.type === "checkpoint") {
      if (!WRITERS.has(websocket.role)) throw fault("This collaboration role cannot checkpoint files.", "collaboration_read_only", 403);
      const current = workspaceStore.get(room.ownerId, room.projectId);
      if (!current || current.revision !== room.revision) throw fault("Workspace revision changed outside this room. Reload before checkpointing.", "revision_conflict", 409);
      const { revision: _revision, updatedAt: _updatedAt, ...payload } = current;
      payload.files = Object.fromEntries([...room.paths].map(path => [path, room.document.getText(`file:${path}`).toString()]));
      payload.folders = foldersFromPaths([...room.paths]);
      payload.open = payload.open.filter(path => room.paths.has(path));
      if (!room.paths.has(payload.active)) payload.active = payload.open[0] || [...room.paths][0];
      const saved = workspaceStore.put(room.ownerId, room.projectId, { expectedRevision: room.revision, idempotencyKey: `collab-${randomUUID()}`, payload });
      room.revision = saved.revision; persistRoom(room);
      broadcast(room, { type: "checkpoint", revision: room.revision, clientId: websocket.clientId });
      return;
    }
    throw fault("Unsupported collaboration operation.", "invalid_collaboration_message", 400);
  }

  async function loadRoom(resource) {
    if (rooms.has(resource.room_id)) return rooms.get(resource.room_id);
    const snapshot = workspaceStore.get(resource.owner_id, resource.project_id);
    if (!snapshot) throw fault("Workspace was not found.", "workspace_not_found", 404);
    const document = new Y.Doc(), persisted = statements.document.get(resource.room_id), paths = new Set(Object.keys(snapshot.files)); document.getMap("paths"); for (const path of paths) document.getText(`file:${path}`);
    if (persisted) {
      const savedPaths = JSON.parse(persisted.paths_json); if (!Array.isArray(savedPaths) || savedPaths.some(path => !paths.has(path))) throw fault("Collaboration checkpoint no longer matches the workspace.", "collaboration_checkpoint_stale", 409);
      Y.applyUpdate(document, new Uint8Array(persisted.state));
    } else { const pathMap = document.getMap("paths"); for (const [path, content] of Object.entries(snapshot.files)) { pathMap.set(path, true); document.getText(`file:${path}`).insert(0, content); } }
    materializeRootTypes(document); const activePaths = validateDocument(document);
    const room = { roomId: resource.room_id, ownerId: resource.owner_id, projectId: resource.project_id, revision: persisted ? Number(persisted.revision) : snapshot.revision, document, paths: activePaths, clients: new Map() };
    rooms.set(room.roomId, room); persistRoom(room); return room;
  }

  function ensureResource(owner, projectId) {
    let resource = statements.resourceByOwner.get(owner, projectId); if (resource) return resource;
    const roomId = randomUUID(), now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE"); try { statements.insertResource.run(roomId, owner, projectId, now); statements.grant.run(roomId, owner, "owner", now); db.exec("COMMIT"); } catch (error) { try { db.exec("ROLLBACK"); } catch {} resource = statements.resourceByOwner.get(owner, projectId); if (!resource) throw error; }
    return resource || statements.resourceById.get(roomId);
  }
  function requireAccess(roomId, subject) { if (!validId(roomId)) throw fault("A valid collaboration room is required.", "invalid_collaboration_room", 400); const resource = statements.resourceById.get(roomId), access = resource && statements.access.get(roomId, subject); if (!resource || !access) throw fault("Collaboration access was not granted.", "collaboration_forbidden", 403); return { ...resource, role: access.role }; }
  function members(roomId) { return statements.listAccess.all(roomId).map(row => ({ subjectId: row.subject_id, role: row.role, grantedAt: row.created_at })); }
  function disconnectSubject(roomId, subject) { const room = rooms.get(roomId); if (!room) return; for (const client of room.clients.values()) if (client.subject === subject) { send(client.websocket, { type: "access-revoked", roomId }); client.websocket.close(4003, "Collaboration access revoked"); } }
  function persistRoom(room) { statements.saveDocument.run(room.roomId, room.revision, JSON.stringify([...room.paths]), Buffer.from(Y.encodeStateAsUpdate(room.document)), new Date().toISOString()); }
  function leave(room, clientId) { if (!room.clients.delete(clientId)) return; broadcast(room, { type: "presence", action: "leave", clientId }); }
  function broadcast(room, value, except) { for (const [clientId, client] of room.clients) if (clientId !== except) send(client.websocket, value); }
  async function close() { for (const room of rooms.values()) for (const client of room.clients.values()) try { client.websocket.close(1001, "Service shutdown"); } catch {} wss.close(); db.close(); }
  return { handler, handleUpgrade, close, status: () => ({ rooms: rooms.size, connections: wss.clients.size, maxConnections, maxRoomConnections }) };
}

function materializeRootTypes(document) { document.getMap("paths"); for (const name of document.share.keys()) if (name.startsWith("file:") && safePath(name.slice(5))) document.getText(name); }
function validateDocument(document) { const pathMap = document.getMap("paths"), paths = new Set(), fileRoots = new Set(); let bytes = 0; for (const [name, type] of document.share) { if (name === "paths") { if (!(type instanceof Y.Map)) throw fault("CRDT path index is invalid.", "invalid_collaboration_update", 400); continue; } if (!name.startsWith("file:") || !safePath(name.slice(5)) || !(type instanceof Y.Text)) throw fault("CRDT update addressed an unauthorized document.", "invalid_collaboration_update", 400); fileRoots.add(name.slice(5)); } for (const [path, active] of pathMap) { if (active !== true || !safePath(path) || !fileRoots.has(path)) throw fault("CRDT path index is invalid.", "invalid_collaboration_update", 400); paths.add(path); bytes += Buffer.byteLength(document.getText(`file:${path}`).toString()); } if (!paths.size || paths.size > 256) throw fault("Collaborative workspace has an invalid file count.", "invalid_collaboration_update", 400); if (bytes > 2 * 1024 * 1024) throw fault("Collaborative workspace exceeds 2 MiB.", "collaboration_workspace_too_large", 413); return paths; }
function validatePresence(value, paths) { if (!paths.has(value.path) || !Number.isInteger(value.anchor) || !Number.isInteger(value.head) || value.anchor < 0 || value.head < 0 || value.anchor > 10_000_000 || value.head > 10_000_000) throw fault("Cursor presence is invalid.", "invalid_collaboration_presence", 400); return { path: value.path, anchor: value.anchor, head: value.head, name: typeof value.name === "string" ? value.name.slice(0, 80) : "Collaborator" }; }
function decodeUpdate(value) { if (typeof value !== "string" || value.length > 192 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw fault("CRDT update is invalid.", "invalid_collaboration_update", 400); const bytes = Buffer.from(value, "base64"); if (!bytes.length || bytes.length > 128 * 1024) throw fault("CRDT update is invalid.", "invalid_collaboration_update", 400); return new Uint8Array(bytes); }
function sameOrigin(request) { try { const origin = new URL(String(request.headers.origin || "")), host = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim(); return origin.host === host && (request.headers["sec-fetch-site"] === undefined || request.headers["sec-fetch-site"] === "same-origin"); } catch { return false; } }
function send(websocket, value) { if (websocket.readyState === 1) websocket.send(JSON.stringify(value)); }
function reject(socket) { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); socket.destroy(); }
function json(response, status, value) { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); response.end(JSON.stringify(value)); }
async function readJson(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 64 * 1024) throw fault("Collaboration request is too large.", "collaboration_request_too_large", 413); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw fault("Collaboration request must be JSON.", "invalid_collaboration_request", 400); } }
function validId(value) { return typeof value === "string" && /^[-A-Za-z0-9_]{1,160}$/.test(value); }
function safePath(value) { return typeof value === "string" && value.length > 0 && value.length <= 240 && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some(part => !part || part === "." || part === "..") && SAFE_PATH.test(value); }
function foldersFromPaths(paths) { const folders = new Set(); for (const path of paths) { const parts = path.split("/").slice(0, -1); for (let index = 1; index <= parts.length; index++) folders.add(parts.slice(0, index).join("/")); } return [...folders].sort(); }
function hashToken(token) { return createHash("sha256").update(token).digest("hex"); }
function bounded(value, fallback, min, max) { const number = Number(value || fallback); return Number.isInteger(number) && number >= min && number <= max ? number : fallback; }
function fault(message, code, status) { return Object.assign(new Error(message), { code, status }); }
