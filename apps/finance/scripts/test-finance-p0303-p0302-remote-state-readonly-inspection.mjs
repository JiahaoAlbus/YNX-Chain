import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = readFileSync(new URL('./finance-p0303-p0302-remote-state-readonly-inspection.sh', import.meta.url), 'utf8');
for (const required of [
  'p0302-finance-phase3-20260823t211500z',
  'p0302ExecutorPending', 'p0302Executor', 'p0302LeasePending', 'p0302Lease', 'p0302ManualRollbackLease',
  'p0302StageContainer', 'p0302Stage', 'p0302BackupContainer', 'p0302Backup', 'p0302ReleaseContainer', 'p0302Release',
  'currentLink', 'currentResolved', 'currentNext', 'currentRollback',
  '/etc/ynx/finance.env', '/etc/systemd/system/ynx-finance.service', '/etc/caddy/conf.d/ynx-finance.caddy', '/var/lib/ynx/finance/state.json',
  'serviceMainPID', 'serviceNRestarts', 'serviceExecStartSha256', 'serviceWorkingDirectory', 'serviceUser', 'serviceGroup',
  'loopbackRoot', 'loopbackHealth', 'loopbackVersion', 'publicRoot', 'publicHealth', 'publicVersion',
  'inspectionComplete=true', 'mutationCount=0'
]) assert.ok(source.includes(required), `missing ${required}`);

for (const forbidden of [
  /\brmdir\s/, /\bmkdir\s/, /\bmv\s/, /\bcp\s/, /\btouch\s/,
  /\bchmod\s/, /\bchown\s/, /\bln\s+-s/, /systemctl\s+(restart|start|stop|reload)/,
  /curl[^\n]*(--request|-X)\s*(POST|PUT|PATCH|DELETE)/,
  /cat\s+\/etc\/ynx\/finance\.env/, /journalctl/, /ssh\s/, /scp\s/,
  /response=\$\(curl/, /body=\$\{response/, /printf %s "\$body"/
]) assert.doesNotMatch(source, forbidden);

assert.match(source, /^set -euo pipefail$/m);
assert.doesNotMatch(source, /SECRET=|PRIVATE KEY|mnemonic|eth_requestAccounts|personal_sign/);
assert.match(source, /curl[^\n]*--output "\$tmp"/);
assert.match(source, /"\$\(bytes "\$tmp"\)"/);
assert.match(source, /"\$\(sha "\$tmp"\)"/);
assert.equal((source.match(/command rm -f -- "\$tmp"/g) ?? []).length, 2, 'only owned HTTP temp cleanup is allowed');

// Execute the exact helper against a body ending in two LF bytes. Shell command
// substitution would discard both; the file-backed receipt must retain them.
const fixture = mkdtempSync(join(tmpdir(), 'finance-p0303-http-'));
const bin = join(fixture, 'bin');
await import('node:fs').then(({ mkdirSync }) => mkdirSync(bin));
const curl = join(bin, 'curl');
writeFileSync(curl, '#!/usr/bin/env bash\nset -euo pipefail\nout=\nwhile (($#)); do case "$1" in --output) out=$2; shift 2;; --write-out|--max-time) shift 2;; --silent|--show-error) shift;; *) shift;; esac; done\nprintf "x\\n\\n" > "$out"\nprintf 200\n');
chmodSync(curl, 0o755);
const helperStart = source.indexOf('sha(){');
const helperEnd = source.indexOf('\nid=p0302-');
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'HTTP helper boundary found');
const harness = `${source.slice(helperStart, helperEnd)}\nhttp_receipt test https://example.invalid/\n`;
const result = spawnSync('/bin/bash', ['-c', harness], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: fixture }, encoding: 'utf8' });
assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
const raw = Buffer.from('x\n\n');
const expectedSha = createHash('sha256').update(raw).digest('hex');
assert.match(result.stdout, /^testBytes=3$/m, 'trailing LF bytes are retained');
assert.match(result.stdout, new RegExp(`^testSha256=${expectedSha}$`, 'm'), 'whole raw body SHA is retained');
const strippedSha = createHash('sha256').update(Buffer.from('x')).digest('hex');
assert.notEqual(expectedSha, strippedSha, 'regression vector detects command-substitution newline loss');
assert.deepEqual(readdirSync(fixture).sort(), ['bin'], 'owned HTTP temp is removed');
console.log('finance P0-303 P0-302 read-only inspection command object: PASS');
