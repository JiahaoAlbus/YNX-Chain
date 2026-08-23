#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const repo = process.cwd();
const source = join(repo, 'apps/finance/scripts/finance-p0272-control-cleanup.sh');
const gstat = '/opt/homebrew/bin/gstat', grm = '/opt/homebrew/bin/grm';
const id = 'p0272-finance-phase3-20260823T152627Z';
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const tuple = path => execFileSync(gstat, ['-Lc', '%d:%i:%u:%g:%a:%h:%s:%F', path], { encoding: 'utf8' }).trim();
const stable = path => execFileSync(gstat, ['-Lc', '%d:%i:%u:%g:%a:%F', path], { encoding: 'utf8' }).trim();
function make() {
  const root = mkdtempSync(join(tmpdir(), 'finance-p0272-cleanup-'));
  const parent = join(root, 'opt', 'ynx', 'leases', 'finance'); mkdirSync(parent, { recursive: true, mode: 0o750 }); chmodSync(parent, 0o750);
  const executor = join(parent, `${id}.executor.sh`), signedLease = join(parent, `${id}.json`);
  writeFileSync(executor, 'P0272 reviewed executor\n'); chmodSync(executor, 0o700);
  writeFileSync(signedLease, '{"lease":{"signed":true}}\n'); chmodSync(signedLease, 0o600);
  const lease = join(root, 'cleanup.json');
  const payload = () => ({ lease: { signed: true, kind: 'FINANCE_P0272_CONTROL_CLEANUP_ONLY', id }, parent: { path: parent, tuple: tuple(parent), stableIdentity: stable(parent) }, targets: { executor: { path: executor, tuple: tuple(executor), bytes: readFileSync(executor).length, sha256: sha(executor) }, signedLease: { path: signedLease, tuple: tuple(signedLease), bytes: readFileSync(signedLease).length, sha256: sha(signedLease) } } });
  const writeLease = () => writeFileSync(lease, `${JSON.stringify(payload())}\n`); writeLease();
  const runner = join(root, 'cleanup.sh');
  writeFileSync(runner, readFileSync(source, 'utf8').replaceAll('/opt/ynx', join(root, 'opt', 'ynx')).replaceAll('stat -Lc', `${gstat} -Lc`).replaceAll('realpath -e --', "printf '%s\\n'").replaceAll('rm --', `${grm} --`)); chmodSync(runner, 0o700);
  return { root, parent, executor, signedLease, lease, writeLease, runner };
}
const run = f => spawnSync('/bin/bash', [f.runner, f.lease], { env: { ...process.env, FINANCE_P0272_CONTROL_CLEANUP_TEST_ROOT: '1' }, encoding: 'utf8' });
const clean = f => rmSync(f.root, { recursive: true, force: true });
{ const f = make(), before = stable(f.parent), r = run(f); assert.equal(r.status, 0, `${r.stdout}${r.stderr}`); assert.match(r.stdout, /cleanup=P0272_CONTROL_FILES_REMOVED/); assert.equal(existsSync(f.executor), false); assert.equal(existsSync(f.signedLease), false); assert.equal(stable(f.parent), before); assert.equal(readFileSync(f.lease, 'utf8').includes('signed'), true, 'separate local request retained'); clean(f); }
{ const f = make(), sentinel = join(f.root, 'sentinel'); writeFileSync(sentinel, 'keep'); rmSync(f.executor); symlinkSync(sentinel, f.executor); const r = run(f); assert.notEqual(r.status, 0); assert.ok(lstatSync(f.executor).isSymbolicLink()); assert.equal(readFileSync(sentinel, 'utf8'), 'keep'); assert.ok(existsSync(f.signedLease)); clean(f); }
{ const f = make(); chmodSync(f.parent, 0o700); const r = run(f); assert.notEqual(r.status, 0, 'foreign parent tuple refused'); assert.ok(existsSync(f.executor)); assert.ok(existsSync(f.signedLease)); clean(f); }
{ const f = make(), target = join(f.root, 'foreign-parent'); mkdirSync(target); writeFileSync(join(target, 'keep'), 'keep'); rmSync(f.parent, { recursive: true }); symlinkSync(target, f.parent); const r = run(f); assert.notEqual(r.status, 0, 'parent symlink refused'); assert.equal(readFileSync(join(target, 'keep'), 'utf8'), 'keep'); clean(f); }
{ const f = make(); writeFileSync(join(f.parent, 'foreign-child'), 'foreign'); const r = run(f); assert.notEqual(r.status, 0, 'foreign child refused'); assert.ok(existsSync(f.executor)); assert.ok(existsSync(f.signedLease)); clean(f); }
{ const f = make(); linkSync(f.executor, join(f.parent, 'executor-hardlink')); const r = run(f); assert.notEqual(r.status, 0, 'link-count drift refused'); assert.ok(existsSync(f.executor)); assert.ok(existsSync(f.signedLease)); clean(f); }
{ const f = make(); rmSync(f.signedLease); writeFileSync(f.signedLease, '{"lease":{"signed":true}}\n'); chmodSync(f.signedLease, 0o600); const r = run(f); assert.notEqual(r.status, 0, 'same bytes replacement inode refused'); assert.ok(existsSync(f.executor)); assert.ok(existsSync(f.signedLease)); clean(f); }
console.log('finance P0272 control cleanup actual-shell fixture: PASS');
