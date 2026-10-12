import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeProfileService } from '../src/service.mjs';
import { createRemoteCommandBoundary } from '../src/remote-command-boundary.mjs';

const protocolVersion = 'ynx-code-runtime/v1';
const snapshot = { folders: [], files: { 'main.js': 'console.log(1)' } };
const task = { protocolVersion, approval: 'execute-container-once', projectId: 'project', activePath: 'main.js', files: snapshot.files };
const pkg = { protocolVersion, approval: 'install-package-once', ecosystem: 'python', projectId: 'project', packageSpec: 'colorama==0.4.6', workspaceBytes: 24, workspaceFileCount: 1, previousRequirementsBytes: 0, hasRequirementsLock: false };
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function request(path, body, method = 'POST') {
  return Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { url: path, method, headers: { host: 'local-fixture' } });
}
async function call(service, req) {
  let status, body;
  await service.handler(req, { writeHead(n) { status = n; }, end(raw) { body = JSON.parse(raw); } });
  return { status, body };
}
async function fixture(t, overrides = {}, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ynx-operation-lifecycle-'));
  const events = [];
  const lxd = {
    inventory: async () => ({ ready: true }), create: async () => ({}),
    prepareTerminal: async () => { events.push('prepare'); }, terminalLaunch: () => ({}),
    runTask: async () => { events.push('task'); return { ok: true }; },
    installPackage: async () => { events.push('package'); return { ok: true }; },
    remove: async () => { events.push('remove'); }, ...overrides,
  };
  const config = { filename: join(root, 'profiles.sqlite'), ownerForRequest: () => 'owner', lxd, ...options };
  let service = createRuntimeProfileService(config);
  t.after(async () => { service.close(); await rm(root, { recursive: true, force: true }); });
  const create = projectId => call(service, request('/runtime/profiles/lxd/leases', { protocolVersion, approval: 'create-container-once', projectId, image: 'ubuntu-24.04' }));
  return { get service() { return service; }, events, create, restart() { service.close(); service = createRuntimeProfileService(config); } };
}
const context = runtimeId => ({ owner: 'owner', runtimeId, projectId: 'project', snapshot });

for (const [route, body] of [['tasks', task], ['packages', pkg]]) {
  test(`${route} rechecks admission after the body is read and cannot release another terminal`, async t => {
    const f = await fixture(t), created = await f.create('project'), id = created.body.runtime.runtimeId;
    const entered = gate(), finishBody = gate();
    const delayed = Object.assign(Readable.from((async function* () { entered.resolve(); await finishBody.promise; yield Buffer.from(JSON.stringify(body)); })()), { url: `/runtime/profiles/lxd/leases/${id}/${route}`, method: 'POST', headers: { host: 'local-fixture' } });
    const pending = call(f.service, delayed); await entered.promise;
    const terminal = await f.service.openContainerTerminal(context(id));
    finishBody.resolve(); const rejected = await pending;
    assert.ok([409, 429].includes(rejected.status));
    assert.deepEqual(f.events, ['prepare']);
    assert.equal((await call(f.service, request(`/runtime/profiles/lxd/leases/${id}`, undefined, 'DELETE'))).status, 409);
    terminal.acknowledgeSnapshot(); await terminal.release();
    assert.equal((await call(f.service, request(`/runtime/profiles/lxd/leases/${id}/${route}`, body))).status, 200);
  });
}

test('environment lookup cannot reserve stale runtime admission', async t => {
  const entered = gate(), resume = gate();
  const f = await fixture(t, {}, { environmentResolver: async () => { entered.resolve(); await resume.promise; return { environment: {}, revision: 1 }; } });
  const id = (await f.create('project')).body.runtime.runtimeId;
  const pending = call(f.service, request(`/runtime/profiles/lxd/leases/${id}/tasks`, task));
  await entered.promise; const terminal = await f.service.openContainerTerminal(context(id));
  resume.resolve(); assert.ok([409, 429].includes((await pending).status));
  assert.deepEqual(f.events, ['prepare']); terminal.acknowledgeSnapshot(); await terminal.release();
});

test('an old terminal release cannot unlock a newer terminal', async t => {
  const f = await fixture(t), id = (await f.create('project')).body.runtime.runtimeId;
  const first = await f.service.openContainerTerminal(context(id)); first.acknowledgeSnapshot(); await first.release();
  const second = await f.service.openContainerTerminal(context(id)); await first.release(); first.acknowledgeSnapshot();
  assert.equal((await call(f.service, request(`/runtime/profiles/lxd/leases/${id}`, undefined, 'DELETE'))).status, 409);
  second.acknowledgeSnapshot(); await second.release();
});

for (const code of ['child_exit_timeout', 'timeout', 'max_buffer']) {
  test(`${code} keeps the affected runtime protected across restart while another runtime works`, async t => {
    let attempts = 0;
    const f = await fixture(t, { runTask: async value => { attempts++; if (value.task.projectId === 'project') throw Object.assign(new Error('synthetic incomplete command'), { code }); return { ok: true }; } });
    const id = (await f.create('project')).body.runtime.runtimeId;
    assert.notEqual((await call(f.service, request(`/runtime/profiles/lxd/leases/${id}/tasks`, task))).status, 200);
    assert.equal(f.service.recoveryCount(), 1); f.restart();
    assert.equal((await call(f.service, request(`/runtime/profiles/lxd/leases/${id}/tasks`, task))).status, 409);
    assert.equal((await call(f.service, request(`/runtime/profiles/lxd/leases/${id}`, undefined, 'DELETE'))).status, 409);
    await assert.rejects(() => f.service.openContainerTerminal(context(id)), { code: 'terminal_recovery_required' });
    const other = (await f.create('other-project')).body.runtime.runtimeId;
    assert.equal((await call(f.service, request(`/runtime/profiles/lxd/leases/${other}/tasks`, { ...task, projectId: 'other-project' }))).status, 200);
    assert.equal(attempts, 2); assert.equal(f.service.recoveryCount(), 1);
  });
}

test('failed creation with unverified completion retains its lease for recovery', async t => {
  const f = await fixture(t, { create: async () => { throw Object.assign(new Error('synthetic timeout'), { code: 'child_exit_timeout' }); } });
  assert.notEqual((await f.create('project')).status, 201);
  f.restart(); const inventory = await call(f.service, request('/runtime/profiles', undefined, 'GET'));
  assert.equal(inventory.body.leases.length, 1); assert.equal(inventory.body.leases[0].status, 'recovery_required');
  assert.equal(inventory.body.leases[0].recoveryRequired, true); assert.equal(f.service.recoveryCount(), 1);
  assert.deepEqual(f.events, []);
});

test('unverified workspace command blocks later collection as well as preparation', async () => {
  const seen = [], unsafe = [];
  const boundary = createRemoteCommandBoundary(async (_command, args) => { seen.push(args); if (args.includes('synthetic-timeout')) throw Object.assign(new Error('synthetic'), { code: 'child_exit_timeout' }); return {}; });
  boundary.setRecoveryHandler(container => unsafe.push(container));
  await assert.rejects(() => boundary.run('lxc', ['exec', 'runtime-one', '--', 'synthetic-timeout']));
  await assert.rejects(() => boundary.run('lxc', ['file', 'pull', 'runtime-one/workspaces/project/main.js', '/tmp/local-test']), { code: 'remote_command_recovery_required' });
  await assert.rejects(() => boundary.run('lxc', ['delete', 'runtime-one', '--force']), { code: 'remote_command_recovery_required' });
  await boundary.run('lxc', ['exec', 'runtime-two', '--', 'true']);
  assert.equal(seen.length, 2); assert.deepEqual(unsafe, ['runtime-one']);
});
