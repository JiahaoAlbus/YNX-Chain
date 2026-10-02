import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createWorkspaceStore } from '../../workspace-manager/src/store.mjs';
import { createGitService } from '../src/service.mjs';

const revoked = () => Object.assign(new Error('Wallet identity changed'), { status: 401, code: 'core_identity_changed' });
const protocolVersion = 'ynx-code-git-v1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let attempt = 0; attempt < 200; attempt++) { if (await check()) return; await pause(10); }
  throw new Error('Timed out waiting for the test Git process');
}
async function fixture(t) {
  const root = await realpath(await mkdtemp('/private/tmp/ynx-git-revocation-'));
  const log = join(root, 'commands.log'), hold = join(root, 'hold-next-branch'), pid = join(root, 'held-pid');
  const executable = join(root, 'reviewed-git-test.sh');
  // This wrapper still runs inside the existing macOS sandbox-exec profile.
  // It observes command boundaries and simulates one TERM-ignoring process;
  // there is no alternate sandbox or production execution path.
  await writeFile(executable, `#!/bin/sh
command_name='unknown'
for value in "$@"; do
  case "$value" in init|branch|status|log|for-each-ref|rev-parse|add|commit|checkout|symbolic-ref|show-ref|merge|reset|diff) command_name="$value"; break;; esac
done
printf '%s\\n' "$command_name" >> '${log}'
if [ "$command_name" = 'branch' ] && [ -f '${hold}' ]; then
  /bin/rm '${hold}'
  printf '%s' "$$" > '${pid}'
  trap '' TERM
  while :; do /bin/sleep 1; done
fi
exec /usr/bin/git "$@"
`, { mode: 0o700 });
  await writeFile(log, '');
  const store = createWorkspaceStore({ filename: join(root, 'workspaces.sqlite') });
  const payload = text => ({ name: 'P', folders: [], files: { 'main.ts': text }, open: ['main.ts'], active: 'main.ts' });
  store.put('owner', 'project', { expectedRevision: 0, idempotencyKey: 'initial-workspace', payload: payload('old\n') });
  const service = createGitService({ workspaceStore: store, ownerForRequest: () => 'owner', root: join(root, 'repositories'), gitPath: executable });
  t.after(() => store.close());
  const commands = async () => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean);
  const call = (body, operation) => service.runForOwner('owner', 'project', body, operation);
  const reviewed = (expectedRevision = 1, prior = null) => ({ protocolVersion, action: 'commit-reviewed', expectedRevision,
    expectedInitialized: Boolean(prior), expectedHead: prior?.head || null, expectedBranch: prior?.branch || null,
    paths: ['main.ts'], message: 'Reviewed source', authorName: 'YNX Test', authorEmail: 'test@ynx.local' });
  return { root, log, hold, pid, store, service, call, commands, reviewed, payload };
}

test('queued reviewed commit rechecks identity when the prior repository operation releases its lock', async t => {
  const f = await fixture(t); let release, begun, secondChecks = 0;
  const started = new Promise(resolve => { begun = resolve; }), held = new Promise(resolve => { release = resolve; });
  const first = f.call(null, { assertCurrent: async () => { begun(); await held; } });
  await started;
  const second = f.call(f.reviewed(), { assertCurrent: async () => { secondChecks++; throw revoked(); } });
  const denied = assert.rejects(second, error => error.code === 'core_identity_changed');
  await pause(25); assert.equal(secondChecks, 0); assert.equal(f.service.status().activeRepositories, 1);
  release(); assert.equal((await first).initialized, false); await denied;
  assert.equal(secondChecks, 1); assert.deepEqual(await f.commands(), []);
  assert.equal(f.store.get('owner', 'project').revision, 1);
});

test('commit-reviewed verifies again after stage before starting the commit process', async t => {
  const f = await fixture(t), before = await f.call(f.reviewed());
  f.store.put('owner', 'project', { expectedRevision: 1, idempotencyKey: 'edited-workspace', payload: f.payload('new\n') });
  await writeFile(f.log, '');
  await assert.rejects(f.call(f.reviewed(2, before), { assertCurrent: async () => {
    if ((await f.commands()).includes('add')) throw revoked();
  } }), error => error.code === 'core_identity_changed');
  const commands = await f.commands(); assert.ok(commands.includes('add')); assert.equal(commands.includes('commit'), false);
  const latest = await f.call(null); assert.equal(latest.head, before.head); assert.equal(latest.commits.length, 1);
  assert.equal(f.store.get('owner', 'project').revision, 2);
});

test('cancelled parallel status waits for child close before the next queued operation can start', async t => {
  const f = await fixture(t); await f.call(f.reviewed());
  await writeFile(f.hold, 'hold');
  const controller = new AbortController(); let firstSettled = false, nextStarted = false;
  const first = f.call(null, { signal: controller.signal });
  void first.then(() => { firstSettled = true; }, () => { firstSettled = true; });
  const rejected = assert.rejects(first, error => error.code === 'core_identity_changed');
  await until(async () => { try { return Number(await readFile(f.pid, 'utf8')) > 0; } catch { return false; } });
  const heldPid = Number(await readFile(f.pid, 'utf8'));
  const next = f.call(null, { assertCurrent: async () => { nextStarted = true; } });
  controller.abort(revoked());
  await pause(50);
  assert.equal(firstSettled, false); assert.equal(nextStarted, false); assert.equal(f.service.status().activeRepositories, 1);
  await rejected; assert.equal((await next).initialized, true);
  assert.throws(() => process.kill(heldPid, 0), error => error.code === 'ESRCH');
  assert.equal(f.service.status().activeRepositories, 0);
});

test('revocation after checkout prevents the new snapshot from being saved and reports possible repository changes', async t => {
  const f = await fixture(t), initial = await f.call(f.reviewed());
  await f.call({ protocolVersion, action: 'create-branch', branch: 'feature' });
  f.store.put('owner', 'project', { expectedRevision: 1, idempotencyKey: 'new-main', payload: f.payload('new\n') });
  await f.call(f.reviewed(2, initial));
  await writeFile(f.log, '');
  let failure;
  await assert.rejects(f.call({ protocolVersion, action: 'checkout', branch: 'feature', expectedRevision: 2, idempotencyKey: 'reviewed-checkout' }, {
    assertCurrent: async () => { if ((await f.commands()).includes('checkout')) throw revoked(); },
  }), error => { failure = error; return error.code === 'core_identity_changed'; });
  assert.equal(f.store.get('owner', 'project').revision, 2);
  assert.equal(f.store.get('owner', 'project').files['main.ts'], 'new\n');
  assert.equal(failure.details.workspacePersisted, false); assert.equal(failure.details.recheckRequired, true);
  assert.equal((await f.commands()).filter(value => value === 'checkout').length, 1, 'no revoked rollback command is launched');
});

test('successful commit before revocation remains in the repository and returns its actual receipt', async t => {
  const f = await fixture(t); let failure;
  await assert.rejects(f.call(f.reviewed(), { assertCurrent: async () => {
    if ((await f.commands()).includes('commit')) throw revoked();
  } }), error => { failure = error; return error.code === 'core_identity_changed'; });
  assert.equal(failure.details.completedOperation, 'commit-reviewed');
  assert.match(failure.details.commitOutput, /Reviewed source/); assert.equal(failure.details.recheckRequired, true);
  const state = await f.call(null); assert.equal(state.commits.length, 1); assert.equal(state.commits[0].subject.trim(), 'Reviewed source');
  assert.equal(f.store.get('owner', 'project').revision, 1);
});
