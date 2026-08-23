import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  /\brm\s/, /\brmdir\s/, /\bmkdir\s/, /\bmv\s/, /\bcp\s/, /\btouch\s/,
  /\bchmod\s/, /\bchown\s/, /\bln\s+-s/, /systemctl\s+(restart|start|stop|reload)/,
  /curl[^\n]*(--request|-X)\s*(POST|PUT|PATCH|DELETE)/,
  /cat\s+\/etc\/ynx\/finance\.env/, /journalctl/, /ssh\s/, /scp\s/
]) assert.doesNotMatch(source, forbidden);

assert.match(source, /^set -euo pipefail$/m);
assert.doesNotMatch(source, /SECRET=|PRIVATE KEY|mnemonic|eth_requestAccounts|personal_sign/);
console.log('finance P0-303 P0-302 read-only inspection command object: PASS');
