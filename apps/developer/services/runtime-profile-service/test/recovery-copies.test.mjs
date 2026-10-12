import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createRecoveryService } from '../src/recovery-service.mjs';
import { createTerminalRecoveryJournal } from '../src/terminal-recovery.mjs';
import { RECOVERY_SNAPSHOT_PYTHON } from '../src/recovery-snapshot.mjs';
import { createRuntimeProfileService, createLxdAdapter, createSshAdapter } from '../src/service.mjs';

const id = 'a'.repeat(24), otherId = 'b'.repeat(24);
const protocolVersion = 'ynx-code-recovery/v1';
const snapshot = { files: { 'main.js': 'unsaved remote work' }, folders: [], omitted: {} };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url: path, headers: { host: 'fixture' } });
}
async function call(service, req, owner = 'alice') {
  let status, headers, raw;
  const response = { writeHead(s, h) { status = s; headers = h; }, end(body) { raw = body; } };
  await service.handler(req, response, new URL(req.url, 'http://fixture'), owner);
  return { status, headers, raw, body: raw && JSON.parse(raw) };
}
const collect = token => ({ protocolVersion, approval: 'collect-recovery-copy-once', recoveryId: token });
async function fixture(t, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'ynx-recovery-copy-'));
  let db, journal, service;
  function open() {
    db = new DatabaseSync(join(folder, 'recovery.sqlite')); journal = createTerminalRecoveryJournal(db);
    service = createRecoveryService({ db, journal, readSnapshot: async () => snapshot, ...options });
  }
  open(); t.after(async () => { db.close(); await rm(folder, { recursive: true, force: true }); });
  return { get service() { return service; }, get journal() { return journal; }, reopen() { db.close(); open(); } };
}

test('recovery copy survives restart, preserves protection and never crosses owners', async t => {
  const f = await fixture(t); f.journal.begin('alice', id, 'project');
  const token = f.journal.get('alice', id).token;
  const result = await call(f.service, request(`/runtime/profiles/recovery/${id}/copies`, collect(token)));
  assert.equal(result.status, 201); assert.equal(result.body.protectionRetained, true);
  assert.equal(result.body.copy.consistency, 'unverified-live-copy');
  f.reopen(); assert.equal(f.journal.count(), 1);
  const path = `/runtime/profiles/recovery/${id}/copies/${result.body.copy.copyId}`;
  const download = await call(f.service, request(path));
  assert.equal(download.status, 200); assert.deepEqual(download.body.files, snapshot.files);
  assert.equal(createHash('sha256').update(download.raw).digest('hex'), result.body.copy.sha256);
  assert.equal(download.headers['cache-control'], 'no-store');
  assert.equal((await call(f.service, request(path), 'bob')).status, 404);
  assert.deepEqual((await call(f.service, request('/runtime/profiles/recovery'), 'bob')).body.entries, []);
  assert.throws(() => f.journal.assertAvailable('alice', id), { code: 'terminal_recovery_required' });
});

test('a later SSH project separates earlier copies and keeps capacity across all sessions', async t => {
  const f = await fixture(t), runtimeId = `ssh-${id}`;
  const ack = f.journal.begin('alice', runtimeId, 'project-A', { workspaceId: 'a'.repeat(48) });
  const originalToken = f.journal.get('alice', runtimeId).token;
  const path = `/runtime/profiles/recovery/${runtimeId}/copies`;
  for (let i = 0; i < 3; i++) assert.equal((await call(f.service, request(path, collect(originalToken)))).status, 201);
  ack(); f.journal.begin('alice', runtimeId, 'project-B', { workspaceId: 'b'.repeat(48) });
  const token = f.journal.get('alice', runtimeId).token;
  const detail = (await call(f.service, request(`/runtime/profiles/recovery/${runtimeId}`))).body;
  assert.equal(detail.projectId, 'project-B'); assert.deepEqual(detail.copies, []); assert.equal(detail.previousCopies.length, 3);
  assert.ok(detail.previousCopies.every(copy => copy.projectId === 'project-A' && copy.recoveryId === originalToken));
  const old = await call(f.service, request(`${path}/${detail.previousCopies[0].copyId}`));
  assert.equal(old.body.projectId, 'project-A'); assert.equal(old.body.recoveryId, originalToken);
  assert.equal((await call(f.service, request(path, collect(token)))).status, 201);
  assert.equal((await call(f.service, request(path, collect(token)))).status, 429);
  f.reopen(); const current = (await call(f.service, request('/runtime/profiles/recovery'))).body.entries[0];
  assert.equal(current.copies.length, 1); assert.equal(current.copies[0].recoveryId, token); assert.equal(current.previousCopies.length, 3);
});

test('legacy copy migration preserves payload bytes and adds original project identity', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE recovery_copies(owner_id TEXT NOT NULL,runtime_id TEXT NOT NULL,recovery_id TEXT NOT NULL,copy_id TEXT NOT NULL,created_at TEXT NOT NULL,sha256 TEXT NOT NULL,file_count INTEGER NOT NULL,bytes INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner_id,copy_id))');
    const payload = JSON.stringify({ projectId: 'original-project', files: { 'main.js': 'retained' } });
    db.prepare('INSERT INTO recovery_copies VALUES(?,?,?,?,?,?,?,?,?)').run('alice', id, 'old-session', 'copy', '2026-09-07T00:00:00Z', createHash('sha256').update(payload).digest('hex'), 1, 8, payload);
    const journal = createTerminalRecoveryJournal(db);
    createRecoveryService({ db, journal, readSnapshot: async () => snapshot });
    const row = db.prepare('SELECT * FROM recovery_copies').get();
    assert.equal(row.project_id, 'original-project'); assert.equal(row.payload, payload); assert.equal(row.recovery_id, 'old-session');
    assert.equal(row.sha256, createHash('sha256').update(row.payload).digest('hex'));
  } finally { db.close(); }
});

test('one runtime collection cannot race another copy, while a different owner can progress', async t => {
  const entered = deferred(), resume = deferred();
  const f = await fixture(t, { readSnapshot: async owner => { if (owner === 'alice') { entered.resolve(); await resume.promise; } return snapshot; } });
  for (const owner of ['alice', 'bob']) f.journal.begin(owner, id, 'project');
  const path = `/runtime/profiles/recovery/${id}/copies`, input = collect(f.journal.get('alice', id).token);
  const pending = call(f.service, request(path, input)); await entered.promise;
  assert.equal((await call(f.service, request(path, input))).status, 409);
  assert.equal((await call(f.service, request(path, collect(f.journal.get('bob', id).token)), 'bob')).status, 201);
  resume.resolve(); assert.equal((await pending).status, 201); assert.equal(f.journal.count(), 2);
});

test('recovery rechecks the session after request-body wait and after snapshot collection', async t => {
  let reads = 0; const entered = deferred(), resume = deferred();
  const f = await fixture(t, { readSnapshot: async () => { reads++; entered.resolve(); await resume.promise; return snapshot; } });
  let ack = f.journal.begin('alice', id, 'project'), token = f.journal.get('alice', id).token;
  const bodyGate = deferred();
  const req = request(`/runtime/profiles/recovery/${id}/copies`, collect(token));
  req[Symbol.asyncIterator] = async function* () { await bodyGate.promise; yield Buffer.from(JSON.stringify(collect(token))); };
  const staleBody = call(f.service, req); await Promise.resolve(); ack(); ack = f.journal.begin('alice', id, 'project'); bodyGate.resolve();
  assert.equal((await staleBody).status, 409); assert.equal(reads, 0);
  token = f.journal.get('alice', id).token;
  const staleRead = call(f.service, request(`/runtime/profiles/recovery/${id}/copies`, collect(token)));
  await entered.promise; ack(); f.journal.begin('alice', id, 'project'); resume.resolve();
  assert.equal((await staleRead).status, 409);
  assert.equal((await call(f.service, request(`/runtime/profiles/recovery/${id}`))).body.copies.length, 0);
});

test('active or interrupted collection never commits and bounded capacity retains existing copies', async t => {
  let active = true;
  const f = await fixture(t, { isActive: () => active }); f.journal.begin('alice', id, 'project');
  const path = `/runtime/profiles/recovery/${id}/copies`, input = collect(f.journal.get('alice', id).token);
  assert.equal((await call(f.service, request(path, input))).body.code, 'runtime_active'); active = false;
  const req = request(path, input); req.maintenanceSignal = AbortSignal.abort();
  assert.equal((await call(f.service, req)).body.code, 'recovery_interrupted');
  for (let i = 0; i < 4; i++) assert.equal((await call(f.service, request(path, input))).status, 201);
  assert.equal((await call(f.service, request(path, input))).body.code, 'recovery_capacity');
  assert.equal((await call(f.service, request(`/runtime/profiles/recovery/${id}`))).body.copies.length, 4);
  assert.equal(f.journal.count(), 1);
});

test('actual runtime handler exposes retained files after an uncertain command but keeps writes blocked', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ynx-recovery-handler-'));
  let reads = 0;
  const service = createRuntimeProfileService({ filename: join(folder, 'profiles.sqlite'), ownerForRequest: () => 'alice', lxd: {
    inventory: async () => ({ ready: true }), create: async () => ({}),
    runTask: async () => { throw Object.assign(new Error('synthetic child timeout'), { code: 'child_exit_timeout' }); },
    readRecoverySnapshot: async value => { reads++; assert.equal(value.projectId, 'project'); return snapshot; },
  } });
  t.after(async () => { service.close(); await rm(folder, { recursive: true, force: true }); });
  const create = await call(service, request('/runtime/profiles/lxd/leases', { protocolVersion: 'ynx-code-runtime/v1', approval: 'create-container-once', projectId: 'project', image: 'ubuntu-24.04' }));
  const runtimeId = create.body.runtime.runtimeId;
  await call(service, request(`/runtime/profiles/lxd/leases/${runtimeId}/tasks`, { protocolVersion: 'ynx-code-runtime/v1', approval: 'execute-container-once', projectId: 'project', activePath: 'main.js', files: snapshot.files }));
  const rows = (await call(service, request('/runtime/profiles/recovery'))).body.entries;
  assert.equal(rows.length, 1);
  assert.equal((await call(service, request(`/runtime/profiles/recovery/${runtimeId}/copies`, collect(rows[0].recoveryId)))).status, 201);
  assert.equal(reads, 1); assert.equal(service.recoveryCount(), 1);
  assert.equal((await call(service, request(`/runtime/profiles/lxd/leases/${runtimeId}`, undefined, 'DELETE'))).status, 409);
});

test('SSH recovery pins the numeric target and exact preserved session; legacy or private targets never execute', async () => {
  const calls = [], workspaceId = 'c'.repeat(48), value = { profile: { host: 'host.fixture', port: 22, user: 'alice', hostKey: 'host.fixture ssh-ed25519 Zml4dHVyZQ==' }, privateKey: 'synthetic-key', workspaceId };
  const adapter = createSshAdapter({ resolve: async () => [{ address: '8.8.8.8' }], run: async (command, args) => { calls.push({ command, args }); return { stdout: JSON.stringify(snapshot) }; } });
  await adapter.readRecoverySnapshot(value); assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('8.8.8.8')); assert.ok(!calls[0].args.includes('alice@host.fixture'));
  assert.ok(calls[0].args.at(-1).includes(`.ynx-code/sessions/${workspaceId}`));
  await assert.rejects(() => adapter.readRecoverySnapshot({ ...value, workspaceId: null }));
  const privateAdapter = createSshAdapter({ resolve: async () => [{ address: '::ffff:127.0.0.1' }], run: async () => { throw new Error('must not execute'); } });
  await assert.rejects(() => privateAdapter.readRecoverySnapshot(value), { code: 'ssh_target_not_public' });
  assert.equal(calls.length, 1);
});

test('LXD recovery uses only the fixed read program and does not clear the command guard', async () => {
  const calls = [], containerName = `ynx-${'d'.repeat(10)}-${id}`;
  const adapter = createLxdAdapter({ run: async (command, args) => { calls.push({ command, args }); return { stdout: JSON.stringify(snapshot) }; } });
  await adapter.readRecoverySnapshot({ containerName, projectId: 'project' });
  assert.deepEqual(calls[0].args.slice(0, 5), ['exec', containerName, '--', 'python3', '-c']);
  assert.equal(calls[0].args[5], RECOVERY_SNAPSHOT_PYTHON); assert.equal(calls[0].args[6], '/workspaces/project');
  await assert.rejects(() => adapter.readRecoverySnapshot({ containerName, projectId: '../outside' })); assert.equal(calls.length, 1);
});

test('real descriptor-based snapshot preserves text, omits links/binary and rejects linked ancestors', async t => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'ynx-recovery-python-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const root = join(folder, 'sessions', id); await mkdir(root, { recursive: true });
  await writeFile(join(root, 'main.js'), 'remote work'); await writeFile(join(root, 'image.bin'), Buffer.from([0, 255]));
  await writeFile(join(folder, 'outside'), 'must not appear'); await symlink(join(folder, 'outside'), join(root, 'link'));
  const run = promisify(execFile), python = process.platform === 'darwin' ? '/usr/bin/python3' : 'python3';
  const result = JSON.parse((await run(python, ['-c', RECOVERY_SNAPSHOT_PYTHON, root])).stdout);
  assert.deepEqual(result.files, { 'main.js': 'remote work' }); assert.equal(result.omitted.links, 1); assert.equal(result.omitted.binary, 1);
  await symlink(join(folder, 'sessions'), join(folder, 'alias'));
  await assert.rejects(() => run(python, ['-c', RECOVERY_SNAPSHOT_PYTHON, join(folder, 'alias', id)]), error => error.code === 3 && !error.stdout.includes('remote work'));
  await writeFile(join(root, 'large.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  await assert.rejects(() => run(python, ['-c', RECOVERY_SNAPSHOT_PYTHON, root]), error => error.code === 3 && error.stdout === '');
});

test('snapshot stops enumerating at the 513th directory entry', async t => {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'ynx-recovery-entry-cap-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const instrument = `\noriginal_scandir=os.scandir\nconsumed=0\nclass BoundedEntries:\n def __init__(self,fd): self.inner=original_scandir(fd)\n def __enter__(self): return self\n def __exit__(self,*args): self.inner.close()\n def __iter__(self): return self\n def __next__(self):\n  global consumed\n  consumed+=1\n  if consumed>513: raise AssertionError('enumerated beyond limit')\n  class Entry: pass\n  e=Entry();e.name='item-'+str(consumed);return e\nos.scandir=BoundedEntries\n`;
  const source = RECOVERY_SNAPSHOT_PYTHON.replace('MAX_BYTES=', instrument + '\nimport atexit\natexit.register(lambda: sys.stderr.write("entries-consumed="+str(consumed)+"\\n"))\nMAX_BYTES=');
  const run = promisify(execFile), python = process.platform === 'darwin' ? '/usr/bin/python3' : 'python3';
  await assert.rejects(() => run(python, ['-c', source, folder]), error => error.code === 3 && error.stdout === '' && error.stderr.includes('entries-consumed=513\n'));
});
