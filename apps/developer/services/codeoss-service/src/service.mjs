import { randomBytes, randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, readdir, lstat, writeFile, readlink, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { OPENVSCODE, CORE_LIMITS } from "./upstream.mjs";
import { createCentralIdentityVerifier, fault } from "./central-identity.mjs";

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const LIVE = "'preparing','running','stopping','recovery-required'";

export function createCodeOSSService({ filename, root, workspaceStore, verifyIdentity = createCentralIdentityVerifier(),
  driver, launchURL, assertProjectQuiescent, limits = CORE_LIMITS, now = Date.now } = {}) {
  if (!workspaceStore || !root || !filename) throw new TypeError("CodeOSS durable store/root are required.");
  root = resolve(root);
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS codeoss_sessions(id TEXT PRIMARY KEY, owner TEXT NOT NULL, workspace_owner TEXT NOT NULL,
    project TEXT NOT NULL, generation INTEGER NOT NULL, account TEXT NOT NULL, expires_at INTEGER NOT NULL,
    revision INTEGER NOT NULL, snapshot TEXT NOT NULL, writer_token TEXT NOT NULL, status TEXT NOT NULL,
    runtime TEXT NOT NULL, failure TEXT, created_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS codeoss_project_writer ON codeoss_sessions(workspace_owner,project) WHERE status IN (${LIVE});`);
  db.exec("CREATE TABLE IF NOT EXISTS codeoss_projects(workspace_owner TEXT NOT NULL,project TEXT NOT NULL,directory TEXT NOT NULL,imported_revision INTEGER NOT NULL,checkpoint TEXT,adopted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(workspace_owner,project));");
  const tasks = new Map(), launches = new Map();
  const get = id => db.prepare("SELECT * FROM codeoss_sessions WHERE id=?").get(id);
  const active = (owner, project) => db.prepare(`SELECT * FROM codeoss_sessions WHERE workspace_owner=? AND project=? AND status IN (${LIVE})`).get(owner, project);

  function guardWorkspaceWrite(owner, project, writerToken) {
    const row = active(owner, project);
    if (row && row.writer_token !== writerToken)
      throw fault("The native IDE owns this project's files. Stop and synchronize it before editing here.", "core_writer_active");
  }

  async function identity(request) {
    let id;
    try { id = await verifyIdentity(request); }
    catch (error) { if (error.status === 401 && /^[a-f0-9]{64}$/.test(error.verifiedOwner || "")) await drainOwner(error.verifiedOwner); throw error; }
    if (!id || !/^[a-f0-9]{64}$/.test(id.owner || "") || !/^[a-f0-9]{64}$/.test(id.workspaceOwner || "") ||
      !Number.isSafeInteger(id.generation) || id.generation < 0 || typeof id.account !== "string" ||
      !Number.isFinite(id.expiresAt) || id.expiresAt <= now())
      throw fault("A current verified Wallet identity is required.", "core_identity_invalid", 401);
    return id;
  }

  function authorize(row, id) {
    if (!row || row.owner !== id.owner || row.workspace_owner !== id.workspaceOwner)
      throw fault("Native IDE session was not found.", "core_not_found", 404);
    if (id.allowedCoreSession && id.allowedCoreSession !== row.id) throw fault("This browser admission is bound to another native IDE session.", "core_not_found", 404);
    if (row.generation !== id.generation || row.account !== id.account || row.expires_at <= now())
      throw fault("This native IDE session's identity expired or changed. Its recovery files are retained.", "core_identity_changed", 401);
  }

  async function start(id, body) {
    if (!driver || typeof launchURL !== "function" || typeof assertProjectQuiescent !== "function") throw fault("Native IDE runtime and isolated launch proxy are not configured.", "core_runtime_unavailable", 503);
    if (!ID.test(body.projectId || "") || !Number.isSafeInteger(body.expectedRevision) ||
      body.approval !== "launch-native-ide-once") throw fault("Review this project's native IDE launch first.", "core_approval_required", 403);
    const snapshot = workspaceStore.get(id.workspaceOwner, body.projectId);
    if (!snapshot) throw fault("An explicitly bound Wallet workspace is required. Guest projects are preserved.", "core_workspace_not_found", 404);
    if (snapshot.revision !== body.expectedRevision) throw fault("Project changed before launch. Save and review again.", "revision_conflict");
    validateFiles(snapshot.files, limits);
    const sessionId = randomUUID(), token = randomBytes(32).toString("hex"), runtimeId = randomUUID();
    // Resolve admission before executing anything. A supplies an isolated origin
    // route, never a raw OpenVSCode token URL or the parent's authentication origin.
    const url = await launchURL({ owner: id.owner, projectId: body.projectId, runtimeId, sessionId });
    validateLaunchURL(url);
    db.exec("BEGIN IMMEDIATE");
    let claimed = false;
    try {
      if (active(id.workspaceOwner, body.projectId)) throw fault("This project already has a native IDE writer or protected recovery.", "core_writer_active");
      const total = Number(db.prepare(`SELECT COUNT(*) n FROM codeoss_sessions WHERE status IN (${LIVE})`).get().n);
      const owned = Number(db.prepare(`SELECT COUNT(*) n FROM codeoss_sessions WHERE owner=? AND status IN (${LIVE})`).get(id.owner).n);
      if (total >= limits.activeGlobal || owned >= limits.activePerOwner) throw fault("Native IDE capacity is full. Existing sessions are preserved.", "core_capacity_reached", 429);
      assertProjectQuiescent(id.workspaceOwner, body.projectId);
      workspaceStore.claimWriter(id.workspaceOwner, body.projectId, { writerToken: token, sessionId, expectedRevision: snapshot.revision });
      claimed = true;
      db.prepare("INSERT INTO codeoss_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(sessionId, id.owner, id.workspaceOwner,
        body.projectId, id.generation, id.account, Math.min(id.expiresAt, now() + limits.maxSessionMs), snapshot.revision,
        JSON.stringify(snapshot), token, "preparing", runtimeId, null, now());
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); if (claimed) workspaceStore.releaseWriter(id.workspaceOwner, body.projectId, token); throw error; }
    const context = runtimeContext(get(sessionId));
    const launch = (async () => { try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw fault("Native IDE state root is unsafe.", "core_state_unsafe", 503);
      await mkdir(context.directory, { mode: 0o700 }); // EEXIST never replaces an old recovery.
      const existing = db.prepare("SELECT * FROM codeoss_projects WHERE workspace_owner=? AND project=?").get(id.workspaceOwner, body.projectId);
      if (!existing) {
        await mkdir(join(root, "projects", id.workspaceOwner), { recursive: true, mode: 0o700 });
        if (driver.prepareProjectDirectory) await driver.prepareProjectDirectory(context);
        else await mkdir(context.projectDirectory, { mode: 0o700 });
        const source = join(context.projectDirectory, "workspace");
        await mkdir(source, { mode: 0o700 });
        for (const [path, content] of Object.entries(snapshot.files)) {
          const target = join(source, path);
          await mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
          const file = await open(target, "wx", 0o600);
          try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
        }
        await syncDirectory(source); await syncDirectory(context.projectDirectory);
        db.prepare("INSERT INTO codeoss_projects(workspace_owner,project,directory,imported_revision) VALUES(?,?,?,?)").run(id.workspaceOwner, body.projectId, context.projectDirectory, snapshot.revision);
      } else if (existing.directory !== context.projectDirectory) {
        throw fault("Native project volume identity changed.", "core_project_volume_mismatch", 409);
      } else if (!existing.adopted && existing.imported_revision !== snapshot.revision) {
        throw fault("The original project changed after an interrupted import. Both copies are preserved; review the staged import before adopting it.", "core_import_review_required", 409);
      }
      // Native volume is now the primary project file source. Preserve the old
      // JSON snapshot as an explicit compatibility/import record, never overwrite
      // binary/native files from a stale Monaco projection on future launches.
      await driver.start(context);
      workspaceStore.markNativeProject(id.workspaceOwner, body.projectId, token);
      db.prepare("UPDATE codeoss_projects SET adopted=1 WHERE workspace_owner=? AND project=?").run(id.workspaceOwner, body.projectId);
      db.prepare("UPDATE codeoss_sessions SET status='running' WHERE id=?").run(sessionId);
      return publicSession(get(sessionId));
    } catch (error) {
      // Launch might have succeeded before a transport failure. Retain exact
      // identity and writer until driver proves that runtime fully stopped.
      db.prepare("UPDATE codeoss_sessions SET status='recovery-required',failure=? WHERE id=?").run(error.code || "core_launch_failed", sessionId);
      throw fault("Native IDE launch could not be confirmed. Retry Stop to preserve and synchronize its files.", "core_launch_recovery_required", 503);
    } })();
    launches.set(sessionId, launch);
    try { return await launch; } finally { launches.delete(sessionId); }
  }

  function runtimeContext(row) {
    return Object.freeze({ sessionId: row.id, owner: row.owner, projectId: row.project, runtimeId: row.runtime,
      directory: join(root, row.id), projectDirectory: join(root, "projects", row.workspace_owner, createHash("sha256").update(row.project).digest("hex")), image: driver?.upstream || OPENVSCODE, limits, identityDigest: createHash("sha256")
        .update(`${row.owner}\n${row.project}\n${row.runtime}\n${row.id}`).digest("hex") });
  }

  async function stop(row) {
    if (row.status === "stopped") return publicSession(row);
    if (tasks.has(row.id)) return tasks.get(row.id);
    const task = (async () => {
      try {
        // Stop cannot prove absence or release the writer while a delayed
        // start may still execute. Serialize launch settlement before stopping.
        await launches.get(row.id)?.catch(() => {});
        db.prepare("UPDATE codeoss_sessions SET status='stopping' WHERE id=?").run(row.id);
        if (!driver) throw fault("Native IDE stop driver is unavailable.", "core_runtime_unavailable", 503);
        const context = runtimeContext(row), stopped = await driver.stop(context);
        if (stopped?.stopped !== true || stopped.runtimeId !== row.runtime || stopped.identityDigest !== context.identityDigest)
          throw fault("Native IDE exact runtime and child-empty stop proof is required.", "core_processes_unconfirmed", 503);
        if (!stopped.neverStarted) {
          workspaceStore.markNativeProject(row.workspace_owner, row.project, row.writer_token);
          db.prepare("UPDATE codeoss_projects SET adopted=1 WHERE workspace_owner=? AND project=?").run(row.workspace_owner, row.project);
        }
        let manifest;
        try { manifest = await collectManifest(join(context.projectDirectory, "workspace"), limits); }
        catch (error) { if (stopped.neverStarted === true && error.code === "ENOENT") manifest = { neverStarted: true, entries: [] }; else throw error; }
        const checkpoint = join(root, row.id, `checkpoint-${randomUUID()}.json`);
        const file = await open(checkpoint, "wx", 0o600);
        try { await file.writeFile(JSON.stringify({ projectId: row.project, runtimeId: row.runtime, importedRevision: row.revision,
          storage: "native-volume", manifest })); await file.sync(); } finally { await file.close(); }
        await syncDirectory(join(root, row.id));
        db.prepare("UPDATE codeoss_projects SET checkpoint=? WHERE workspace_owner=? AND project=?").run(checkpoint, row.workspace_owner, row.project);
        workspaceStore.releaseWriter(row.workspace_owner, row.project, row.writer_token);
        db.prepare("UPDATE codeoss_sessions SET status='stopped',failure=NULL WHERE id=?").run(row.id);
        return { ...publicSession(get(row.id)), storage: "native-volume", checkpointed: true };
      } catch (error) {
        db.prepare("UPDATE codeoss_sessions SET status='recovery-required',failure=? WHERE id=?").run(error.code || "core_stop_failed", row.id);
        throw fault(error.message || "Native IDE stop failed. Files and writer are retained.", error.code || "core_stop_failed", error.status || 503);
      }
    })();
    tasks.set(row.id, task);
    try { return await task; } finally { tasks.delete(row.id); }
  }

  async function handler(request, response) {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path !== "/runtime/codeoss" && !/^\/runtime\/codeoss\/[a-f0-9-]{36}$/.test(path)) return false;
    try {
      const id = await identity(request);
      if (path === "/runtime/codeoss" && request.method === "GET") {
        const selectedProject = new URL(request.url, "http://localhost").searchParams.get("projectId");
        const project = selectedProject && ID.test(selectedProject) ? workspaceStore.get(id.workspaceOwner, selectedProject) : null;
        const sessions = db.prepare("SELECT * FROM codeoss_sessions WHERE owner=? AND workspace_owner=? ORDER BY created_at DESC LIMIT 100").all(id.owner, id.workspaceOwner).map(publicSession);
        json(response, 200, { kernel: OPENVSCODE.version, license: OPENVSCODE.license, limits,
          capacityScope: "single-durable-broker", capacityVerified: false, sessions,
          configured: Boolean(driver && launchURL), walletProjectExists: Boolean(project), projectRevision: project?.revision || 0,
          walletProjects: workspaceStore.listProjects(id.workspaceOwner),
          nativeProjects: db.prepare("SELECT project FROM codeoss_projects WHERE workspace_owner=? AND adopted=1").all(id.workspaceOwner).map(row => row.project) });
      } else if (path === "/runtime/codeoss" && request.method === "POST") {
        json(response, 201, { session: await start(id, await bodyJSON(request)) });
      } else if (request.method === "DELETE" && path !== "/runtime/codeoss") {
        const row = get(path.split("/").at(-1)); authorize(row, id);
        json(response, 200, { session: await stop(row) });
      } else throw fault("Method not allowed.", "method_not_allowed", 405);
    } catch (error) { json(response, error.status || 503, { error: error.message, code: error.code || "core_unavailable" }); }
    return true;
  }

  // A's isolated-origin proxy calls this on every HTTP request/WS admission;
  // it must not bypass this check merely because a connection token is valid.
  async function authorizeConnection(request, sessionId) {
    const id = await identity(request), row = get(sessionId); authorize(row, id);
    if (row.status !== "running") throw fault("Native IDE is not running.", "core_not_running");
    return { context: runtimeContext(row), expiresAt: row.expires_at, identity: id };
  }
  async function expireSessions() {
    const rows = db.prepare(`SELECT * FROM codeoss_sessions WHERE expires_at<=? AND status IN (${LIVE})`).all(now());
    return Promise.allSettled(rows.map(stop));
  }
  async function drain() {
    const rows = db.prepare(`SELECT * FROM codeoss_sessions WHERE status IN (${LIVE})`).all();
    const results = await Promise.allSettled(rows.map(stop));
    if (results.some(result => result.status === "rejected")) throw fault("Native IDE drain retained protected recovery.", "core_drain_incomplete", 503);
  }
  async function drainOwner(owner) {
    const rows = db.prepare(`SELECT * FROM codeoss_sessions WHERE owner=? AND status IN (${LIVE})`).all(owner);
    return Promise.allSettled(rows.map(stop));
  }
  return { handler, guardWorkspaceWrite, authorizeConnection, expireSessions, drain, drainOwner, close: () => db.close() };
}

function publicSession(row) { return { sessionId: row.id, projectId: row.project, runtimeId: row.runtime,
  status: row.status, failure: row.failure, expectedRevision: row.revision, expiresAt: row.expires_at,
  ...(row.status === "running" ? { launchURL: `/sso/core-open?sessionId=${row.id}` } : {}) }; }
export function validateFiles(files, limits = CORE_LIMITS) {
  if (!files || typeof files !== "object" || Array.isArray(files)) throw fault("Project files are invalid.", "core_files_invalid", 400);
  const entries = Object.entries(files);
  if (entries.length > limits.files || Buffer.byteLength(JSON.stringify(files)) > limits.sourceBytes)
    throw fault("Project exceeds the native IDE source quota.", "core_source_quota", 413);
  for (const [path, content] of entries) if (typeof content !== "string" || !path || path.length > 240 ||
    !/^[A-Za-z0-9_./ +@-]+$/.test(path) || path.split("/").some(part => !part || part === "." || part === ".."))
    throw fault("Project file path is unsafe.", "core_files_invalid", 400);
}
async function collectManifest(root, limits) {
  const entries = []; let bytes = 0;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), rel = relative(root, path).split(sep).join("/");
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) { entries.push({ path: rel, type: "symlink", target: await readlink(path) }); continue; }
      if (!stat.isFile() && !stat.isDirectory()) throw fault("Native IDE source contains an unsupported special file. Its volume is preserved.", "core_files_invalid");
      if (stat.isDirectory()) {
        await walk(path);
        await syncDirectory(path);
      } else {
        bytes += stat.size;
        if (bytes > limits.diskBytes || entries.length >= 100_000) throw fault("Native IDE checkpoint exceeds its storage quota. Original files remain in the volume.", "core_disk_quota", 413);
        const digest = createHash("sha256");
        for await (const chunk of createReadStream(path)) digest.update(chunk);
        const file = await open(path, "r"); try { await file.sync(); } finally { await file.close(); }
        entries.push({ path: rel, type: "file", bytes: stat.size, sha256: digest.digest("hex") });
      }
    }
  }
  await walk(root); await syncDirectory(root); return { bytes, entries };
}
async function syncDirectory(path) { const directory = await open(path, "r"); try { await directory.sync(); } finally { await directory.close(); } }
function validateLaunchURL(value) {
  let url; try { url = new URL(value); } catch { throw fault("Isolated native IDE launch route is unavailable.", "core_proxy_unavailable", 503); }
  if (url.protocol !== "https:" || url.hostname === "developer.ynxweb4.com" || url.username || url.password || url.search || url.hash)
    throw fault("Native IDE requires an isolated, token-free HTTPS launch origin.", "core_proxy_unavailable", 503);
}
async function bodyJSON(request) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 8192) throw fault("Launch request is too large.", "body_too_large", 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw fault("Launch request must be JSON.", "invalid_json", 400); }
}
function json(response, status, value) { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" }); response.end(JSON.stringify(value)); }
