import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scanner = path.resolve('scripts/validate/scan-regex.mjs');

function run(args) {
  return spawnSync(process.execPath, [scanner, ...args], { encoding: 'utf8' });
}

test('scanner mirrors match, no-match, and error exit codes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ynx-scan-'));
  await writeFile(path.join(root, 'safe.txt'), 'safe value\n', 'utf8');
  await writeFile(path.join(root, 'bad.txt'), 'contains forbidden-marker\n', 'utf8');

  const found = run(['--pattern', 'forbidden-marker', root]);
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /bad\.txt:1:/);

  const clean = run(['--pattern', 'absent-marker', root]);
  assert.equal(clean.status, 1, clean.stderr);

  const invalid = run(['--pattern', '[', root]);
  assert.equal(invalid.status, 2);
});

test('scanner excludes generated directories and binary files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ynx-scan-exclude-'));
  await mkdir(path.join(root, 'dist'));
  await writeFile(path.join(root, 'dist', 'generated.txt'), 'forbidden-marker\n', 'utf8');
  await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3]));

  const result = run(['--pattern', 'forbidden-marker', '--exclude-dir', 'dist', root]);
  assert.equal(result.status, 1, result.stderr);
});
