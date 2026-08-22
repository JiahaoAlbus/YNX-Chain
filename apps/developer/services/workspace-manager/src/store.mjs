import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const REVISION_RETENTION = 50;

export function createWorkspaceStore({ filename }) {
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspaces(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner_id,project_id)); CREATE TABLE IF NOT EXISTS workspace_mutations(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,request_hash TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner_id,project_id,idempotency_key)); CREATE TABLE IF NOT EXISTS workspace_revisions(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,source TEXT NOT NULL,restored_from INTEGER,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,project_id,revision)); CREATE INDEX IF NOT EXISTS workspace_revision_history ON workspace_revisions(owner_id,project_id,revision DESC); CREATE TABLE IF NOT EXISTS workspace_approvals(owner_id TEXT NOT NULL,approval_id TEXT NOT NULL,action TEXT NOT NULL,project_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,approval_id));",
  );
  const read = db.prepare(
      "SELECT revision,payload,updated_at FROM workspaces WHERE owner_id=? AND project_id=?",
    ),
    readAllCurrent = db.prepare(
      "SELECT owner_id,project_id,revision,payload,updated_at FROM workspaces",
    ),
    mutation = db.prepare(
      "SELECT request_hash,revision FROM workspace_mutations WHERE owner_id=? AND project_id=? AND idempotency_key=?",
    ),
    insert = db.prepare(
      "INSERT INTO workspaces(owner_id,project_id,revision,payload,updated_at) VALUES(?,?,?,?,?)",
    ),
    update = db.prepare(
      "UPDATE workspaces SET revision=?,payload=?,updated_at=? WHERE owner_id=? AND project_id=? AND revision=?",
    ),
    record = db.prepare(
      "INSERT INTO workspace_mutations(owner_id,project_id,idempotency_key,request_hash,revision) VALUES(?,?,?,?,?)",
    ),
    insertRevision = db.prepare(
      "INSERT OR IGNORE INTO workspace_revisions(owner_id,project_id,revision,payload,digest,source,restored_from,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ),
    readRevision = db.prepare(
      "SELECT revision,payload,digest,source,restored_from,created_at FROM workspace_revisions WHERE owner_id=? AND project_id=? AND revision=?",
    ),
    listRevisions = db.prepare(
      "SELECT revision,payload,digest,source,restored_from,created_at FROM workspace_revisions WHERE owner_id=? AND project_id=? ORDER BY revision DESC LIMIT ? OFFSET ?",
    ),
    countRevisions = db.prepare(
      "SELECT COUNT(*) count FROM workspace_revisions WHERE owner_id=? AND project_id=?",
    ),
    pruneRevisions = db.prepare(
      "DELETE FROM workspace_revisions WHERE owner_id=? AND project_id=? AND revision NOT IN (SELECT revision FROM workspace_revisions WHERE owner_id=? AND project_id=? ORDER BY revision DESC LIMIT ?)",
    ),
    getApproval = db.prepare(
      "SELECT action,project_id FROM workspace_approvals WHERE owner_id=? AND approval_id=?",
    ),
    insertApproval = db.prepare(
      "INSERT INTO workspace_approvals(owner_id,approval_id,action,project_id,created_at) VALUES(?,?,?,?,?)",
    );

  for (const row of readAllCurrent.all())
    insertRevision.run(
      row.owner_id,
      row.project_id,
      row.revision,
      row.payload,
      sha(row.payload),
      "legacy-backfill",
      null,
      row.updated_at,
    );

  function get(ownerId, projectId) {
    validateId(ownerId, "owner");
    validateId(projectId, "project");
    const row = read.get(ownerId, projectId);
    return row
      ? {
          revision: Number(row.revision),
          updatedAt: row.updated_at,
          ...JSON.parse(row.payload),
        }
      : null;
  }

  function put(ownerId, projectId, { expectedRevision, idempotencyKey, payload }) {
    validateId(ownerId, "owner");
    validateId(projectId, "project");
    validateRevision(expectedRevision);
    validateIdempotencyKey(idempotencyKey);
    validatePayload(payload);
    const serialized = JSON.stringify(payload),
      requestHash = sha(`${expectedRevision}:${serialized}`);
    db.exec("BEGIN IMMEDIATE");
    try {
      const replay = replayedMutation(
        ownerId,
        projectId,
        idempotencyKey,
        requestHash,
      );
      if (replay) {
        db.exec("COMMIT");
        return replay;
      }
      const current = read.get(ownerId, projectId),
        revision = Number(current?.revision || 0);
      if (revision !== expectedRevision)
        throw fault(
          "Workspace revision changed. Reload before saving.",
          "revision_conflict",
          409,
          { currentRevision: revision },
        );
      const saved = writeRevision({
        ownerId,
        projectId,
        current,
        payload: serialized,
        source: "mutation",
        restoredFrom: null,
      });
      record.run(ownerId, projectId, idempotencyKey, requestHash, saved.revision);
      prune(ownerId, projectId);
      db.exec("COMMIT");
      return { ...saved, replayed: false };
    } catch (error) {
      rollback();
      throw error;
    }
  }

  function restore(
    ownerId,
    projectId,
    { expectedRevision, sourceRevision, idempotencyKey, approvalId },
  ) {
    validateId(ownerId, "owner");
    validateId(projectId, "project");
    validateRevision(expectedRevision);
    if (!Number.isInteger(sourceRevision) || sourceRevision < 1)
      throw fault(
        "A positive source revision is required.",
        "invalid_source_revision",
        400,
      );
    validateIdempotencyKey(idempotencyKey);
    validateApprovalId(approvalId);
    const requestHash = sha(`${expectedRevision}:restore:${sourceRevision}`);
    db.exec("BEGIN IMMEDIATE");
    try {
      const replay = replayedMutation(
        ownerId,
        projectId,
        idempotencyKey,
        requestHash,
      );
      if (replay) {
        db.exec("COMMIT");
        return { ...replay, restoredFrom: sourceRevision };
      }
      const current = read.get(ownerId, projectId),
        revision = Number(current?.revision || 0),
        source = readRevision.get(ownerId, projectId, sourceRevision);
      if (revision !== expectedRevision)
        throw fault(
          "Workspace revision changed after restore review.",
          "revision_conflict",
          409,
          { currentRevision: revision },
        );
      if (!source)
        throw fault(
          "The selected workspace revision is not retained.",
          "workspace_revision_not_found",
          404,
        );
      if (getApproval.get(ownerId, approvalId))
        throw fault(
          "This one-time restore approval was already consumed.",
          "approval_replayed",
          409,
        );
      insertApproval.run(
        ownerId,
        approvalId,
        "workspace-restore",
        projectId,
        new Date().toISOString(),
      );
      const saved = writeRevision({
        ownerId,
        projectId,
        current,
        payload: source.payload,
        source: "restore",
        restoredFrom: sourceRevision,
      });
      record.run(ownerId, projectId, idempotencyKey, requestHash, saved.revision);
      prune(ownerId, projectId);
      db.exec("COMMIT");
      return {
        ...saved,
        restoredFrom: sourceRevision,
        approval: "restore-workspace-once",
        replayed: false,
      };
    } catch (error) {
      rollback();
      throw error;
    }
  }

  function history(ownerId, projectId, cursor = 0, limit = 20) {
    validateId(ownerId, "owner");
    validateId(projectId, "project");
    cursor = Math.max(0, Number(cursor) || 0);
    limit = Math.max(1, Math.min(Number(limit) || 20, 50));
    const total = Number(countRevisions.get(ownerId, projectId).count),
      revisions = listRevisions
        .all(ownerId, projectId, limit, cursor)
        .map(revisionMetadata);
    return {
      revisions,
      cursor,
      nextCursor: cursor + revisions.length < total ? cursor + revisions.length : null,
      retention: {
        mode: "latest-revisions",
        maximumRevisions: REVISION_RETENTION,
        retainedRevisions: total,
      },
    };
  }

  function snapshot(ownerId, projectId, revision) {
    validateId(ownerId, "owner");
    validateId(projectId, "project");
    if (!Number.isInteger(revision) || revision < 1)
      throw fault(
        "A positive workspace revision is required.",
        "invalid_revision",
        400,
      );
    const row = readRevision.get(ownerId, projectId, revision);
    if (!row)
      throw fault(
        "The selected workspace revision is not retained.",
        "workspace_revision_not_found",
        404,
      );
    return revisionValue(row);
  }

  function replayedMutation(ownerId, projectId, idempotencyKey, requestHash) {
    const previous = mutation.get(ownerId, projectId, idempotencyKey);
    if (!previous) return null;
    if (previous.request_hash !== requestHash)
      throw fault(
        "Idempotency key was already used for a different mutation.",
        "idempotency_conflict",
        409,
      );
    const row = readRevision.get(ownerId, projectId, previous.revision),
      fallback = read.get(ownerId, projectId);
    if (!row && !fallback)
      throw fault("Workspace was not found.", "workspace_not_found", 404);
    if (!row && Number(fallback.revision) !== Number(previous.revision))
      throw fault(
        "The idempotent mutation result is outside retained workspace history.",
        "idempotency_replay_expired",
        409,
      );
    return {
      ...(row
        ? revisionValue(row)
        : {
            revision: Number(fallback.revision),
            updatedAt: fallback.updated_at,
            ...JSON.parse(fallback.payload),
          }),
      replayed: true,
    };
  }

  function writeRevision({
    ownerId,
    projectId,
    current,
    payload,
    source,
    restoredFrom,
  }) {
    const revision = Number(current?.revision || 0) + 1,
      now = new Date().toISOString();
    if (current) {
      const result = update.run(
        revision,
        payload,
        now,
        ownerId,
        projectId,
        current.revision,
      );
      if (result.changes !== 1)
        throw fault(
          "Workspace revision changed. Reload before saving.",
          "revision_conflict",
          409,
        );
    } else insert.run(ownerId, projectId, revision, payload, now);
    insertRevision.run(
      ownerId,
      projectId,
      revision,
      payload,
      sha(payload),
      source,
      restoredFrom,
      now,
    );
    return {
      revision,
      updatedAt: now,
      ...JSON.parse(payload),
    };
  }

  function prune(ownerId, projectId) {
    pruneRevisions.run(
      ownerId,
      projectId,
      ownerId,
      projectId,
      REVISION_RETENTION,
    );
  }

  function rollback() {
    try {
      db.exec("ROLLBACK");
    } catch {}
  }

  return {
    get,
    put,
    restore,
    history,
    snapshot,
    close: () => db.close(),
  };
}

function revisionMetadata(row) {
  const payload = JSON.parse(row.payload);
  return {
    revision: Number(row.revision),
    createdAt: row.created_at,
    source: row.source,
    restoredFrom: row.restored_from == null ? null : Number(row.restored_from),
    digest: row.digest,
    name: payload.name,
    files: Object.keys(payload.files).length,
    bytes: Buffer.byteLength(JSON.stringify(payload.files)),
  };
}

function revisionValue(row) {
  return {
    revision: Number(row.revision),
    updatedAt: row.created_at,
    source: row.source,
    restoredFrom: row.restored_from == null ? null : Number(row.restored_from),
    digest: row.digest,
    ...JSON.parse(row.payload),
  };
}

function validateId(value, label) {
  if (typeof value !== "string" || !/^[-A-Za-z0-9_]{1,160}$/.test(value))
    throw fault(`Invalid ${label} identifier.`, `invalid_${label}`, 400);
}

function validateRevision(value) {
  if (!Number.isInteger(value) || value < 0)
    throw fault(
      "A non-negative expected revision is required.",
      "invalid_revision",
      400,
    );
}

function validateIdempotencyKey(value) {
  if (typeof value !== "string" || !/^[-A-Za-z0-9_]{8,160}$/.test(value))
    throw fault(
      "A valid idempotency key is required.",
      "invalid_idempotency_key",
      400,
    );
}

function validateApprovalId(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw fault(
      "A unique restore approval identifier is required.",
      "approval_id_required",
      403,
    );
}

function validatePayload(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.name !== "string" ||
    value.name.length > 160 ||
    !value.files ||
    typeof value.files !== "object" ||
    Array.isArray(value.files) ||
    !Array.isArray(value.folders) ||
    !Array.isArray(value.open) ||
    typeof value.active !== "string"
  )
    throw fault("Invalid workspace snapshot.", "invalid_workspace_snapshot", 400);
  const paths = [
    ...Object.keys(value.files),
    ...value.folders,
    ...value.open,
    value.active,
  ].filter(Boolean);
  if (
    Object.keys(value.files).length > 256 ||
    Buffer.byteLength(JSON.stringify(value.files)) > 2 * 1024 * 1024 ||
    paths.some((path) => !safePath(path))
  )
    throw fault(
      "Workspace snapshot exceeds its path, file or size boundary.",
      "invalid_workspace_snapshot",
      400,
    );
  if (Object.values(value.files).some((content) => typeof content !== "string"))
    throw fault(
      "Workspace files must contain text.",
      "invalid_workspace_snapshot",
      400,
    );
}

function safePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").some((part) => !part || part === "." || part === "..") &&
    /^[A-Za-z0-9_./ +@-]+$/.test(value)
  );
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fault(message, code, status, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}
