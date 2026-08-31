#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const transportSource = readFileSync(new URL('./finance-p0318-retained-control-cleanup-openssh.sh', import.meta.url), 'utf8');
const cleanupSourcePath = new URL('./finance-p0318-retained-control-cleanup.py', import.meta.url).pathname;
const sha = value => createHash('sha256').update(value).digest('hex');
const cleanupId = 'p0321-finance-p0318-retained-control-cleanup-20260831T070000Z';
const targetId = 'finance-combined-4f7fba323a89-20260831t041500z';

function inspect(cleanup, parent, env) {
  const result = spawnSync('/usr/bin/python3', [cleanup, 'inspect', parent], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function make({ silent = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'finance-p0318-cleanup-ssh-'));
  const parent = join(root, 'finance'); mkdirSync(parent, { mode: 0o750 });
  const executorTarget = join(parent, `${targetId}.executor.sh`), leaseTarget = join(parent, `${targetId}.json`);
  writeFileSync(executorTarget, '#!/bin/bash\nexit 0\n'); chmodSync(executorTarget, 0o700);
  writeFileSync(leaseTarget, '{"lease":{"signed":true}}\n'); chmodSync(leaseTarget, 0o600);
  writeFileSync(join(parent, 'preserve-one'), 'one'); writeFileSync(join(parent, 'preserve-two'), 'two');
  const env = { ...process.env, FINANCE_P0318_CLEANUP_TEST_ROOT: '1', FINANCE_P0318_CLEANUP_TEST_ALLOW_PORTABLE_RENAME: '1' };
  const before = inspect(cleanupSourcePath, parent, env);
  const item = name => before.children.find(value => value.name === name);
  const remaining = before.children.filter(value => ![`${targetId}.executor.sh`, `${targetId}.json`].includes(value.name));
  const postInventory = sha(Buffer.from(JSON.stringify(remaining.map(value => ({ name: value.name, sha256: value.sha256, tuple: value.tuple })))));
  const payload = {
    lease: { signed: true, kind: 'FINANCE_P0318_RETAINED_CONTROL_CLEANUP_ONLY', id: cleanupId },
    parent: { path: parent, parentFullTuple: before.parentFullTuple, parentStableIdentity: before.parentStableIdentity, directChildren: before.directChildren, inventorySha256: before.inventorySha256 },
    targets: {
      executor: { path: executorTarget, tuple: item(`${targetId}.executor.sh`).tuple, bytes: readFileSync(executorTarget).length, sha256: item(`${targetId}.executor.sh`).sha256 },
      signedLease: { path: leaseTarget, tuple: item(`${targetId}.json`).tuple, bytes: readFileSync(leaseTarget).length, sha256: item(`${targetId}.json`).sha256 },
    },
    postCleanup: { parentStableIdentity: before.parentStableIdentity, directChildren: remaining.length, inventorySha256: postInventory },
  };
  const lease = join(root, 'signed-cleanup.json'); writeFileSync(lease, `${JSON.stringify(payload)}\n`);
  const outputPrefix = join('/tmp', `finance-p0318-cleanup-transport-${root.split('/').at(-1)}`);
  const stdout = `${outputPrefix}.stdout`, stderr = `${outputPrefix}.stderr`, receipt = `${outputPrefix}.receipt`;
  const bin = join(root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'base64'), '#!/bin/sh\nexec /opt/homebrew/bin/gbase64 "$@"\n'); chmodSync(join(bin, 'base64'), 0o700);
  const ssh = join(root, 'ssh');
  writeFileSync(ssh, silent ? '#!/bin/bash\nexit 0\n' : `#!/bin/bash\nset -eu\nwhile [[ "$1" != ubuntu@43.153.202.237 ]]; do shift; done\nshift\nPATH=${JSON.stringify(bin)}:$PATH exec /bin/bash -c "$1"\n`); chmodSync(ssh, 0o700);
  const sudo = join(root, 'sudo'); writeFileSync(sudo, '#!/bin/bash\nset -eu\ntest "$1" = -n; shift\nexec "$@"\n'); chmodSync(sudo, 0o700);
  const runner = join(root, 'runner.sh');
  const runnerSource = transportSource
    .replaceAll('/usr/bin/ssh', ssh)
    .replaceAll('/usr/bin/sudo', sudo)
    .replaceAll('/Users/huangjiahao/Downloads/Huang.pem', join(root, 'identity'))
    .replaceAll('/Users/huangjiahao/.ssh/known_hosts', join(root, 'known_hosts'))
    .replace('exec /usr/bin/python3 -c "$executor" cleanup "$1"', 'exec /usr/bin/env FINANCE_P0318_CLEANUP_TEST_ROOT=1 FINANCE_P0318_CLEANUP_TEST_ALLOW_PORTABLE_RENAME=1 /usr/bin/python3 -c "$executor" cleanup "$1"')
    .replaceAll('/opt/homebrew/bin/gmv -T --', '/bin/mv --');
  writeFileSync(runner, runnerSource); chmodSync(runner, 0o700);
  const cleanup = readFileSync(cleanupSourcePath), leaseBody = readFileSync(lease);
  const args = [cleanupSourcePath, lease, stdout, stderr, receipt, String(cleanup.length), sha(cleanup), String(leaseBody.length), sha(leaseBody), 'P0318_RETAINED_CONTROL_PAIR_REMOVED'];
  return { root, runner, args, stdout, stderr, receipt, executorTarget, leaseTarget, outputs: [stdout, stderr, receipt, `${receipt}.pending`] };
}
function close(f) { for (const path of f.outputs) rmSync(path, { force: true }); rmSync(f.root, { recursive: true, force: true }); }

{
  const f = make(); const result = spawnSync('/bin/bash', [f.runner, ...f.args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${existsSync(f.stderr) ? readFileSync(f.stderr, 'utf8') : ''}`);
  assert.equal(existsSync(f.executorTarget), false); assert.equal(existsSync(f.leaseTarget), false);
  assert.match(readFileSync(f.receipt, 'utf8'), /terminalReceiptValidated=true/); close(f);
}
{
  const f = make({ silent: true }); const result = spawnSync('/bin/bash', [f.runner, ...f.args], { encoding: 'utf8' });
  assert.equal(result.status, 65); assert.ok(existsSync(f.executorTarget)); assert.ok(existsSync(f.leaseTarget)); assert.match(readFileSync(f.receipt, 'utf8'), /terminalReceiptValidated=false/); close(f);
}
{
  const f = make(); f.args[8] = '0'.repeat(64); const result = spawnSync('/bin/bash', [f.runner, ...f.args]);
  assert.notEqual(result.status, 0); assert.ok(existsSync(f.executorTarget)); assert.ok(existsSync(f.leaseTarget)); assert.equal(existsSync(f.receipt), false); close(f);
}

console.log('finance P0-318 retained-control cleanup OpenSSH fixture: pass');
