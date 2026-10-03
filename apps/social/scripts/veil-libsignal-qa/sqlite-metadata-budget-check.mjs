// Actual isolated SQLite SQL checks. Not Android CursorWindow/device evidence.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const db = new DatabaseSync(':memory:');
const checks = [];
const sql = "SELECT COUNT(*), COALESCE(SUM(length(sealed)),0), COALESCE(MAX(length(sealed)),0), COALESCE(MAX(length(kind)),0), COALESCE(MAX(length(id)),0), COALESCE(SUM(CASE WHEN typeof(sealed)!='blob' OR length(sealed)<29 OR typeof(kind)!='text' OR typeof(id)!='text' THEN 1 ELSE 0 END),0) FROM records";
function budget() {
  const [rows, total, maximum, kind, id, invalid] = Object.values(db.prepare(sql).get());
  return rows >= 0 && rows <= 4096 && total >= 0 && total <= 64 * 1024 * 1024 &&
    maximum >= 0 && maximum <= 8 * 1024 * 1024 + 28 && kind <= 32 && id <= 1024 && invalid === 0;
}
function check(name, action) {
  action();
  checks.push({ name, result: 'PASS' });
  console.log(`PASS ${name}`);
}
try {
  db.exec('CREATE TABLE records(kind TEXT,id TEXT,sealed BLOB)');
  const direct = db.prepare('EXPLAIN SELECT length(sealed) FROM records').all().filter(row => row.opcode === 'Column');
  const cast = db.prepare('EXPLAIN SELECT length(CAST(sealed AS BLOB)) FROM records').all().filter(row => row.opcode === 'Column');
  check('actual SQLite direct-length opcode avoids CAST materialization path', () => {
    assert.equal(direct.length, 1);
    assert.equal(direct[0].p5 & 64, 64);
    assert.equal(cast.length, 1);
    assert.equal(cast[0].p5 & 64, 0);
  });
  check('bounded BLOB passes actual metadata-only aggregate', () => {
    db.exec("INSERT INTO records VALUES ('SESSION','fixture',zeroblob(29))");
    assert.equal(budget(), true);
  });
  check('oversized BLOB rejects before any payload selection', () => {
    db.exec("DELETE FROM records; INSERT INTO records VALUES ('SESSION','fixture',zeroblob(9000000))");
    assert.equal(budget(), false);
  });
  check('non-BLOB and undersized records reject using actual SQL metadata', () => {
    db.exec("DELETE FROM records; INSERT INTO records VALUES ('SESSION','fixture','not-a-blob')");
    assert.equal(budget(), false);
    db.exec("DELETE FROM records; INSERT INTO records VALUES ('SESSION','fixture',zeroblob(28))");
    assert.equal(budget(), false);
  });
  check('too many small records reject without selecting sealed content', () => {
    db.exec("DELETE FROM records; WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<4097) INSERT INTO records SELECT 'SESSION',CAST(i AS TEXT),zeroblob(29) FROM n");
    assert.equal(budget(), false);
  });
  const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
  await writeFile(resolve(process.argv[2], 'sqlite-metadata-budget-check.json'), JSON.stringify({
    schema: 'ynx-social-sqlite-preallocation-qa-v1', sqlite_version: sqliteVersion,
    sql, checks, inspected_blob_payloads: false,
    length_opcode_p5: direct[0].p5, cast_length_opcode_p5: cast[0].p5,
    not_proven: ['Android SQLite opcode behavior or CursorWindow', 'Keystore and complete VeilNativeStore runtime', 'trusted device proof or durable rollback anchor'],
  }, null, 2) + '\n');
  console.log(`PASS ${checks.length} actual SQLite metadata checks`);
} catch (error) {
  console.error(`FAIL ${error.name}`);
  process.exitCode = 1;
} finally { db.close(); }
