#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const executor = new URL('./finance-p0318-retained-control-cleanup.py', import.meta.url).pathname;
const targetId = 'finance-combined-4f7fba323a89-20260831t041500z';
const digest = value => createHash('sha256').update(value).digest('hex');
const inspect = parent => {
  const result = spawnSync('/usr/bin/python3', [executor, 'inspect', parent], { encoding: 'utf8', env: { ...process.env, FINANCE_P0318_CLEANUP_TEST_ROOT: '1' } });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return JSON.parse(result.stdout);
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'finance-p0318-control-cleanup-'));
  const parent = join(root, 'finance');
  const mkdir = spawnSync('mkdir', ['-m', '0750', parent]);
  assert.equal(mkdir.status, 0);
  const targets = {
    executor: join(parent, `${targetId}.executor.sh`),
    signedLease: join(parent, `${targetId}.json`),
  };
  writeFileSync(targets.executor, '#!/bin/bash\nexit 0\n'); chmodSync(targets.executor, 0o700);
  writeFileSync(targets.signedLease, '{"lease":{"signed":true}}\n'); chmodSync(targets.signedLease, 0o600);
  const sentinels = [join(parent, 'old-runtime-current.sentinel'), join(parent, 'old-runtime-env.sentinel')];
  writeFileSync(sentinels[0], 'current-unchanged\n');
  writeFileSync(sentinels[1], 'env-unchanged\n');
  const before = inspect(parent);
  const child = name => before.children.find(item => item.name === name);
  const remaining = before.children.filter(item => !Object.values(targets).some(path => path.endsWith(`/${item.name}`)));
  const postInventory = digest(JSON.stringify(remaining.map(item => ({ name: item.name, sha256: item.sha256, tuple: item.tuple }))));
  const payload = {
    lease: { signed: true, kind: 'FINANCE_P0318_RETAINED_CONTROL_CLEANUP_ONLY', id: 'p0321-finance-p0318-retained-control-cleanup-20260831T070000Z' },
    parent: { path: parent, parentFullTuple: before.parentFullTuple, parentStableIdentity: before.parentStableIdentity, directChildren: before.directChildren, inventorySha256: before.inventorySha256 },
    targets: {
      executor: { path: targets.executor, tuple: child(`${targetId}.executor.sh`).tuple, bytes: readFileSync(targets.executor).length, sha256: child(`${targetId}.executor.sh`).sha256 },
      signedLease: { path: targets.signedLease, tuple: child(`${targetId}.json`).tuple, bytes: readFileSync(targets.signedLease).length, sha256: child(`${targetId}.json`).sha256 },
    },
    postCleanup: { parentStableIdentity: before.parentStableIdentity, directChildren: remaining.length, inventorySha256: postInventory },
  };
  const run = () => spawnSync('/usr/bin/python3', [executor, 'cleanup', Buffer.from(JSON.stringify(payload)).toString('base64')], { encoding: 'utf8', env: { ...process.env, FINANCE_P0318_CLEANUP_TEST_ROOT: '1', FINANCE_P0318_CLEANUP_TEST_ALLOW_PORTABLE_RENAME: '1' } });
  return { root, parent, targets, sentinels, payload, run };
}

{
  const f = fixture(); const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).cleanup, 'P0318_RETAINED_CONTROL_PAIR_REMOVED');
  assert.equal(existsSync(f.targets.executor), false); assert.equal(existsSync(f.targets.signedLease), false);
  assert.equal(readFileSync(f.sentinels[0], 'utf8'), 'current-unchanged\n'); assert.equal(readFileSync(f.sentinels[1], 'utf8'), 'env-unchanged\n');
  rmSync(f.root, { recursive: true, force: true });
}
{
  const f = fixture(); unlinkSync(f.targets.executor); writeFileSync(f.targets.executor, '#!/bin/bash\nexit 0\n'); chmodSync(f.targets.executor, 0o700);
  const result = f.run(); assert.notEqual(result.status, 0, 'same-byte new-inode substitution fails'); assert.ok(existsSync(f.targets.executor)); assert.ok(existsSync(f.targets.signedLease)); rmSync(f.root, { recursive: true, force: true });
}
{
  const f = fixture(); unlinkSync(f.targets.executor); symlinkSync(f.sentinels[0], f.targets.executor);
  const result = f.run(); assert.notEqual(result.status, 0, 'symlink substitution fails'); assert.ok(existsSync(f.targets.signedLease)); assert.equal(readFileSync(f.sentinels[0], 'utf8'), 'current-unchanged\n'); rmSync(f.root, { recursive: true, force: true });
}
{
  const f = fixture(); writeFileSync(join(f.parent, 'foreign-child'), 'preserve');
  const result = f.run(); assert.notEqual(result.status, 0, 'parent inventory drift fails before cleanup'); assert.ok(existsSync(f.targets.executor)); assert.ok(existsSync(f.targets.signedLease)); assert.equal(readFileSync(join(f.parent, 'foreign-child'), 'utf8'), 'preserve'); rmSync(f.root, { recursive: true, force: true });
}
{
  const f = fixture(); writeFileSync(join(f.parent, `.${f.payload.lease.id}.executor.owned`), 'foreign');
  f.payload.parent = { path: f.parent, ...inspect(f.parent) }; delete f.payload.parent.children;
  const result = f.run(); assert.notEqual(result.status, 0, 'preexisting quarantine fails closed'); assert.ok(existsSync(f.targets.executor)); assert.ok(existsSync(f.targets.signedLease)); rmSync(f.root, { recursive: true, force: true });
}

console.log('finance P0-318 retained-control cleanup fixture: pass');
