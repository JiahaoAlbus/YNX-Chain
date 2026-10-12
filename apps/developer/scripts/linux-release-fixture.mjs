// Run only against an unpacked release and fresh, synthetic, loopback state.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, cp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';

const [candidateArgument, manifestArgument, stateArgument] = process.argv.slice(2);
assert.ok(candidateArgument && manifestArgument && stateArgument, 'candidate, manifest and fresh state directory are required');
const candidate = resolve(candidateArgument), state = resolve(stateArgument), app = join(candidate, 'apps/developer');
const manifest = JSON.parse(await readFile(manifestArgument, 'utf8'));
await mkdir(state, { mode: 0o700 }); // Existing directories are deliberately refused.
const key = randomBytes(32).toString('hex');
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`, runtimeId = 'ssh-' + 'a'.repeat(24);
let child, exited, logs = '', cookie, owner;
async function start(directory) {
  child = spawn(process.execPath, ['services/gateway/src/server.mjs'], { cwd: app, env: {
    PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
    YNX_CODE_STATE_DIR: directory, YNX_CODE_WORKSPACE_SESSION_KEY: key,
    YNX_CODE_RELEASE: manifest.release, YNX_CODE_SOURCE_COMMIT: manifest.sourceCommit,
    YNX_CODE_SOURCE_TREE: manifest.sourceTree, NODE_OPTIONS: '--max-old-space-size=512',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
  exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { const h = await (await fetch(base + '/healthz')).json(); if (h.ready) return h; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Gateway startup timeout: ' + logs);
}
async function stop(directory, protectedRecovery = false) {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 65000);
  try { assert.deepEqual(await exited, { code: protectedRecovery ? 1 : 0, signal: null }, logs); } finally { clearTimeout(timer); }
  const receipt = JSON.parse(await readFile(join(directory, 'maintenance.json'), 'utf8'));
  assert.equal(receipt.cleanShutdown, !protectedRecovery);
  if (protectedRecovery) {
    assert.equal(receipt.reason, 'runtime_recovery_required');
    assert.equal(receipt.forcedCancellation, false);
    assert.equal(receipt.activity.requests.total, 0);
    assert.equal(receipt.activity.operations.total, 0);
    assert.equal(receipt.activity.services.remoteRecovery.recoveryRequired, 1);
  }
}
const headers = () => ({ cookie, 'content-type': 'application/json' });
try {
  const health = await start(state);
  assert.equal(health.sourceCommit, manifest.sourceCommit); assert.equal(health.sourceTree, manifest.sourceTree);
  assert.equal(health.version, manifest.release);
  for (const file of manifest.staticFiles) {
    const response = await fetch(base + (file.url === '/index.html' ? '/' : file.url));
    assert.equal(response.status, 200, file.url);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, file.bytes, file.url);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.url);
  }
  cookie = (await fetch(base + '/runtime/health')).headers.get('set-cookie').split(';')[0];
  const session = cookie.slice(cookie.indexOf('=') + 1).split('.')[0];
  owner = createHmac('sha256', key).update(`workspace-owner:${session}`).digest('hex');
  const save = await fetch(base + '/runtime/workspaces/release-fixture', { method: 'PUT', headers: headers(), body: JSON.stringify({
    protocolVersion: 'ynx-code/v1', expectedRevision: 0, idempotencyKey: 'release-fixture-save-0001',
    workspace: { name: 'Retained release proof', folders: [], files: { 'main.js': 'saved source survives a release cold load' }, open: ['main.js'], active: 'main.js' },
  }) });
  assert.equal(save.status, 200, await save.text());
  await stop(state);
  const { createTerminalRecoveryJournal } = await import(pathToFileURL(join(app, 'services/runtime-profile-service/src/terminal-recovery.mjs')));
  const { createRecoveryService } = await import(pathToFileURL(join(app, 'services/runtime-profile-service/src/recovery-service.mjs')));
  const db = new DatabaseSync(join(state, 'runtime-profiles.sqlite'));
  const journal = createTerminalRecoveryJournal(db);
  journal.begin(owner, runtimeId, 'release-fixture', { workspaceId: 'b'.repeat(48) });
  const token = journal.get(owner, runtimeId).token;
  const recovery = createRecoveryService({ db, journal, readSnapshot: async () => ({ files: { 'recovered.js': 'retained uncertain remote content' }, folders: [], omitted: {} }) });
  const path = `/runtime/profiles/recovery/${runtimeId}/copies`;
  const request = Object.assign(Readable.from([JSON.stringify({ protocolVersion: 'ynx-code-recovery/v1', approval: 'collect-recovery-copy-once', recoveryId: token })]), { method: 'POST', url: path, headers: {} });
  let copied;
  await recovery.handler(request, { writeHead(status) { assert.equal(status, 201); }, end(raw) { copied = JSON.parse(raw); } }, new URL(path, base), owner);
  assert.equal(copied.protectionRetained, true);
  const before = JSON.stringify(db.prepare('SELECT * FROM terminal_recovery').all());
  const copyBefore = JSON.stringify(db.prepare('SELECT * FROM recovery_copies').all());
  db.close();
  const coldState = state + '-cold-copy';
  await cp(state, coldState, { recursive: true, errorOnExist: true, force: false });
  await start(coldState);
  const list = await (await fetch(base + '/runtime/profiles/recovery', { headers: headers() })).json();
  assert.equal(list.entries.length, 1); assert.equal(list.entries[0].recoveryId, token);
  const download = await fetch(base + path + '/' + copied.copy.copyId, { headers: headers() });
  assert.equal(download.status, 200);
  assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'), copied.copy.sha256);
  const saved = await fetch(base + '/runtime/workspaces/release-fixture', { headers: headers() });
  assert.equal(saved.status, 200); assert.match(await saved.text(), /saved source survives a release cold load/);
  const otherCookie = (await fetch(base + '/runtime/health')).headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + path + '/' + copied.copy.copyId, { headers: { cookie: otherCookie } })).status, 404);
  await stop(coldState, true);
  const coldDb = new DatabaseSync(join(coldState, 'runtime-profiles.sqlite'));
  assert.equal(JSON.stringify(coldDb.prepare('SELECT * FROM terminal_recovery').all()), before);
  assert.equal(JSON.stringify(coldDb.prepare('SELECT * FROM recovery_copies').all()), copyBefore);
  const coldJournal = createTerminalRecoveryJournal(coldDb);
  assert.throws(() => coldJournal.assertAvailable(owner, runtimeId), { code: 'terminal_recovery_required' }); coldDb.close();
  console.log(JSON.stringify({ sourceCommit: manifest.sourceCommit, staticFilesVerified: manifest.staticFiles.length,
    realGatewayColdStart: true, persistentWorkspaceReadback: true, recoveryCopyBytesPreserved: true,
    ownerIsolation: true, protectionRetained: true, cleanShutdowns: 1, recoveryRequiredExitCode: 1,
    syntheticStateOnly: true, externalSSHOrLXDProven: false, publicDeployment: false }));
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 65000);
    try { await exited; } finally { clearTimeout(timer); }
  }
}
