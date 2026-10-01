import { DatabaseSync } from "node:sqlite";

// Guest identity remains separate from Wallet identity. Legacy signed cookie IDs
// retain their existing owner/files during a bounded first-seen recovery window.
// Browser Max-Age and refreshing /health are not server admission authority.
export function createGuestAdmission({ filename = ":memory:", now = Date.now, lifetimeMs = 14_400_000 } = {}) {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS guest_admission(id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);");
  function admit(id) {
    db.prepare("INSERT OR IGNORE INTO guest_admission(id,expires_at,revoked) VALUES(?,?,0)").run(id, now() + lifetimeMs);
    const row = db.prepare("SELECT expires_at,revoked FROM guest_admission WHERE id=?").get(id);
    return row && !row.revoked && row.expires_at > now();
  }
  return { admit, revoke: id => db.prepare("UPDATE guest_admission SET revoked=1 WHERE id=?").run(id), close: () => db.close() };
}
