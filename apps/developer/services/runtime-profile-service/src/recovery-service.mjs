import { createHash, randomUUID } from "node:crypto";
import { validateRecoverySnapshot } from "./recovery-snapshot.mjs";

export function createRecoveryService({ db, journal, readSnapshot, isActive = () => false }) {
  db.exec("CREATE TABLE IF NOT EXISTS recovery_copies(owner_id TEXT NOT NULL,runtime_id TEXT NOT NULL,recovery_id TEXT NOT NULL,copy_id TEXT NOT NULL,created_at TEXT NOT NULL,sha256 TEXT NOT NULL,file_count INTEGER NOT NULL,bytes INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner_id,copy_id))");
  if (!db.prepare("PRAGMA table_info(recovery_copies)").all().some(column => column.name === "project_id")) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("ALTER TABLE recovery_copies ADD COLUMN project_id TEXT NOT NULL DEFAULT ''");
      const update = db.prepare("UPDATE recovery_copies SET project_id=? WHERE owner_id=? AND copy_id=?");
      for (const row of db.prepare("SELECT owner_id,copy_id,payload FROM recovery_copies").iterate()) {
        const projectId = JSON.parse(row.payload).projectId;
        if (typeof projectId !== "string" || !projectId || projectId.length > 240) throw new Error("Recovery copy has no valid project identity");
        update.run(projectId, row.owner_id, row.copy_id);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  const fields = "copy_id,created_at,sha256,file_count,bytes,recovery_id,project_id,runtime_id";
  const all = db.prepare(`SELECT ${fields} FROM recovery_copies WHERE owner_id=? AND runtime_id=? ORDER BY created_at DESC`);
  const currentCopies = db.prepare(`SELECT ${fields} FROM recovery_copies WHERE owner_id=? AND runtime_id=? AND recovery_id=? ORDER BY created_at DESC`);
  const read = db.prepare("SELECT payload FROM recovery_copies WHERE owner_id=? AND runtime_id=? AND copy_id=?");
  const count = db.prepare("SELECT COUNT(*) AS count FROM recovery_copies"), ownerCount = db.prepare("SELECT COUNT(*) AS count FROM recovery_copies WHERE owner_id=?");
  const insert = db.prepare("INSERT INTO recovery_copies(owner_id,runtime_id,recovery_id,copy_id,created_at,sha256,file_count,bytes,payload,project_id) VALUES(?,?,?,?,?,?,?,?,?,?)"), collecting = new Set(), reservations = new Map();
  const fault = (code, status, error) => Object.assign(new Error(error), { code, status });
  const send = (res, status, value, headers = {}) => {
    if (res.destroyed || res.writableEnded || res.headersSent) return;
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }); res.end(JSON.stringify(value));
  };
  function metadata(row) { return { copyId: row.copy_id, projectId: row.project_id, runtimeId: row.runtime_id, recoveryId: row.recovery_id, createdAt: row.created_at, sha256: row.sha256, fileCount: row.file_count, bytes: row.bytes, consistency: "unverified-live-copy" }; }
  function copies(owner, runtimeId, token) {
    return { copies: currentCopies.all(owner, runtimeId, token).map(metadata), previousCopies: all.all(owner, runtimeId).filter(row => row.recovery_id !== token).map(metadata) };
  }
  function current(owner, runtimeId) {
    const value = journal.get(owner, runtimeId);
    if (!value) throw fault("recovery_not_found", 404, "Recovery was not found for this workspace session.");
    return value;
  }
  async function handler(request, response, url, owner) {
    const match = url.pathname.match(/^\/runtime\/profiles\/recovery(?:\/((?:ssh-)?[a-f0-9]{24})(?:\/copies(?:\/([0-9a-f-]{36}))?)?)?$/);
    if (!match) return false;
    try {
      if (!match[1] && request.method === "GET") {
        send(response, 200, { entries: journal.list(owner).map(row => ({ runtimeId: row.runtime_id, projectId: row.project_id, recoveryId: row.token,
          openedAt: row.opened_at, status: isActive(owner, row.runtime_id) ? "active" : "protected", stopProof: "unavailable", ...copies(owner, row.runtime_id, row.token) })) }); return true;
      }
      const runtimeId = match[1];
      if (match[2] && request.method === "GET") {
        const copy = read.get(owner, runtimeId, match[2]); if (!copy) throw fault("recovery_copy_not_found", 404, "Recovery copy was not found.");
        send(response, 200, JSON.parse(copy.payload), { "content-disposition": `attachment; filename="ynx-recovery-${match[2]}.json"` }); return true;
      }
      const record = current(owner, runtimeId);
      if (request.method === "GET") {
        send(response, 200, { runtimeId, projectId: record.project_id, recoveryId: record.token, openedAt: record.opened_at,
          status: isActive(owner, runtimeId) ? "active" : "protected", stopProof: "unavailable", canClearProtection: false,
          explanation: "The remote process group has no verified stop receipt. Files remain protected. You may collect a read-only recovery copy; it does not prove all writes have finished.", ...copies(owner, runtimeId, record.token) }); return true;
      }
      if (request.method !== "POST" || !url.pathname.endsWith("/copies") || match[2]) throw fault("method_not_allowed", 405, "Method not allowed.");
      let body = ""; for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 4096) throw fault("recovery_request_too_large", 413, "Recovery request exceeds its boundary."); }
      let input; try { input = JSON.parse(body); } catch { throw fault("invalid_recovery_request", 400, "Recovery request must contain valid JSON."); }
      if (!input || typeof input !== "object" || Array.isArray(input) || input.protocolVersion !== "ynx-code-recovery/v1" || input.approval !== "collect-recovery-copy-once" || input.recoveryId !== record.token || current(owner, runtimeId).token !== record.token)
        throw fault("recovery_changed", 409, "Reload this recovery before approving a copy.");
      if (isActive(owner, runtimeId)) throw fault("runtime_active", 409, "This interactive session is still active; stop it before collecting a recovery copy.");
      const identity = JSON.stringify([owner, runtimeId]);
      if (collecting.has(identity)) throw fault("recovery_copy_busy", 409, "A copy of this runtime is already being collected.");
      if (all.all(owner, runtimeId).length >= 4 || ownerCount.get(owner).count + (reservations.get(owner) || 0) >= 16 || count.get().count + collecting.size >= 256)
        throw fault("recovery_capacity", 429, "Recovery copy capacity is full. Existing copies and remote files remain retained.");
      collecting.add(identity); reservations.set(owner, (reservations.get(owner) || 0) + 1);
      try {
        const signal = request.maintenanceSignal ? AbortSignal.any([request.maintenanceSignal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
        if (signal.aborted) throw fault("recovery_interrupted", 503, "Collection was interrupted. Existing copies and remote files remain retained.");
        const snapshot = validateRecoverySnapshot(await readSnapshot(owner, runtimeId, record, signal));
        if (signal.aborted) throw fault("recovery_interrupted", 503, "Collection was interrupted. Existing copies and remote files remain retained.");
        if (current(owner, runtimeId).token !== record.token) throw fault("recovery_changed", 409, "The recovery changed during collection; its protection remains in place.");
        const copyId = randomUUID(), createdAt = new Date().toISOString();
        const payload = { protocolVersion: "ynx-code-recovery/v1", projectId: record.project_id, runtimeId, recoveryId: record.token, copyId, createdAt,
          consistency: "unverified-live-copy", protectionRetained: true, ...snapshot };
        const serialized = JSON.stringify(payload), sha256 = createHash("sha256").update(serialized).digest("hex");
        insert.run(owner, runtimeId, record.token, copyId, createdAt, sha256, snapshot.fileCount, snapshot.bytes, serialized, record.project_id);
        send(response, 201, { copy: metadata({ copy_id: copyId, project_id: record.project_id, runtime_id: runtimeId, recovery_id: record.token, created_at: createdAt, sha256, file_count: snapshot.fileCount, bytes: snapshot.bytes }), protectionRetained: true });
      } finally {
        collecting.delete(identity); const left = reservations.get(owner) - 1; if (left) reservations.set(owner, left); else reservations.delete(owner);
      }
    } catch (error) {
      const known = ["recovery_not_found", "recovery_copy_not_found", "method_not_allowed", "recovery_request_too_large", "invalid_recovery_request", "recovery_changed", "runtime_active", "recovery_copy_busy", "recovery_capacity", "recovery_interrupted"].includes(error?.code);
      send(response, known ? error.status : 503, { code: known ? error.code : "recovery_copy_unavailable", error: known ? error.message : "A bounded recovery copy is unavailable. The remote files and protection remain in place.", protectionRetained: true });
    }
    return true;
  }
  return { handler };
}
