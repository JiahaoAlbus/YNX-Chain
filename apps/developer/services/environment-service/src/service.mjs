import { DatabaseSync } from "node:sqlite";

const PROTOCOL = "ynx-code-environment/v1";
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;
const RESERVED = new Set(["PATH", "HOME", "SHELL", "PWD", "OLDPWD", "TMPDIR", "TERM", "COLORTERM", "LANG", "LC_ALL", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "NODE_OPTIONS", "GOCACHE", "GOMODCACHE", "CARGO_HOME", "RUSTUP_HOME"]);

export function createEnvironmentService({ filename, ownerForRequest, secretResolver }) {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS project_environments(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,revision INTEGER NOT NULL,entries TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,project_id));");
  const read = db.prepare("SELECT revision,entries,updated_at FROM project_environments WHERE owner_id=? AND project_id=?"),
    insert = db.prepare("INSERT INTO project_environments(owner_id,project_id,revision,entries,updated_at) VALUES(?,?,?,?,?)"),
    update = db.prepare("UPDATE project_environments SET revision=?,entries=?,updated_at=? WHERE owner_id=? AND project_id=? AND revision=?");

  function get(owner, projectId) {
    validateIdentity(owner, projectId);
    const row = read.get(owner, projectId);
    return row ? publicRecord(row) : { revision: 0, updatedAt: null, entries: [] };
  }

  function put(owner, projectId, value) {
    validateIdentity(owner, projectId);
    if (value?.protocolVersion !== PROTOCOL || value.approval !== "update-environment-once" || !Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) throw fault("A versioned one-time environment update is required.", "invalid_environment_request", 400);
    const entries = validateEntries(value.entries),
      serialized = JSON.stringify(entries),
      updatedAt = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = read.get(owner, projectId),
        revision = Number(current?.revision || 0);
      if (revision !== value.expectedRevision) throw fault("Environment revision changed. Reload before saving.", "environment_revision_conflict", 409, { currentRevision: revision });
      const next = revision + 1;
      if (current) {
        const result = update.run(next, serialized, updatedAt, owner, projectId, revision);
        if (Number(result.changes) !== 1) throw fault("Environment revision changed. Reload before saving.", "environment_revision_conflict", 409);
      } else insert.run(owner, projectId, next, serialized, updatedAt);
      db.exec("COMMIT");
      return { revision: next, updatedAt, entries };
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  async function resolve(owner, projectId) {
    const record = get(owner, projectId),
      environment = {};
    for (const entry of record.entries) {
      if (entry.kind === "literal") environment[entry.key] = entry.value;
      else {
        if (typeof secretResolver !== "function") throw fault(`Secret reference ${entry.reference} cannot be resolved on this host.`, "secret_resolver_unavailable", 503);
        const value = await secretResolver({
          owner,
          projectId,
          reference: entry.reference,
          key: entry.key,
        });
        if (typeof value !== "string" || Buffer.byteLength(value) > 16 * 1024) throw fault(`Secret reference ${entry.reference} did not resolve to a bounded value.`, "secret_resolution_failed", 503);
        environment[entry.key] = value;
      }
    }
    return { revision: record.revision, environment };
  }

  async function handler(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`),
      match = url.pathname.match(/^\/runtime\/projects\/([A-Za-z0-9_-]{1,160})\/environment$/);
    if (!match) return false;
    const owner = ownerForRequest(request);
    if (!owner)
      return json(response, 401, {
        error: "A signed workspace session is required.",
        code: "workspace_session_required",
      });
    try {
      if (request.method === "GET")
        return json(response, 200, {
          protocolVersion: PROTOCOL,
          environment: get(owner, match[1]),
        });
      if (request.method === "PUT") {
        const body = JSON.parse((await readBody(request)).toString("utf8"));
        return json(response, 200, {
          protocolVersion: PROTOCOL,
          environment: put(owner, match[1], body),
        });
      }
      return json(response, 405, {
        error: "Method not allowed.",
        code: "method_not_allowed",
      });
    } catch (error) {
      return json(response, error.status || 400, {
        error: error.message || "Environment operation failed.",
        code: error.code || "environment_failed",
        ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
      });
    }
  }

  return {
    handler,
    get,
    put,
    resolve,
    close: () => db.close(),
    protocolVersion: PROTOCOL,
  };
}

function validateIdentity(owner, projectId) {
  if (!SAFE_ID.test(owner || "") || !SAFE_ID.test(projectId || "")) throw fault("Invalid environment owner or project.", "invalid_environment_identity", 400);
}
function validateEntries(value) {
  if (!Array.isArray(value) || value.length > 32) throw fault("Environment must contain at most 32 entries.", "invalid_environment_entries", 400);
  const keys = new Set(),
    entries = [];
  let bytes = 0;
  for (const entry of value) {
    if (!entry || !SAFE_KEY.test(entry.key || "") || RESERVED.has(entry.key) || keys.has(entry.key)) throw fault("Environment contains an invalid, duplicate, or reserved key.", "invalid_environment_key", 400);
    keys.add(entry.key);
    if (entry.kind === "literal" && typeof entry.value === "string" && entry.value.length <= 4096 && !entry.value.includes("\0")) entries.push({ key: entry.key, kind: "literal", value: entry.value });
    else if (entry.kind === "secret-reference" && SAFE_REFERENCE.test(entry.reference || ""))
      entries.push({
        key: entry.key,
        kind: "secret-reference",
        reference: entry.reference,
      });
    else throw fault("Environment entries must be bounded non-sensitive values or Secret references.", "invalid_environment_entry", 400);
    bytes += Buffer.byteLength(JSON.stringify(entries.at(-1)));
    if (bytes > 16 * 1024) throw fault("Environment exceeds 16 KiB.", "environment_too_large", 413);
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}
function publicRecord(row) {
  return {
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    entries: JSON.parse(row.entries),
  };
}
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) throw fault("Environment request exceeds 32 KiB.", "environment_request_too_large", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
  return true;
}
function fault(message, code, status, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}
