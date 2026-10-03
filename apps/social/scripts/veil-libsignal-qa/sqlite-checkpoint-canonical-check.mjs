import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const old = new DatabaseSync(':memory:');
const current = new DatabaseSync(':memory:');
const checks = [];
const readSQL = 'SELECT slot,revision,typeof(slot) AS slot_type,typeof(revision) AS revision_type FROM checkpoint';
const oldSchema = 'CREATE TABLE checkpoint (slot INTEGER PRIMARY KEY CHECK(slot=1),revision INTEGER NOT NULL CHECK(revision>=0))';
const newSchema = "CREATE TABLE checkpoint (slot INTEGER PRIMARY KEY CHECK(typeof(slot)='integer' AND slot=1),revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=0))";
function row(db) {
  const query = db.prepare(readSQL);
  query.setReadBigInts(true);
  const rows = query.all();
  if (rows.length !== 1) throw new Error('TRUSTED_RECOVERY_HOLD');
  return rows[0];
}
function canonical(db) {
  const value = row(db);
  if (value.slot_type !== 'integer' || value.revision_type !== 'integer' ||
      typeof value.slot !== 'bigint' || typeof value.revision !== 'bigint' ||
      value.slot !== 1n || value.revision < 0n || value.revision > 9223372036854775807n)
    throw new Error('TRUSTED_RECOVERY_HOLD');
  const header = Buffer.alloc(8);
  header.writeBigInt64BE(value.revision);
  return header;
}
function check(name, action) {
  action(); checks.push({ name, result: 'PASS' }); console.log(`PASS ${name}`);
}
try {
  old.exec(oldSchema);
  current.exec(newSchema);
  old.exec('INSERT INTO checkpoint VALUES(1,1.5)');
  const original = row(old);
  const baselineAlias = original.revision_type === 'real' && Math.trunc(original.revision) === 1;
  assert.equal(baselineAlias, true);
  console.log('BASELINE_FAIL legacy schema accepts REAL 1.5 and getLong-like conversion aliases integer 1');
  check('existing fractional snapshot rejects before numeric conversion and stays preserved', () => {
    assert.throws(() => canonical(old), /TRUSTED_RECOVERY_HOLD/);
    assert.equal(row(old).revision, 1.5);
    assert.equal(row(old).revision_type, 'real');
  });
  check('new schema rejects fractional, NULL, nonnumeric TEXT and overflowing REAL revisions', () => {
    for (const literal of ['1.5', 'NULL', "'not-an-integer'", '9223372036854775808'])
      assert.throws(() => current.exec(`INSERT INTO checkpoint VALUES(1,${literal})`));
  });
  check('existing legitimate INTEGER snapshot retains exactly the same canonical header', () => {
    old.exec('UPDATE checkpoint SET revision=1');
    current.exec('INSERT INTO checkpoint VALUES(1,1)');
    assert.deepEqual(canonical(old), canonical(current));
    assert.equal(canonical(current).toString('hex'), '0000000000000001');
  });
  check('full signed INTEGER range reads without floating point precision loss', () => {
    for (const revision of [0n, 9007199254740993n, 9223372036854775807n]) {
      const update = current.prepare('UPDATE checkpoint SET revision=?');
      update.run(revision);
      assert.equal(canonical(current).readBigInt64BE(), revision);
    }
  });
  check('negative revision and noncanonical row shape cannot be silently normalized', () => {
    assert.throws(() => current.exec('UPDATE checkpoint SET revision=-1'));
    current.exec('DELETE FROM checkpoint');
    assert.throws(() => canonical(current), /TRUSTED_RECOVERY_HOLD/);
    assert.throws(() => current.exec('INSERT INTO checkpoint VALUES(2,0)'));
  });
  const report = {
    schema: 'ynx-social-canonical-checkpoint-qa-v1',
    original_source: 'be99a1ad56a559925152dcdbbef8800080c56e19',
    original_schema: oldSchema, updated_schema: newSchema, read_sql: readSQL,
    preserved_baseline_fail: { revision_storage_type: 'real', stored_revision: 1.5, truncated_revision: 1, alias_reproduced: baselineAlias },
    checks, sqlite_version: current.prepare('SELECT sqlite_version() AS v').get().v,
    actual_sqlite: true, integer_read_mode: 'BigInt, never float conversion',
    canonical_header: '8-byte big-endian signed nonnegative Long, same as native ByteBuffer.putLong',
    not_proven: ['Android Cursor runtime', 'authenticated checkpoint anchor or approved device provider', 'actual device exploit or secret exposure', 'activation or complete Social acceptance'],
  };
  await writeFile(resolve(process.argv[2], 'checkpoint-canonical-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS ${checks.length} actual SQLite canonical checkpoint regressions`);
} catch (error) {
  console.error(`FAIL ${error.name}`); process.exitCode = 1;
} finally { old.close(); current.close(); }
