import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { constants, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, fstatSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Product-owned conversation data, separate from Wallet grants and SSO keys.
// Bounded storage stops accepting new requests instead of deleting past answers.
export const NATIVE_AI_LIMITS = Object.freeze({
  promptBytes: 4096, contextBytes: 64 * 1024, answerBytes: 2 * 1024 * 1024,
  projectRecords: 64, ownerRecords: 128, records: 2048,
  projectBytes: 16 * 1024 * 1024, ownerBytes: 64 * 1024 * 1024, bytes: 256 * 1024 * 1024,
});
const liveStores = new Set();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fault = (message, code, status = 503) => Object.assign(new Error(message), { code, status });

export function createNativeAIStore({ filename, keyPath, now = Date.now } = {}) {
  if (typeof now !== 'function') throw new TypeError('Native AI store requires a clock.');
  filename = protectedPath(filename); keyPath = protectedPath(keyPath);
  if (filename === keyPath) throw fault('Native AI data and key paths must be separate.', 'native_ai_store_configuration');
  const existing = privateFile(filename), keyFile = privateFile(keyPath);
  if (existing && !keyFile) throw fault('Native AI content key is missing; existing conversations are preserved.', 'native_ai_key_missing');
  const key = readKey(keyPath, keyFile);
  let created = !existing;
  if (created) {
    try {
      const fd = openSync(filename, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
      try { fsyncSync(fd); } finally { closeSync(fd); }
      syncParent(filename);
    } catch (error) {
      if (error.code !== 'EEXIST') { key.fill(0); throw error; }
      privateFile(filename); created = false;
    }
  }
  const stat = privateFile(filename), identity = `${stat.dev}:${stat.ino}`;
  if (liveStores.has(identity)) { key.fill(0); throw busy(); }
  let db, closed = false;
  const aad = (owner, projectId, id) => Buffer.from(JSON.stringify(['ynx-native-ai-conversation/v1', owner, projectId, id]));
  function seal(value, associatedData) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(associatedData);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  }
  function unseal(value, associatedData) {
    try {
      const raw = Buffer.from(value);
      if (raw.length < 29) throw new Error('Invalid envelope');
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAAD(associatedData); decipher.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
    } catch { throw fault('Native AI encrypted content could not be authenticated; existing records are preserved.', 'native_ai_content_invalid'); }
  }
  function timestamp() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8.64e15) throw fault('Native AI clock is invalid.', 'native_ai_store_clock');
    return value;
  }
  try {
    db = new DatabaseSync(filename);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;');
    if (created) {
      db.exec(`CREATE TABLE native_ai_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL, key_check BLOB NOT NULL);
        CREATE TABLE native_ai_broker(singleton INTEGER PRIMARY KEY CHECK(singleton=1), pid INTEGER NOT NULL);
        CREATE TABLE native_ai_conversations(owner TEXT NOT NULL, project_id TEXT NOT NULL, id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('generating','completed','failed','interrupted')),
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, model TEXT NOT NULL, sealed BLOB NOT NULL,
          storage_bytes INTEGER NOT NULL, PRIMARY KEY(owner,project_id,id));
        CREATE INDEX native_ai_owner ON native_ai_conversations(owner,project_id,created_at DESC);`);
      db.prepare('INSERT INTO native_ai_meta VALUES(1,1,?)').run(seal({ purpose: 'ynx-native-ai-content/v1' }, Buffer.from('ynx-native-ai-key-check/v1')));
    }
    const meta = db.prepare('SELECT version,key_check FROM native_ai_meta WHERE singleton=1').get();
    if (meta?.version !== 1 || unseal(meta.key_check, Buffer.from('ynx-native-ai-key-check/v1')).purpose !== 'ynx-native-ai-content/v1')
      throw fault('Native AI storage format is not recognized; existing files are preserved.', 'native_ai_store_invalid');
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT pid FROM native_ai_broker WHERE singleton=1').get();
      if (previous) {
        let dead = false;
        // PID reuse and uncertain process visibility fail closed. A live second
        // process must never relabel another process's generation as interrupted.
        if (Number.isSafeInteger(previous.pid) && previous.pid > 0) {
          try { process.kill(previous.pid, 0); } catch (error) { dead = error.code === 'ESRCH'; }
        }
        if (!dead) throw busy();
      }
      db.prepare('INSERT OR REPLACE INTO native_ai_broker VALUES(1,?)').run(process.pid);
      db.prepare("UPDATE native_ai_conversations SET status='interrupted',updated_at=MAX(updated_at,?),storage_bytes=length(sealed) WHERE status='generating'").run(timestamp());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    liveStores.add(identity);
  } catch (error) { db?.close(); key.fill(0); throw error; }

  const select = db.prepare('SELECT * FROM native_ai_conversations WHERE owner=? AND project_id=? AND id=?');
  function available() { if (closed) throw fault('Native AI storage is closed.', 'native_ai_store_closed'); }
  function metadata(row) {
    return { id: row.id, status: row.status, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), model: row.model };
  }
  function record(row) { return { ...metadata(row), ...unseal(row.sealed, aad(row.owner, row.project_id, row.id)) }; }
  function scope(owner, projectId) {
    available(); bounded(owner, 256, 'owner');
    if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(projectId)) throw invalid('project');
  }
  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = action(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function create({ owner, projectId, prompt, context, model } = {}) {
    scope(owner, projectId); bounded(prompt, NATIVE_AI_LIMITS.promptBytes, 'prompt');
    bounded(context, NATIVE_AI_LIMITS.contextBytes, 'context', true); bounded(model, 120, 'model');
    return transaction(() => {
      const id = randomUUID(), at = timestamp(), sealed = seal({ prompt, context }, aad(owner, projectId, id));
      // JSON escaping can multiply text bytes by six. Reserve that complete
      // answer envelope up front so an accepted answer can be persisted later.
      const reserved = sealed.length + NATIVE_AI_LIMITS.answerBytes * 6 + 128;
      for (const [where, args, recordsLimit, bytesLimit] of [
        ['WHERE owner=? AND project_id=?', [owner, projectId], NATIVE_AI_LIMITS.projectRecords, NATIVE_AI_LIMITS.projectBytes],
        ['WHERE owner=?', [owner], NATIVE_AI_LIMITS.ownerRecords, NATIVE_AI_LIMITS.ownerBytes],
        ['', [], NATIVE_AI_LIMITS.records, NATIVE_AI_LIMITS.bytes],
      ]) {
        const usage = db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(storage_bytes),0) AS bytes FROM native_ai_conversations ${where}`).get(...args);
        if (usage.count >= recordsLimit || usage.bytes + reserved > bytesLimit)
          throw fault('Saved AI request capacity is full. Existing conversations are preserved.', 'native_ai_store_capacity', 429);
      }
      db.prepare("INSERT INTO native_ai_conversations VALUES(?,?,?,'generating',?,?,?,?,?)").run(owner, projectId, id, at, at, model, sealed, reserved);
      return record(select.get(owner, projectId, id));
    });
  }
  function get(owner, projectId, id) {
    scope(owner, projectId); if (!UUID.test(id || '')) return null;
    const row = select.get(owner, projectId, id); return row ? record(row) : null;
  }
  function list(owner, projectId) {
    scope(owner, projectId);
    return db.prepare('SELECT id,status,created_at,updated_at,model FROM native_ai_conversations WHERE owner=? AND project_id=? ORDER BY created_at DESC,id DESC').all(owner, projectId).map(metadata);
  }
  function finish(owner, projectId, id, status, value) {
    scope(owner, projectId);
    return transaction(() => {
      const row = UUID.test(id || '') ? select.get(owner, projectId, id) : null;
      if (!row) throw fault('AI conversation was not found in this project.', 'native_ai_conversation_not_found', 404);
      if (row.status !== 'generating') throw fault('AI conversation is already terminal. Start a newly reviewed request.', 'native_ai_conversation_terminal', 409);
      const content = unseal(row.sealed, aad(owner, projectId, id));
      const sealed = seal({ ...content, ...value.content }, aad(owner, projectId, id));
      if (sealed.length > row.storage_bytes) throw fault('AI answer exceeded its reserved storage boundary.', 'native_ai_store_capacity', 429);
      db.prepare('UPDATE native_ai_conversations SET status=?,updated_at=?,model=?,sealed=?,storage_bytes=? WHERE owner=? AND project_id=? AND id=? AND status=\'generating\'')
        .run(status, Math.max(row.updated_at, timestamp()), value.model ?? row.model, sealed, sealed.length, owner, projectId, id);
      return record(select.get(owner, projectId, id));
    });
  }
  function complete(owner, projectId, id, { text, model } = {}) {
    bounded(text, NATIVE_AI_LIMITS.answerBytes, 'answer'); bounded(model, 120, 'model');
    return finish(owner, projectId, id, 'completed', { model, content: { text } });
  }
  function fail(owner, projectId, id, { code } = {}) {
    if (typeof code !== 'string' || !/^[a-z][a-z0-9_]{0,95}$/.test(code)) throw invalid('failure code');
    return finish(owner, projectId, id, 'failed', { content: { code } });
  }
  function remove(owner, projectId, id) {
    scope(owner, projectId);
    return transaction(() => {
      const row = UUID.test(id || '') ? select.get(owner, projectId, id) : null;
      if (!row) throw fault('AI conversation was not found in this project.', 'native_ai_conversation_not_found', 404);
      if (!['completed', 'failed', 'interrupted'].includes(row.status))
        throw fault('AI generation is still active. Wait for it to finish or stop it before deleting its record.', 'native_ai_conversation_generating', 409);
      // Removes the active application record and releases its capacity. SQLite
      // secure_delete reduces residual pages; it cannot erase prior encrypted
      // WAL entries, backups or physical storage snapshots.
      db.prepare("DELETE FROM native_ai_conversations WHERE owner=? AND project_id=? AND id=? AND status IN ('completed','failed','interrupted')").run(owner, projectId, id);
      return true;
    });
  }
  function close() {
    if (closed) return;
    db.prepare('DELETE FROM native_ai_broker WHERE singleton=1 AND pid=?').run(process.pid);
    db.close(); closed = true; liveStores.delete(identity); key.fill(0);
  }
  return { create, get, list, complete, fail, remove, close };
}

function bounded(value, limit, label, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.includes('\0') || Buffer.byteLength(value) > limit) throw invalid(label);
}
function invalid(label) { return fault(`Native AI ${label} exceeds its bounded data contract.`, 'native_ai_store_input', 400); }
function busy() { return fault('Another live backend owns native AI conversations.', 'native_ai_store_busy'); }
function protectedPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw fault('Native AI storage requires absolute protected paths.', 'native_ai_store_configuration');
  const parent = realpathSync(dirname(path)), stat = lstatSync(parent);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o022)) throw fault('Native AI state directory must be private to its backend owner.', 'native_ai_store_configuration');
  return join(parent, basename(path));
}
function privateFile(path) {
  let stat;
  try { stat = lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw fault('Native AI state file must be private and must not be a symbolic link.', 'native_ai_store_configuration');
  return stat;
}
function readKey(path, existing) {
  if (!existing) {
    const key = randomBytes(32);
    try {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(fd, key); fsyncSync(fd); } finally { closeSync(fd); }
      syncParent(path); return key;
    } catch (error) { key.fill(0); if (error.code !== 'EEXIST') throw error; }
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size !== 32)
      throw fault('Native AI content key must be a private 32-byte regular file.', 'native_ai_key_invalid');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function syncParent(path) { const fd = openSync(dirname(path), constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
