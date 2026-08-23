#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const repo = process.cwd(), gstat = '/opt/homebrew/bin/gstat', grm = '/opt/homebrew/bin/grm';
const id = 'p0276-finance-p0272-control-cleanup-20260824T000000Z', targetId = 'p0272-finance-phase3-20260823T152627Z';
const digest = value => createHash('sha256').update(value).digest('hex');
const tuple = path => execFileSync(gstat, ['-Lc', '%d:%i:%u:%g:%a:%h:%s:%F', path], { encoding: 'utf8' }).trim();
const stable = path => execFileSync(gstat, ['-Lc', '%d:%i:%u:%g:%a:%F', path], { encoding: 'utf8' }).trim();
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'finance-p0275-transport-')), opt = join(root, 'opt', 'ynx'), parent = join(opt, 'leases', 'finance'), temp = join(root, 'tmp');
  mkdirSync(parent, { recursive: true, mode: 0o750 }); mkdirSync(temp); chmodSync(parent, 0o750);
  const targetExecutor = join(parent, `${targetId}.executor.sh`), targetLease = join(parent, `${targetId}.json`); writeFileSync(targetExecutor, 'P0272 executor\n'); chmodSync(targetExecutor, 0o700); writeFileSync(targetLease, '{"signed":true}\n'); chmodSync(targetLease, 0o600);
  const executor = join(temp, `ynx-finance-${id}.executor.sh`), lease = join(temp, `ynx-finance-${id}.json`);
  const executorBytes = Buffer.from(readFileSync(join(repo, 'apps/finance/scripts/finance-p0272-control-cleanup.sh'), 'utf8').replaceAll('/opt/ynx', opt).replaceAll('/tmp/ynx-finance-p0276-finance-p0272-control-cleanup-', join(temp, 'ynx-finance-p0276-finance-p0272-control-cleanup-')).replaceAll('stat -Lc', `${gstat} -Lc`).replaceAll('realpath -e --', "printf '%s\\n'").replaceAll('rm --', `${grm} --`));
  const payload = { lease: { signed: true, kind: 'FINANCE_P0272_CONTROL_CLEANUP_ONLY', id }, parent: { path: parent, tuple: tuple(parent), stableIdentity: stable(parent) }, targets: { executor: { path: targetExecutor, tuple: tuple(targetExecutor), bytes: readFileSync(targetExecutor).length, sha256: digest(readFileSync(targetExecutor)) }, signedLease: { path: targetLease, tuple: tuple(targetLease), bytes: readFileSync(targetLease).length, sha256: digest(readFileSync(targetLease)) } }, transport: { executor: { path: executor, bytes: executorBytes.length, sha256: digest(executorBytes) }, lease: { path: lease } } };
  const leaseBytes = Buffer.from(JSON.stringify(payload) + '\n');
  const frame = (name, data, mode) => `${name}\t${data.length}\t${digest(data)}\t${mode}\t${data.toString('base64')}\n`;
  const carrier = (a = executorBytes, b = leaseBytes, end = 'END\n') => Buffer.from(frame('executor', a, '700') + frame('signedLease', b, '600') + end);
  const bootstrap = readFileSync(join(repo, 'apps/finance/scripts/finance-p0275-cleanup-stdin-bootstrap.sh'), 'utf8').replaceAll('/tmp/ynx-finance', join(temp, 'ynx-finance')).replaceAll('stat -Lc', `${gstat} -Lc`).replaceAll('rm --', `${grm} --`).replaceAll('base64 -d', 'base64 -D');
  const remoteLauncher = 'bootstrap_source=$(printf "%s" "$1" | base64 -D) || exit 65; shift; exec /bin/bash -c "$bootstrap_source" p0276 "$@"';
  const args = [id, executor, String(executorBytes.length), digest(executorBytes), lease, String(leaseBytes.length), digest(leaseBytes)];
  return { root, parent, targetExecutor, targetLease, executor, lease, executorBytes, leaseBytes, carrier, bootstrapB64: Buffer.from(bootstrap).toString('base64'), remoteLauncher, args };
}
const run = (f, input) => spawnSync('/bin/bash', [...(process.env.FINANCE_TRACE ? ['-x'] : []), '-c', f.remoteLauncher, 'p0276', f.bootstrapB64, ...f.args], { input, env: { ...process.env }, encoding: 'utf8' });
const gone = f => { assert.equal(existsSync(f.executor), false, 'temporary executor finalized'); assert.equal(existsSync(f.lease), false, 'temporary signed lease finalized'); };
const clean = f => rmSync(f.root, { recursive: true, force: true });
{ const f = setup(), before = stable(f.parent), r = run(f, f.carrier()); assert.equal(r.status, 0, `${r.stdout}${r.stderr}`); assert.match(r.stdout, /cleanup=P0272_CONTROL_FILES_REMOVED/); assert.equal(existsSync(f.targetExecutor), false); assert.equal(existsSync(f.targetLease), false); assert.equal(stable(f.parent), before); gone(f); clean(f); }
{ const f = setup(), r = run(f, Buffer.alloc(0)); assert.notEqual(r.status, 0, 'empty carrier rejected'); assert.ok(existsSync(f.targetExecutor)); assert.ok(existsSync(f.targetLease)); gone(f); clean(f); }
{ const f = setup(), r = run(f, f.carrier().subarray(0, -9)); assert.notEqual(r.status, 0, 'truncated frame rejected'); assert.ok(existsSync(f.targetExecutor)); assert.ok(existsSync(f.targetLease)); gone(f); clean(f); }
{ const f = setup(), frame = f.carrier().toString().split('\n')[0] + '\n', r = run(f, Buffer.from(frame + frame + 'END\n')); assert.notEqual(r.status, 0, 'duplicate frame rejected'); assert.ok(existsSync(f.targetExecutor)); assert.ok(existsSync(f.targetLease)); gone(f); clean(f); }
{ const f = setup(), silent = Buffer.from('#!/usr/bin/env bash\nexit 0\n'), r = run(f, f.carrier(silent, f.leaseBytes)); assert.notEqual(r.status, 0, 'silent rc0 executor rejected'); assert.ok(existsSync(f.targetExecutor)); assert.ok(existsSync(f.targetLease)); gone(f); clean(f); }
console.log('finance P0275 stdin cleanup transport actual-shell fixture: PASS');
