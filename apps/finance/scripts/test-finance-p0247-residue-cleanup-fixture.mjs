#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repo = process.cwd();
const source = join(repo, 'apps/finance/scripts/finance-p0247-residue-cleanup.sh');
const sha = value => createHash('sha256').update(value).digest('hex');
const run = (file, env = {}) => spawnSync('bash', [ ...(env.FINANCE_TRACE ? ['-x'] : []), source, file.lease], { env: { ...process.env, FINANCE_RESIDUE_CLEANUP_TEST_ROOT: '1', ...env }, encoding: 'utf8' });
const gstat = '/opt/homebrew/bin/gstat';
const gsort = '/opt/homebrew/bin/gsort';
const stat = path => execFileSync(gstat, ['-Lc', '%d:%i:%u:%g:%a:%h:%s:%F', path], { encoding: 'utf8' }).trim();
const tree = path => execFileSync('bash', ['-c', `cd -- "$1"; find -P . -mindepth 1 -print0 | LC_ALL=C ${gsort} -z | while IFS= read -r -d '' item; do rel="${'${item#./}'}"; kind=$(${gstat} -Lc '%F' -- "$item"); case "$kind" in 'regular file'|'regular empty file') value=$(sha256sum -- "$item"|awk '{print $1}');; directory) value=-;; *) exit 65;; esac; printf '%s\\t%s\\t%s\\t%s\\n' "$rel" "$kind" "$(${gstat} -Lc '%d:%i:%u:%g:%a:%h:%s:%F' -- "$item")" "$value"; done | sha256sum | awk '{print $1}'`, 'bash', path], { encoding: 'utf8' }).trim();

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ynx-finance-cleanup-')));
  const stageParent = join(root, 'stage'); const backupParent = join(root, 'backup');
  const stage = join(stageParent, 'p0247-stage'); const backup = join(backupParent, 'p0247-backup');
  const current = join(root, 'current'); const old = join(root, 'old'); const env = join(root, 'finance.env'); const unit = join(root, 'unit'); const caddy = join(root, 'caddy');
  mkdirSync(stage, { recursive: true, mode: 0o700 }); mkdirSync(backup, { recursive: true, mode: 0o700 }); mkdirSync(old); symlinkSync(old, current);
  writeFileSync(join(backup, 'env'), 'non-secret fixture hash only\n'); writeFileSync(join(backup, 'state-absent'), '');
  writeFileSync(env, 'fixture-env\n'); writeFileSync(unit, 'fixture-unit\n'); writeFileSync(caddy, 'fixture-caddy\n');
  const bin = join(root, 'bin'); mkdirSync(bin); const serviceLog = join(root, 'service.log');
  writeFileSync(join(bin, 'stat'), `#!/bin/sh\nexec ${gstat} "$@"\n`); chmodSync(join(bin, 'stat'), 0o755);
  writeFileSync(join(bin, 'sort'), `#!/bin/sh\nexec ${gsort} "$@"\n`); chmodSync(join(bin, 'sort'), 0o755);
  writeFileSync(join(bin, 'realpath'), '#!/bin/sh\nexec /opt/homebrew/bin/grealpath "$@"\n'); chmodSync(join(bin, 'realpath'), 0o755);
  writeFileSync(join(bin, 'rm'), '#!/bin/sh\nexec /opt/homebrew/bin/grm "$@"\n'); chmodSync(join(bin, 'rm'), 0o755);
  writeFileSync(join(bin, 'systemctl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(serviceLog)}\ncase "$1" in is-active) exit 0;; show) case "$2" in -p) case "$3" in MainPID) echo 123;; NRestarts) echo 0;; esac;; esac;; esac\n`); chmodSync(join(bin, 'systemctl'), 0o755);
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\nout=""; while [ "$#" -gt 0 ]; do [ "$1" = -o ] && { out=$2; shift 2; continue; }; shift; done; printf ok > "$out"; printf 200\n'); chmodSync(join(bin, 'curl'), 0o755);
  const mkLease = () => {
    const object = { lease: { signed: true, kind: 'FINANCE_P0247_RESIDUE_CLEANUP_ONLY', p0247: { id: 'p0247-finance-phase3-20260823T073800Z' } }, targets: { stage: { path: stage, basename: basename(stage), parent: { path: stageParent, tuple: stat(stageParent) }, tuple: stat(stage), inventorySha256: tree(stage) }, backup: { path: backup, basename: basename(backup), parent: { path: backupParent, tuple: stat(backupParent) }, tuple: stat(backup), inventorySha256: tree(backup) } }, fresh: { current: { path: current, target: old }, env: { path: env, tuple: stat(env), sha256: sha(readFileSync(env)) }, unit: { path: unit, tuple: stat(unit), sha256: sha(readFileSync(unit)) }, caddy: { path: caddy, tuple: stat(caddy), sha256: sha(readFileSync(caddy)) }, service: { name: 'ynx-finance', pid: '123', nrestarts: '0' }, public: { health: { url: 'https://fixture/health', status: '200', bytes: '2', sha256: sha('ok') }, version: { url: 'https://fixture/version', status: '200', bytes: '2', sha256: sha('ok') } } } };
    writeFileSync(lease, JSON.stringify(object));
  };
  const lease = join(root, 'lease.json'); mkLease();
  return { root, stageParent, backupParent, stage, backup, current, old, env, unit, caddy, lease, mkLease, serviceLog };
}
function cleanup(f) { rmSync(f.root, { recursive: true, force: true }); }
function unchanged(f, before) { assert.equal(readFileSync(f.serviceLog, 'utf8').includes('restart'), false); for (const p of [f.env, f.unit, f.caddy]) assert.equal(sha(readFileSync(p)), before[p]); assert.equal(execFileSync('readlink', ['-f', f.current], { encoding: 'utf8' }).trim(), f.old); }

{ const f = setup(); const before = Object.fromEntries([f.env, f.unit, f.caddy].map(p => [p, sha(readFileSync(p))])); const r = run(f, { PATH: `${join(f.root, 'bin')}:${process.env.PATH}` }); assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`); assert.equal(existsSync(f.stage), false); assert.equal(existsSync(f.backup), false); unchanged(f, before); cleanup(f); }
{ const f = setup(); const sentinel = join(f.root, 'sentinel'); writeFileSync(sentinel, 'keep'); rmSync(f.stage, { recursive: true }); symlinkSync(sentinel, f.stage); const r = run(f, { PATH: `${join(f.root, 'bin')}:${process.env.PATH}` }); assert.notEqual(r.status, 0); assert.equal(readFileSync(sentinel, 'utf8'), 'keep'); assert.ok(lstatSync(f.stage).isSymbolicLink()); cleanup(f); }
{ const f = setup(); writeFileSync(join(f.backup, 'foreign'), 'foreign'); const r = run(f, { PATH: `${join(f.root, 'bin')}:${process.env.PATH}` }); assert.notEqual(r.status, 0); assert.ok(existsSync(f.stage)); assert.ok(existsSync(f.backup)); cleanup(f); }
{ const f = setup(); writeFileSync(join(f.backup, 'env'), 'changed'); const r = run(f, { PATH: `${join(f.root, 'bin')}:${process.env.PATH}` }); assert.notEqual(r.status, 0); assert.ok(existsSync(f.stage)); assert.ok(existsSync(f.backup)); cleanup(f); }
{ const f = setup(); rmSync(f.stage, { recursive: true }); rmSync(f.backup, { recursive: true }); const r = run(f, { PATH: `${join(f.root, 'bin')}:${process.env.PATH}` }); assert.equal(r.status, 0, r.stderr); cleanup(f); }
{ const f = setup(); rmSync(f.stage, { recursive: true }); const r = run(f, { PATH: `${join(f.root, 'bin')}:${process.env.PATH}` }); assert.notEqual(r.status, 0); assert.ok(existsSync(f.backup)); cleanup(f); }
{ const f = setup(); const sibling = join(f.backupParent, 'foreign-sibling'); writeFileSync(sibling, 'keep'); f.mkLease(); const fakeRm = join(f.root, 'fake-rm'); writeFileSync(fakeRm, `#!/bin/sh\nlast=; for arg in "$@"; do last=$arg; done\nif [ "$last" = ${JSON.stringify(f.backup)} ]; then /opt/homebrew/bin/grm -rf -- ${JSON.stringify(f.backup)}; ln -s ${JSON.stringify(sibling)} ${JSON.stringify(f.backup)}; exit 1; fi\nexec /opt/homebrew/bin/grm "$@"\n`); chmodSync(fakeRm, 0o755); writeFileSync(join(f.root, 'bin', 'rm'), `#!/bin/sh\nexec ${JSON.stringify(fakeRm)} "$@"\n`); chmodSync(join(f.root, 'bin', 'rm'), 0o755); const r = run(f, { PATH: `${join(f.root, 'bin')}:${process.env.PATH}` }); assert.notEqual(r.status, 0); assert.equal(readFileSync(sibling, 'utf8'), 'keep'); assert.ok(lstatSync(f.backup).isSymbolicLink()); cleanup(f); }
console.log('finance P0-247 residue cleanup actual-shell fixture: PASS');
