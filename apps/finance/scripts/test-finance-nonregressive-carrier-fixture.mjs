#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const stat = path => execFileSync('/opt/homebrew/bin/gstat', ['-Lc', '%d:%i:%u:%g:%a:%h:%s:%F', path], { encoding: 'utf8' }).trim();
const sha = body => execFileSync('/usr/bin/shasum', ['-a', '256'], { input: body, encoding: 'utf8' }).trim().split(/\s+/)[0];
const source = readFileSync(new URL('./finance-nonregressive-carrier-bootstrap.sh', import.meta.url), 'utf8');
function fixture(mutate = x => x) {
  const dir = mkdtempSync(join(tmpdir(), 'finance-carrier-')), ynx = join(dir, 'opt', 'ynx'), stage = join(ynx, 'stage', 'finance'), etc = join(dir, 'etc', 'ynx');
  mkdirSync(stage, { recursive: true }); mkdirSync(etc, { recursive: true });
  const env = join(etc, 'finance.env'); writeFileSync(env, 'A=1\nYNX_FINANCE_WEB_DIR=/old/web\nB=2\n');
  const id = 'finance-combined-4f7fba323a89-20260831t041500z', carrier = join(stage, id), archive = Buffer.from('candidate-archive');
  const ownerMode = execFileSync('/opt/homebrew/bin/gstat', ['-Lc', '%u:%g', stage], { encoding: 'utf8' }).trim() + ':700';
  const lease = mutate({ lease: { signed: true, kind: 'FINANCE_NONREGRESSIVE_CARRIER_PREPARATION', id, expiresAt: '2099-01-01T00:00:00Z' }, paths: { carrier }, fresh: { rootTuple: stat(ynx), stageTuple: stat(stage), env: { tuple: stat(env), bytes: readFileSync(env).length, sha256: sha(readFileSync(env)) } }, candidate: { carrierOwnerMode: ownerMode, releaseWebDir: join(ynx, 'releases', 'finance', id, 'ynx-finance-4f7fba323a89', 'web'), archive: { bytes: archive.length, sha256: sha(archive) } } });
  const script = source.replaceAll('/opt/ynx', ynx).replaceAll('/etc/ynx', etc).replaceAll('stat -Lc', '/opt/homebrew/bin/gstat -Lc').replaceAll('mv -T --', '/opt/homebrew/bin/gmv -T --');
  const run = input => spawnSync('/bin/bash', ['-c', script, 'finance-carrier', Buffer.from(JSON.stringify(lease)).toString('base64')], { input, encoding: 'utf8' });
  return { dir, carrier, archive, lease, run };
}
{
  const x = fixture(); const result = x.run(x.archive); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /^phase=carrier-preparation$/m); assert.equal(readFileSync(join(x.carrier, 'candidate.tgz')).toString(), x.archive.toString()); assert.match(readFileSync(join(x.carrier, 'finance.env'), 'utf8'), /YNX_FINANCE_WEB_DIR=.*finance-combined/);
}
for (const kind of ['truncated', 'hash', 'existing', 'symlink']) {
  const x = fixture(lease => { if (kind === 'hash') lease.candidate.archive.sha256 = '0'.repeat(64); return lease; });
  if (kind === 'existing') { mkdirSync(x.carrier); writeFileSync(join(x.carrier, 'foreign'), 'keep'); }
  if (kind === 'symlink') { const target = join(x.dir, 'foreign'); mkdirSync(target); symlinkSync(target, x.carrier); }
  const result = x.run(kind === 'truncated' ? x.archive.subarray(0, 2) : x.archive);
  assert.notEqual(result.status, 0, kind);
  if (kind === 'existing') assert.equal(readFileSync(join(x.carrier, 'foreign'), 'utf8'), 'keep');
}
{
  const x = fixture();
  const foreign = join(x.dir, 'foreign-archive'); writeFileSync(foreign, x.archive);
  const move = 'chmod 0600 "$archive_pending"; mv -T -- "$archive_pending" "$archive"; archive_pending_created=false; archive_created=true; archive_identity=$(identity "$archive"); test "$archive_identity" = "$archive_pending_identity"; archive_sha=$(sha "$archive")';
  const inject = 'chmod 0600 "$archive_pending"; mv -T -- "$archive_pending" "$archive"; archive_pending_created=false; rm "$archive"; ln -s "' + foreign + '" "$archive"; exit 73';
  let substituted = source.replace(move, inject);
  assert.notEqual(substituted, source, 'substitution fixture must patch the post-move boundary');
  substituted = substituted.replaceAll('/opt/ynx', join(x.dir, 'opt', 'ynx')).replaceAll('/etc/ynx', join(x.dir, 'etc', 'ynx')).replaceAll('stat -Lc', '/opt/homebrew/bin/gstat -Lc').replaceAll('mv -T --', '/opt/homebrew/bin/gmv -T --');
  const result = spawnSync('/bin/bash', ['-c', substituted, 'finance-carrier', Buffer.from(JSON.stringify(x.lease)).toString('base64')], { input: x.archive, encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'post-move archive substitution fails closed');
  assert.equal(readFileSync(foreign).toString(), x.archive.toString(), 'foreign substitution target preserved');
}
process.stdout.write('finance non-regressive carrier fixture: pass\n');
