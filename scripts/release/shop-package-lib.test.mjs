import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertSafeOutputDirectory,
  createDeterministicTar,
  parseTar,
  sha256,
} from './shop-package-lib.mjs';

test('deterministic tar round-trips sorted files and fixed metadata', () => {
  const entries = [
    { path: 'package/z.txt', mode: 0o644, body: Buffer.from('z') },
    { path: 'package/bin/app', mode: 0o755, body: Buffer.from('binary') },
  ];
  const first = createDeterministicTar(entries, 1_700_000_000);
  const second = createDeterministicTar(entries.slice().reverse(), 1_700_000_000);
  assert.equal(sha256(first), sha256(second));
  assert.deepEqual(parseTar(first).map(({ path: entryPath, mode, mtime, body }) => ({ entryPath, mode, mtime, body: body.toString() })), [
    { entryPath: 'package/bin/app', mode: 0o755, mtime: 1_700_000_000, body: 'binary' },
    { entryPath: 'package/z.txt', mode: 0o644, mtime: 1_700_000_000, body: 'z' },
  ]);
});

test('tar creation rejects traversal, duplicates and unsafe separators', () => {
  for (const entryPath of ['../escape', '/absolute', 'package/../escape', 'package\\escape']) {
    assert.throws(() => createDeterministicTar([{ path: entryPath, body: 'x' }], 1), /unsafe archive path/);
  }
  assert.throws(() => createDeterministicTar([{ path: 'same', body: 'a' }, { path: 'same', body: 'b' }], 1), /duplicate tar path/);
});

test('tar parser rejects corruption and truncation', () => {
  const archive = createDeterministicTar([{ path: 'package/file', body: 'content' }], 1);
  const corrupt = Buffer.from(archive);
  corrupt[0] ^= 1;
  assert.throws(() => parseTar(corrupt), /checksum mismatch/);
  assert.throws(() => parseTar(archive.subarray(0, 1024)), /two-block terminator/);
});

test('release output is restricted to a non-symlink child of the allowed root', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-shop-output-test-'));
  const allowed = path.join(sandbox, 'artifacts', 'shop-release');
  try {
    const valid = path.join(allowed, 'candidate');
    assert.equal(assertSafeOutputDirectory(valid, allowed), valid);
    assert.throws(() => assertSafeOutputDirectory(allowed, allowed), /must be a child/);
    assert.throws(() => assertSafeOutputDirectory(path.join(sandbox, 'outside'), allowed), /must be a child/);
    fs.mkdirSync(path.join(allowed, 'real'), { recursive: true });
    fs.symlinkSync(path.join(sandbox, 'outside-target'), path.join(allowed, 'link'));
    assert.throws(() => assertSafeOutputDirectory(path.join(allowed, 'link', 'candidate'), allowed), /must not contain symlinks/);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
