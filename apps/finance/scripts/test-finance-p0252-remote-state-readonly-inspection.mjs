import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = new URL('./finance-p0252-remote-state-readonly-inspection.sh', import.meta.url);
const source = readFileSync(path, 'utf8');

for (const required of [
  'p0247-finance-phase3-20260823T073800Z',
  'p0251-finance-p0247-cleanup-20260823T100000Z',
  '/opt/ynx/stage/finance',
  '/var/backups/ynx-finance',
  '/opt/ynx/releases/finance',
  '/opt/ynx/leases/finance',
  '/opt/ynx/finance-current',
  '/etc/ynx/finance.env',
  '/etc/systemd/system/ynx-finance.service',
  '/etc/caddy/conf.d/ynx-finance.caddy',
  '/var/lib/ynx/finance/state.json',
  'systemctl show',
  'curl --silent --show-error --max-time 10',
  'inspectionComplete=true',
  'mutationCount=0'
]) assert.ok(source.includes(required), `missing ${required}`);

for (const forbidden of [
  /\brm\s/, /\brmdir\s/, /\bmkdir\s/, /\bmv\s/, /\bcp\s/, /\btouch\s/,
  /\bchmod\s/, /\bchown\s/, /systemctl\s+(restart|start|stop|reload)/,
  /curl[^\n]*(--request|-X)\s*(POST|PUT|PATCH|DELETE)/,
  /cat\s+\/etc\/ynx\/finance\.env/
]) assert.doesNotMatch(source, forbidden);

assert.match(source, /^set -euo pipefail$/m);
console.log('finance P0-252 read-only inspection command object: PASS');
