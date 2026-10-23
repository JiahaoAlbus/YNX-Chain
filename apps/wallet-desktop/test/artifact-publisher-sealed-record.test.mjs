import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createSealedPublisherRecord, readSealedPublisherRecord} from '../src/artifact-publication/sealed-record-file.mjs';

function fixture(t) {
  // macOS /var is a symlink; use its real path to exercise strict ancestry.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ynx-publisher-file-'));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  return dir;
}
test('sealed DATA persists across reads without changing caller bytes', t => {
  const dir = fixture(t), bytes = Buffer.alloc(128, 42);
  createSealedPublisherRecord(dir, bytes);
  assert.deepEqual(readSealedPublisherRecord(dir), bytes);
  readSealedPublisherRecord(dir).fill(0);
  assert.deepEqual(readSealedPublisherRecord(dir), bytes);
  assert.equal(bytes[0], 42);
  assert.equal(fs.statSync(path.join(dir, 'artifact-publisher-sealed-v1.bin')).mode & 0o777, 0o600);
});
test('duplicate create refuses replacement and preserves original', t => {
  const dir = fixture(t), original = Buffer.alloc(64, 1);
  createSealedPublisherRecord(dir, original);
  assert.throws(() => createSealedPublisherRecord(dir, Buffer.alloc(64, 2)), {code:'EEXIST'});
  assert.deepEqual(readSealedPublisherRecord(dir), original);
});
test('partial uncertain record is retained and cannot be replaced', t => {
  const dir = fixture(t), file = path.join(dir, 'artifact-publisher-sealed-v1.bin');
  fs.writeFileSync(file, Buffer.alloc(2), {mode:0o600});
  assert.throws(() => readSealedPublisherRecord(dir), {code:'PUBLISHER_STORE_RECORD'});
  assert.throws(() => createSealedPublisherRecord(dir, Buffer.alloc(64)), {code:'EEXIST'});
  assert.equal(fs.statSync(file).size, 2);
});
test('directory flush failure reports error and retains the original, without retry', t => {
  const dir = fixture(t), original = Buffer.alloc(64, 9), sync = fs.fsyncSync;
  const inode = fs.statSync(dir).ino;
  fs.fsyncSync = fd => {
    if (fs.fstatSync(fd).ino === inode) throw Object.assign(new Error('controlled directory flush failure'), {code:'EIO'});
    return sync(fd);
  };
  try { assert.throws(() => createSealedPublisherRecord(dir, original), {code:'EIO'}); }
  finally { fs.fsyncSync = sync; }
  assert.deepEqual(readSealedPublisherRecord(dir), original);
  assert.throws(() => createSealedPublisherRecord(dir, Buffer.alloc(64, 8)), {code:'EEXIST'});
});
test('rejects public directory permissions and unbounded inputs', t => {
  const dir = fixture(t);
  fs.chmodSync(dir, 0o755);
  assert.throws(() => createSealedPublisherRecord(dir, Buffer.alloc(64)), {code:'PUBLISHER_STORE_PERMISSIONS'});
  fs.chmodSync(dir, 0o700);
  for (const value of [null, 'secret', Buffer.alloc(63), Buffer.alloc(1024*1024+1)]) {
    assert.throws(() => createSealedPublisherRecord(dir, value), {code:'PUBLISHER_STORE_RECORD'});
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});
test('rejects leaf links and linked directory ancestors without touching target', t => {
  const dir = fixture(t), target = path.join(dir, 'original');
  fs.writeFileSync(target, Buffer.alloc(64, 7), {mode:0o600});
  fs.symlinkSync(target, path.join(dir, 'artifact-publisher-sealed-v1.bin'));
  assert.throws(() => readSealedPublisherRecord(dir));
  assert.throws(() => createSealedPublisherRecord(dir, Buffer.alloc(64)));
  const link = path.join(dir, 'linked'); fs.symlinkSync(dir, link);
  assert.throws(() => readSealedPublisherRecord(link), {code:'PUBLISHER_STORE_PATH'});
  assert.equal(fs.readFileSync(target)[0], 7);
});
test('hard-linked sealed data is not accepted as an independent store', t => {
  const dir = fixture(t);
  createSealedPublisherRecord(dir, Buffer.alloc(64));
  fs.linkSync(path.join(dir, 'artifact-publisher-sealed-v1.bin'), path.join(dir, 'other'));
  assert.throws(() => readSealedPublisherRecord(dir), {code:'PUBLISHER_STORE_RECORD'});
});
test('a FIFO in the record slot fails instead of blocking the Wallet process', t => {
  const dir = fixture(t), file = path.join(dir, 'artifact-publisher-sealed-v1.bin');
  assert.equal(spawnSync('/usr/bin/mkfifo', [file]).status, 0);
  const script = `import {readSealedPublisherRecord} from ${JSON.stringify(new URL('../src/artifact-publication/sealed-record-file.mjs', import.meta.url).href)}; try {readSealedPublisherRecord(${JSON.stringify(dir)}); process.exitCode=2;} catch(e) {if(e.code!=='PUBLISHER_STORE_RECORD') throw e;}`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {timeout:1500});
  assert.equal(child.error, undefined, 'special-file validation must not block before fstat');
  assert.equal(child.status, 0, child.stderr.toString());
});
test('cleanup failure does not overwrite first write failure or retry close', t => {
  const dir = fixture(t), write = fs.writeFileSync, close = fs.closeSync;
  const primary = Object.assign(new Error('controlled write failure'), {code:'EIO'});
  const cleanup = Object.assign(new Error('controlled close failure'), {code:'EBADF'});
  let closes = 0;
  fs.writeFileSync = () => { throw primary; };
  fs.closeSync = fd => { closes++; close(fd); throw cleanup; };
  try {
    assert.throws(() => createSealedPublisherRecord(dir, Buffer.alloc(64)), error => error === primary && error.cleanupCause === cleanup);
  } finally { fs.writeFileSync = write; fs.closeSync = close; }
  assert.equal(closes, 1);
  assert.equal(fs.statSync(path.join(dir, 'artifact-publisher-sealed-v1.bin')).size, 0);
});
test('first read failure retains cleanup cause and original file', t => {
  const dir = fixture(t), file = path.join(dir, 'artifact-publisher-sealed-v1.bin'), close = fs.closeSync;
  fs.writeFileSync(file, Buffer.alloc(3), {mode:0o600});
  const cleanup = new Error('controlled close failure');
  fs.closeSync = fd => { close(fd); throw cleanup; };
  try { assert.throws(() => readSealedPublisherRecord(dir), error => error.code === 'PUBLISHER_STORE_RECORD' && error.cleanupCause === cleanup); }
  finally { fs.closeSync = close; }
  assert.equal(fs.statSync(file).size, 3);
});
