import { randomUUID } from "node:crypto";

export async function assertRemoteTerminalStopped(verify, context) {
  if (typeof verify !== "function") throw Object.assign(new Error("Remote workspace processes could not be verified as stopped. The workspace remains protected for recovery."), {
    code: "remote_terminal_recovery_required", status: 409,
  });
  await verify(context);
}

// A remote terminal's mutable workspace can be its only surviving copy. Mark it
// before preparation and keep the marker across gateway restarts until a full
// snapshot has been committed or fsynced to a private recovery file.
export function createTerminalRecoveryJournal(db) {
  const failed = new Set();
  const identity = (owner, runtimeId) => JSON.stringify([owner, runtimeId]);
  db.exec("CREATE TABLE IF NOT EXISTS terminal_recovery(owner_id TEXT NOT NULL,runtime_id TEXT NOT NULL,project_id TEXT NOT NULL,token TEXT NOT NULL,opened_at TEXT NOT NULL,PRIMARY KEY(owner_id,runtime_id))");
  if (!db.prepare("PRAGMA table_info(terminal_recovery)").all().some(column => column.name === "workspace_id")) db.exec("ALTER TABLE terminal_recovery ADD COLUMN workspace_id TEXT");
  const read = db.prepare("SELECT project_id,token,workspace_id FROM terminal_recovery WHERE owner_id=? AND runtime_id=?");
  const insert = db.prepare("INSERT INTO terminal_recovery(owner_id,runtime_id,project_id,token,opened_at,workspace_id) VALUES(?,?,?,?,?,?)");
  const remove = db.prepare("DELETE FROM terminal_recovery WHERE owner_id=? AND runtime_id=? AND token=?");
  const count = db.prepare("SELECT COUNT(*) AS count FROM terminal_recovery");
  function assertAvailable(owner, runtimeId) {
    if (read.get(owner, runtimeId)) throw Object.assign(new Error("This runtime has workspace changes or process cleanup awaiting recovery. Its remote workspace is protected; recover those files before starting new work."), {
      code: "terminal_recovery_required", status: 409,
    });
  }
  return {
    count: () => Number(count.get().count),
    requireRecovery: (owner, runtimeId) => failed.add(identity(owner, runtimeId)),
    recovering: (owner, runtimeId) => failed.has(identity(owner, runtimeId)),
    assertAvailable, pending: (owner, runtimeId) => Boolean(read.get(owner, runtimeId)),
    begin(owner, runtimeId, projectId, { workspaceId = null } = {}) {
      if (workspaceId !== null && !/^[a-f0-9]{48}$/.test(workspaceId)) throw new Error("Invalid internal SSH workspace identity.");
      assertAvailable(owner, runtimeId);
      const token = randomUUID(); insert.run(owner, runtimeId, projectId, token, new Date().toISOString(), workspaceId);
      return () => { const result = remove.run(owner, runtimeId, token); if (result.changes) failed.delete(identity(owner, runtimeId)); return result; };
    },
  };
}
