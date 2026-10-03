// Isolated SDK-backed crash QA. Never load product identities or Wallet keys.
// SQLite stores synthetic QA secrets only; this is NOT production secure storage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, chmod, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

process.umask(0o077);
const worker = process.argv[2] === '--worker';
const args = process.argv.slice(worker ? 3 : 2);
const [packageRoot, destination, actionJson] = args;
if (!packageRoot || !destination) throw new Error('Expected isolated package root and evidence directory');
const metadata = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
assert.equal(metadata.name, '@signalapp/libsignal-client');
assert.equal(metadata.version, '0.104.0');
const sdk = await import(pathToFileURL(resolve(packageRoot, 'dist/index.js')).href);
const addresses = {
  alice: sdk.ProtocolAddress.new(sdk.Aci.fromUuid('97d7967e-583d-4f76-bae2-d35a533c22b0'), 1),
  bob: sdk.ProtocolAddress.new(sdk.Aci.fromUuid('48ccf172-2a4e-4375-bd74-bfef525e5711'), 1),
};
const other = owner => owner === 'alice' ? 'bob' : 'alice';
const script = fileURLToPath(import.meta.url);
const checks = [];
let database;
let stage;

function open(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      owner TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, value BLOB NOT NULL,
      PRIMARY KEY(owner, kind, id)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      owner TEXT NOT NULL, id TEXT NOT NULL, peer TEXT NOT NULL, type INTEGER NOT NULL,
      value BLOB NOT NULL, PRIMARY KEY(owner, id)
    );
    CREATE TABLE IF NOT EXISTS inbox (
      owner TEXT NOT NULL, sender TEXT NOT NULL, id TEXT NOT NULL, value BLOB NOT NULL,
      PRIMARY KEY(owner, sender, id)
    );
  `);
  return db;
}
function put(db, owner, kind, id, value) {
  db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?,?)').run(owner, kind, String(id), Buffer.from(value));
}
function get(db, owner, kind, id) {
  const row = db.prepare('SELECT value FROM records WHERE owner=? AND kind=? AND id=?').get(owner, kind, String(id));
  return row ? Buffer.from(row.value) : null;
}
function drop(db, owner, kind, id) {
  db.prepare('DELETE FROM records WHERE owner=? AND kind=? AND id=?').run(owner, kind, String(id));
}
function requireRecord(db, owner, kind, id) {
  const bytes = get(db, owner, kind, id);
  if (!bytes) throw new Error('MissingSyntheticRecord');
  return bytes;
}
function stores(db, owner) {
  const sessions = new class extends sdk.SessionStore {
    async saveSession(address, record) { put(db, owner, 'session', address.toString(), record.serialize()); }
    async getSession(address) {
      const bytes = get(db, owner, 'session', address.toString());
      return bytes ? sdk.SessionRecord.deserialize(bytes) : null;
    }
    async getExistingSessions(list) {
      return Promise.all(list.map(address => this.getSession(address))).then(records => {
        if (records.some(record => !record)) throw new Error('MissingSyntheticSession');
        return records;
      });
    }
  }();
  const identity = new class extends sdk.IdentityKeyStore {
    async getIdentityKey() { return sdk.PrivateKey.deserialize(requireRecord(db, owner, 'own', 'private')); }
    async getLocalRegistrationId() { return owner === 'alice' ? 1001 : 2002; }
    async saveIdentity(address, key) {
      if (!(await this.isTrustedIdentity(address, key))) throw new Error('UntrustedSyntheticIdentity');
      return sdk.IdentityChange.NewOrUnchanged;
    }
    async isTrustedIdentity(address, key) {
      const pinned = get(db, owner, 'trusted', address.toString());
      return pinned !== null && pinned.equals(Buffer.from(key.serialize()));
    }
    async getIdentity(address) {
      const bytes = get(db, owner, 'trusted', address.toString());
      return bytes ? sdk.PublicKey.deserialize(bytes) : null;
    }
  }();
  const prekeys = new class extends sdk.PreKeyStore {
    async getPreKey(id) { return sdk.PreKeyRecord.deserialize(requireRecord(db, owner, 'prekey', id)); }
    async savePreKey(id, key) { put(db, owner, 'prekey', id, key.serialize()); }
    async removePreKey(id) { drop(db, owner, 'prekey', id); }
  }();
  const signed = new class extends sdk.SignedPreKeyStore {
    async getSignedPreKey(id) { return sdk.SignedPreKeyRecord.deserialize(requireRecord(db, owner, 'signed', id)); }
    async saveSignedPreKey(id, key) { put(db, owner, 'signed', id, key.serialize()); }
  }();
  const kem = new class extends sdk.KyberPreKeyStore {
    async getKyberPreKey(id) { return sdk.KyberPreKeyRecord.deserialize(requireRecord(db, owner, 'kem', id)); }
    async saveKyberPreKey(id, key) { put(db, owner, 'kem', id, key.serialize()); }
    async markKyberPreKeyUsed(id, signedId, baseKey) {
      requireRecord(db, owner, 'kem', id);
      put(db, owner, 'used-kem', `${id}:${signedId}`, baseKey.serialize());
      drop(db, owner, 'kem', id);
    }
  }();
  return { sessions, identity, prekeys, signed, kem };
}
async function initialize(db) {
  const identities = { alice: sdk.IdentityKeyPair.generate(), bob: sdk.IdentityKeyPair.generate() };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const owner of ['alice', 'bob']) {
      put(db, owner, 'own', 'private', identities[owner].privateKey.serialize());
      put(db, owner, 'trusted', addresses[other(owner)].toString(), identities[other(owner)].publicKey.serialize());
    }
    const pre = sdk.PrivateKey.generate();
    const signed = sdk.PrivateKey.generate();
    const kem = sdk.KEMKeyPair.generate();
    const signedSig = identities.bob.privateKey.sign(signed.getPublicKey().serialize());
    const kemSig = identities.bob.privateKey.sign(kem.getPublicKey().serialize());
    put(db, 'bob', 'prekey', 11, sdk.PreKeyRecord.new(11, pre.getPublicKey(), pre).serialize());
    put(db, 'bob', 'signed', 12, sdk.SignedPreKeyRecord.new(12, Date.now(), signed.getPublicKey(), signed, signedSig).serialize());
    put(db, 'bob', 'kem', 13, sdk.KyberPreKeyRecord.new(13, Date.now(), kem, kemSig).serialize());
    const bundle = sdk.PreKeyBundle.new(2002, 1, 11, pre.getPublicKey(), 12, signed.getPublicKey(), signedSig, identities.bob.publicKey, 13, kem.getPublicKey(), kemSig);
    const s = stores(db, 'alice');
    await sdk.processPreKeyBundle(bundle, addresses.bob, addresses.alice, s.sessions, s.identity);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function killAt(action, cut) {
  if (action.cut === cut) process.kill(process.pid, 'SIGKILL');
}
async function operation(db, action) {
  if (!['alice', 'bob'].includes(action.owner) || !/^[a-z0-9-]{1,40}$/.test(action.id)) throw new Error('InvalidSyntheticAction');
  const owner = action.owner;
  const peer = other(owner);
  const s = stores(db, owner);
  if (action.mode === 'retry') {
    assert.ok(db.prepare('SELECT value FROM outbox WHERE owner=? AND id=?').get(owner, action.id));
    return;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (action.mode === 'send') {
      if (db.prepare('SELECT id FROM outbox WHERE owner=? AND id=?').get(owner, action.id)) throw new Error('AlreadyCommittedId');
      const body = Buffer.from(`YNX durable isolated synthetic ${action.id}`);
      const message = await sdk.signalEncrypt(body, addresses[peer], addresses[owner], s.sessions, s.identity);
      killAt(action, 'after-native-state');
      db.prepare('INSERT INTO outbox VALUES (?,?,?,?,?)').run(owner, action.id, addresses[peer].toString(), message.type(), Buffer.from(message.serialize()));
      killAt(action, 'after-outbox-before-commit');
    } else if (action.mode === 'receive') {
      const row = db.prepare('SELECT type,value FROM outbox WHERE owner=? AND id=?').get(peer, action.id);
      if (!row) throw new Error('MissingSyntheticOutbox');
      const bytes = Buffer.from(row.value);
      const body = row.type === sdk.CiphertextMessageType.PreKey
        ? await sdk.signalDecryptPreKey(sdk.PreKeySignalMessage.deserialize(bytes), addresses[peer], addresses[owner], s.sessions, s.identity, s.prekeys, s.signed, s.kem)
        : await sdk.signalDecrypt(sdk.SignalMessage.deserialize(bytes), addresses[peer], addresses[owner], s.sessions, s.identity);
      assert.equal(Buffer.from(body).equals(Buffer.from(`YNX durable isolated synthetic ${action.id}`)), true);
      killAt(action, 'after-native-state');
      db.prepare('INSERT INTO inbox VALUES (?,?,?,?)').run(owner, addresses[peer].toString(), action.id, Buffer.from(body));
    } else throw new Error('UnknownSyntheticAction');
    db.exec('COMMIT');
    killAt(action, 'after-commit');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
function run(dbPath, action, expected = 'success') {
  const child = spawnSync(process.execPath, [script, '--worker', packageRoot, dbPath, JSON.stringify(action)], {
    encoding: 'utf8', timeout: 25000, maxBuffer: 4096,
  });
  if (expected === 'kill') assert.equal(child.signal, 'SIGKILL');
  else if (expected === 'reject') assert.equal(child.status, 2);
  else assert.equal(child.status, 0);
  assert.equal(child.error === undefined, true);
}
function stateDigest(dbPath) {
  const db = open(dbPath);
  try {
    const hash = createHash('sha256');
    for (const table of ['records', 'outbox', 'inbox']) {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY 1,2,3`).all();
      for (const row of rows) {
        for (const value of Object.values(row)) {
          const encoded = ArrayBuffer.isView(value) ? Buffer.from(value) : Buffer.from(String(value));
          hash.update(String(encoded.length)).update(':').update(encoded);
        }
      }
    }
    return hash.digest('hex'); // Kept in RAM, never put secret-state digests in evidence.
  } finally { db.close(); }
}
function check(name, action) {
  action();
  checks.push({ name, result: 'PASS' });
  console.log(`PASS ${name}`);
}
try {
  if (worker) {
    database = open(destination);
    await operation(database, JSON.parse(actionJson));
    database.close();
    database = null;
  } else {
    stage = await mkdtemp(join(tmpdir(), 'social-veil-durable-qa-'));
    await chmod(stage, 0o700);
    const dbPath = join(stage, 'synthetic-only.sqlite');
    database = open(dbPath);
    await chmod(dbPath, 0o600);
    await initialize(database);
    database.close();
    database = null;
    const initial = stateDigest(dbPath);
    check('cold process opens committed official native sender session', () => {
      const db = open(dbPath);
      try { assert.ok(get(db, 'alice', 'session', addresses.bob.toString())); }
      finally { db.close(); }
    });
    check('SIGKILL after native ratchet save rolls back all sender writes', () => {
      run(dbPath, { mode: 'send', owner: 'alice', id: 'first', cut: 'after-native-state' }, 'kill');
      assert.equal(stateDigest(dbPath) === initial, true);
    });
    check('SIGKILL after outbox insert before COMMIT rolls back ratchet and ciphertext together', () => {
      run(dbPath, { mode: 'send', owner: 'alice', id: 'first', cut: 'after-outbox-before-commit' }, 'kill');
      assert.equal(stateDigest(dbPath) === initial, true);
    });
    check('post-COMMIT SIGKILL preserves ratchet and exactly one committed ciphertext', () => {
      run(dbPath, { mode: 'send', owner: 'alice', id: 'first', cut: 'after-commit' }, 'kill');
      assert.equal(stateDigest(dbPath) === initial, false);
      const db = open(dbPath);
      try { assert.equal(db.prepare('SELECT count(*) AS n FROM outbox').get().n, 1); }
      finally { db.close(); }
    });
    const committed = stateDigest(dbPath);
    check('cold outbox retry preserves original ciphertext and ratchet without re-encryption', () => {
      run(dbPath, { mode: 'retry', owner: 'alice', id: 'first' });
      assert.equal(stateDigest(dbPath) === committed, true);
    });
    check('SIGKILL after native prekey decrypt restores prekeys and uncommitted inbox/session', () => {
      run(dbPath, { mode: 'receive', owner: 'bob', id: 'first', cut: 'after-native-state' }, 'kill');
      assert.equal(stateDigest(dbPath) === committed, true);
    });
    check('cold retry decrypt succeeds and atomically commits inbox and one-time key consumption', () => {
      run(dbPath, { mode: 'receive', owner: 'bob', id: 'first' });
      const db = open(dbPath);
      try {
        assert.equal(get(db, 'bob', 'prekey', 11), null);
        assert.equal(get(db, 'bob', 'kem', 13), null);
        assert.equal(db.prepare('SELECT count(*) AS n FROM inbox').get().n, 1);
        assert.ok(get(db, 'bob', 'session', addresses.alice.toString()));
      } finally { db.close(); }
    });
    check('fresh processes reply and decrypt through persisted bidirectional native sessions', () => {
      run(dbPath, { mode: 'send', owner: 'bob', id: 'reply' });
      run(dbPath, { mode: 'receive', owner: 'alice', id: 'reply' });
    });
    check('already committed send ID is rejected without mutating durable state', () => {
      const before = stateDigest(dbPath);
      run(dbPath, { mode: 'send', owner: 'alice', id: 'first' }, 'reject');
      assert.equal(stateDigest(dbPath) === before, true);
    });
    check('reopened SQLite integrity remains valid after abrupt crash cuts', () => {
      const db = open(dbPath);
      try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
      finally { db.close(); }
    });
    await rm(stage, { recursive: true });
    stage = null;
    await writeFile(resolve(destination, 'durable-crash-check.json'), `${JSON.stringify({
      schema: 'ynx-social-native-durable-crash-qa-v1',
      package: metadata.name, version: metadata.version,
      upstream_commit: '257105c55a7389ca6b1e85185e2769465e6729f1',
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      storage: 'isolated SQLite WAL synchronous=FULL, one local DB, synthetic keys only',
      crash_method: 'actual worker SIGKILL; next worker opens database in a new process',
      synthetic_database_removed: true, checks,
      not_proven: ['power-loss/filesystem fault durability', 'concurrent writers and multi-node prekey races',
        'mobile secure storage and keystore integration', 'independently measured SPQR fresh key contribution',
        'production integration, independent review, migration, activation, public/installed user acceptance'],
    }, null, 2)}\n`);
    console.log(`PASS ${checks.length} native SDK durable process-crash checks`);
  }
} catch {
  // Native callbacks and assertion buffers may contain synthetic secrets: never dump them.
  console.error('FAIL DurableSyntheticQa');
  process.exitCode = worker ? 2 : 1;
} finally {
  if (database) database.close();
  if (stage) await rm(stage, { recursive: true });
}
