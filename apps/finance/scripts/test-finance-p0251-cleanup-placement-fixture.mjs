#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const repo = process.cwd(); const id = 'p0251-finance-p0247-cleanup-20260823T090000Z';
const bootSource = join(repo, 'apps/finance/scripts/finance-p0251-cleanup-placement-bootstrap.sh');
const builder = join(repo, 'apps/finance/scripts/build-finance-p0251-cleanup-placement-carrier.mjs');
const gstat = '/opt/homebrew/bin/gstat'; const digest = value => createHash('sha256').update(value).digest('hex');
const stat = path => execFileSync(gstat, ['-Lc', '%d:%i:%u:%g:%a:%h:%s:%F', path], { encoding: 'utf8' }).trim();
const sha = path => digest(readFileSync(path)); const bytes = path => readFileSync(path).length;
function make() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ynx-p0251-place-'))); const parent = join(root, 'opt/ynx/leases/finance'); mkdirSync(parent, { recursive: true, mode: 0o750 });
  const bin = join(root, 'bin'); mkdirSync(bin); const executor = join(root, 'executor'); const lease = join(root, 'lease'); const carrier = join(root, 'carrier'); const events = join(root, 'events');
  writeFileSync(executor, `#!/bin/sh\nprintf cleanup-called >> ${JSON.stringify(events)}\n`); chmodSync(executor, 0o700);
  writeFileSync(lease, JSON.stringify({ lease: { signed: true, kind: 'FINANCE_P0247_RESIDUE_CLEANUP_ONLY', id } }));
  execFileSync(process.execPath, [builder, executor, lease, carrier]);
  writeFileSync(join(bin, 'stat'), `#!/bin/sh\nexec ${gstat} "$@"\n`); chmodSync(join(bin, 'stat'), 0o755);
  writeFileSync(join(bin, 'base64'), '#!/bin/sh\nexec /opt/homebrew/bin/gbase64 "$@"\n'); chmodSync(join(bin, 'base64'), 0o755);
  writeFileSync(join(bin, 'rm'), '#!/bin/sh\nexec /opt/homebrew/bin/grm "$@"\n'); chmodSync(join(bin, 'rm'), 0o755);
  writeFileSync(join(bin, 'jq'), '#!/bin/sh\nexec /usr/bin/jq "$@"\n'); chmodSync(join(bin, 'jq'), 0o755);
  const boot = readFileSync(bootSource, 'utf8').replaceAll('/opt/ynx/leases/finance', parent).replaceAll("stat -Lc", `${gstat} -Lc`).replaceAll('rm -f --', '/opt/homebrew/bin/grm -f --').replaceAll('chmod 0700 --', 'chmod 0700').replaceAll('chmod 0600 --', 'chmod 0600').replaceAll('basename --', 'basename');
  const targetExecutor = join(parent, `${id}.executor.sh`); const targetLease = join(parent, `${id}.json`);
  const args = [id, parent, stat(parent), targetExecutor, targetLease, sha(executor), sha(lease), sha(carrier)];
  return { root, parent, executor, lease, carrier, events, boot, targetExecutor, targetLease, args };
}
function run(f, trace = false) { return spawnSync('bash', [ ...(trace ? ['-x'] : []), '-c', f.boot, 'bash', ...f.args], { input: readFileSync(f.carrier), env: { ...process.env, PATH: `${join(f.root, 'bin')}:${process.env.PATH}` }, encoding: 'utf8' }); }
function close(f) { rmSync(f.root, { recursive: true, force: true }); }
{ const f=make(); const r=run(f); assert.equal(r.status,0,`${r.stdout}\n${r.stderr}`); assert.equal(readFileSync(f.events,'utf8'),'cleanup-called'); assert.ok(existsSync(f.targetExecutor)); assert.ok(existsSync(f.targetLease)); close(f); }
{ const f=make(); writeFileSync(f.targetExecutor,'foreign'); const r=run(f); assert.notEqual(r.status,0); assert.equal(readFileSync(f.targetExecutor,'utf8'),'foreign'); assert.equal(existsSync(f.targetLease),false); close(f); }
{ const f=make(); const sentinel=join(f.root,'sentinel'); writeFileSync(sentinel,'keep'); symlinkSync(sentinel,f.targetLease); const r=run(f); assert.notEqual(r.status,0); assert.equal(readFileSync(sentinel,'utf8'),'keep'); assert.ok(lstatSync(f.targetLease).isSymbolicLink()); close(f); }
{ const f=make(); const bad=Buffer.from(readFileSync(f.carrier)); bad[bad.length-5]^=1; writeFileSync(f.carrier,bad); const r=run(f); assert.notEqual(r.status,0); assert.equal(existsSync(f.targetExecutor),false); assert.equal(existsSync(f.targetLease),false); close(f); }
console.log('finance P0-251 cleanup placement actual-shell fixture: PASS');
