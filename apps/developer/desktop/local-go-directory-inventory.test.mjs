import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile as callbackExecFile } from 'node:child_process';
import { runInNewContext } from 'node:vm';
const execFile = promisify(callbackExecFile);
const source = await fs.readFile(new URL('./local-go-toolchain-supplier.mjs', import.meta.url), 'utf8');
// Execute the actual private inventory implementation, not a second scanner.
function scanner(io = fs) {
  const body = source.slice(source.indexOf('const execFile='), source.indexOf('async function writeOwned'));
  return runInNewContext(body + '\nscan;', { fs: io, path, constants, createHash, promisify, callbackExecFile, process });
}
async function fixture(run) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ynx-go-directory-'));
  const root = await fs.realpath(base);
  try { await fs.writeFile(path.join(root, 'hello.go'), 'package main\n', { mode: 0o600 }); await run(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}
const onMac = { skip: process.platform !== 'darwin' };
test('directory xattr changes ctime only and must not invalidate unchanged Go closure', onMac, async () => fixture(async root => {
  const scan = scanner(), before = await fs.lstat(root, { bigint: true }), initial = await scan(root);
  await execFile('/usr/bin/xattr', ['-w', 'com.ynx.qa.directory-inventory', 'metadata-only', root]);
  const after = await fs.lstat(root, { bigint: true });
  assert.notEqual(after.ctimeNs, before.ctimeNs);
  for (const field of ['dev', 'ino', 'uid', 'gid', 'mode', 'mtimeNs', 'nlink', 'size']) assert.equal(after[field], before[field], field);
  assert.equal(JSON.stringify(await scan(root)), JSON.stringify(initial));
}));
test('metadata arriving during traversal does not invalidate stable directory contents', onMac, async () => fixture(async root => {
  let changed = false;
  const scan = scanner({ ...fs, async readdir(item, ...args) {
    const names = await fs.readdir(item, ...args);
    if (item === root && !changed) { changed = true; await execFile('/usr/bin/xattr', ['-w', 'com.ynx.qa.directory-inventory', 'during-scan', root]); }
    return names;
  } });
  assert.ok((await scan(root)).length >= 2); assert.equal(changed, true);
}));
test('changed file bytes/identity and added or removed entries still invalidate an inventory', onMac, async () => fixture(async root => {
  const scan = scanner(), first = JSON.stringify(await scan(root));
  await fs.appendFile(path.join(root, 'hello.go'), '// changed\n'); assert.notEqual(JSON.stringify(await scan(root)), first);
  const second = JSON.stringify(await scan(root));
  await fs.writeFile(path.join(root, 'extra.go'), 'extra', { mode: 0o600 }); assert.notEqual(JSON.stringify(await scan(root)), second);
  const third = JSON.stringify(await scan(root)); await fs.unlink(path.join(root, 'extra.go')); assert.notEqual(JSON.stringify(await scan(root)), third);
}));
test('directory entry mutation during traversal is rejected, including changes after the first listing', onMac, async () => fixture(async root => {
  let changed = false;
  const scan = scanner({ ...fs, async readdir(item, ...args) {
    const names = await fs.readdir(item, ...args);
    if (item === root && !changed) { changed = true; await fs.writeFile(path.join(root, 'late.go'), 'late', { mode: 0o600 }); }
    return names;
  } });
  await assert.rejects(scan(root), /directory changed/);
}));
test('symlinks and group-writable closure paths still fail closed', onMac, async () => fixture(async root => {
  const scan = scanner(); await fs.symlink(path.join(root, 'hello.go'), path.join(root, 'escape.go'));
  await assert.rejects(scan(root), /unsafe/); await fs.unlink(path.join(root, 'escape.go'));
  await fs.chmod(path.join(root, 'hello.go'), 0o660); await assert.rejects(scan(root), /unsafe/);
}));
test('file ctime metadata remains strict even when bytes are unchanged', onMac, async () => fixture(async root => {
  const scan = scanner(), initial = JSON.stringify(await scan(root));
  await execFile('/usr/bin/xattr', ['-w', 'com.ynx.qa.file-inventory', 'file-stays-strict', path.join(root, 'hello.go')]);
  assert.notEqual(JSON.stringify(await scan(root)), initial);
}));
test('directory permission changes during traversal still reject', onMac, async () => fixture(async root => {
  let changed = false;
  const scan = scanner({ ...fs, async readdir(item, ...args) {
    const names = await fs.readdir(item, ...args);
    if (item === root && !changed) { changed = true; await fs.chmod(root, 0o755); }
    return names;
  } });
  await assert.rejects(scan(root), /directory changed/);
}));
test('exact second entry listing catches changes even if directory metadata is unchanged', onMac, async () => fixture(async root => {
  const originalStat = await fs.lstat(root, { bigint: true }); let changed = false;
  const scan = scanner({ ...fs,
    lstat: (item, ...args) => item === root ? Promise.resolve(originalStat) : fs.lstat(item, ...args),
    async readdir(item, ...args) {
      const names = await fs.readdir(item, ...args);
      if (item === root && !changed) { changed = true; await fs.writeFile(path.join(root, 'late.go'), 'late', { mode: 0o600 }); }
      return names;
    },
  });
  await assert.rejects(scan(root), /directory changed/);
}));
