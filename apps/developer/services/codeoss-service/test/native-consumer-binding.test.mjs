import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as rawRequest } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createWorkspaceStore } from '../../workspace-manager/src/store.mjs';
import { createDeveloperSSO } from '../src/developer-sso.mjs';
import { createCodeOSSService } from '../src/service.mjs';
import { CENTRAL_IDENTITY } from '../src/central-identity.mjs';

const PARENT = 'https://developer.ynxweb4.com';
const snapshot = { name: 'Private project', files: { 'main.js': 'console.log(42)' }, folders: [], open: ['main.js'], active: 'main.js' };
const launchBody = { projectId: 'project', expectedRevision: 1, approval: 'launch-native-ide-once' };
async function fixture(t, { beforeLaunchURL, afterDriverStart } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ynx-native-consumer-')), store = createWorkspaceStore({ filename: join(root, 'workspace.sqlite') });
  const guest = 'f'.repeat(64), revoked = new Set(), starts = [];
  store.put(guest, 'guest-copy', { expectedRevision: 0, idempotencyKey: 'guest-copy-source', payload: snapshot });
  let verifications = 0, core;
  const actors = Object.fromEntries(['a', 'b'].map(name => [name, { subject: `nativeynx:${name}`, account: `ynx-${name}`, generation: 1, expiresAt: new Date(Date.now() + 3600000).toISOString() }]));
  const grants = Object.fromEntries(['a', 'b'].map(name => [name, `private-${name}-grant-for-controlled-authority-only`.repeat(2)]));
  const sso = await createDeveloperSSO({ filename: join(root, 'identity.sqlite'), keyPath: join(root, 'identity.key'), workspaceStore: store,
    guestOwnerForRequest: () => guest, onSignOut: (owner, reference) => core.drainOwner(owner, reference),
    fetchImpl: async (url, options) => {
      const input = JSON.parse(options.body), actor = url.endsWith('/token') ? input.code : Object.keys(grants).find(key => grants[key] === input.grantToken);
      if (url.endsWith('/logout-grant')) { revoked.add(actor); return { ok: true, status: 200, json: async () => ({ revoked: true }) }; }
      if (url.endsWith('/introspect')) verifications++;
      return { ok: !revoked.has(actor), status: revoked.has(actor) ? 401 : 200, json: async () => ({ identity: actors[actor], grantToken: grants[actor], expiresAt: actors[actor]?.expiresAt, audience: CENTRAL_IDENTITY.audience, scopes: ['identity:read'] }) };
    } });
  core = createCodeOSSService({ filename: join(root, 'legacy.sqlite'), root: join(root, 'native'), workspaceStore: store,
    verifyIdentity: sso.verifyIdentity, assertProjectQuiescent() {}, launchURL: async ({ sessionId }) => {
      await beforeLaunchURL?.(); return `https://${sessionId}.native.example/`;
    }, driver: { start: async context => { starts.push(context); await afterDriverStart?.(); }, stop: async context => ({ stopped: true, runtimeId: context.runtimeId, identityDigest: context.identityDigest }) } });
  const server = createServer(async (req, res) => { if (await sso.handler(req, res) || await core.handler(req, res)) return; res.writeHead(404).end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await core.drain(); await new Promise(resolve => server.close(resolve)); core.close(); sso.close(); store.close(); });
  const call = (path, { cookie, method = 'GET', body, identityKey } = {}) => new Promise((resolve, reject) => {
    const req = rawRequest({ hostname: '127.0.0.1', port: server.address().port, path, method,
      headers: { host: 'developer.ynxweb4.com', ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { origin: PARENT } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}), ...(identityKey ? { 'x-ynx-agent-identity': identityKey } : {}) } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => { let value; try { value = JSON.parse(text); } catch {} resolve({ status: res.statusCode, value, headers: res.headers }); });
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  const login = async actor => {
    const start = await call('/sso/start'), state = new URL(start.headers.location).searchParams.get('state');
    const result = await call(`/sso/callback?state=${state}&code=${actor}`, { cookie: start.headers['set-cookie'][0].split(';')[0] });
    assert.equal(result.status, 303);
    const cookie = result.headers['set-cookie'][0].split(';')[0];
    const identity = await sso.verifyIdentity({ headers: { host: 'developer.ynxweb4.com', cookie } });
    store.put(identity.workspaceOwner, 'project', { expectedRevision: 0, idempotencyKey: `seed-owned-${actor}`, payload: { ...snapshot, name: `Project ${actor}` } });
    const catalog = (await call('/runtime/codeoss?projectId=project', { cookie })).value;
    return { cookie, identity, catalog, identityKey: catalog.identityKey };
  };
  return { call, login, store, sso, starts, core, guest, port: server.address().port, verifications: () => verifications, revokeRemote: actor => revoked.add(actor) };
}

test('native catalog binds its displayed account and rejects the old view after cookie switch before launch or Stop', async t => {
  const f = await fixture(t), a = await f.login('a'), b = await f.login('b');
  assert.equal(a.catalog.account, 'ynx-a'); assert.equal(a.catalog.generation, 1); assert.match(a.identityKey, /^[a-f0-9]{64}$/);
  assert.notEqual(a.identityKey, b.identityKey);
  const stale = await f.call('/runtime/codeoss', { cookie: b.cookie, identityKey: a.identityKey, method: 'POST', body: launchBody });
  assert.equal(stale.status, 401); assert.equal(stale.value.code, 'core_consumer_identity_changed');
  assert.equal(f.starts.length, 0); assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 0);
  const launched = await f.call('/runtime/codeoss', { ...b, method: 'POST', body: launchBody }); assert.equal(launched.status, 201);
  const id = launched.value.session.sessionId;
  assert.equal((await f.call(`/runtime/codeoss/${id}`, { cookie: b.cookie, identityKey: a.identityKey, method: 'DELETE' })).status, 401);
  assert.equal((await f.call(`/runtime/codeoss/${id}`, { ...b, method: 'DELETE' })).status, 200);
});

test('guest copy approval cannot change recipients when the current cookie changes before POST', async t => {
  const f = await fixture(t), a = await f.login('a'), b = await f.login('b');
  const body = { projectId: 'guest-copy', expectedGuestRevision: 1, approval: 'copy-guest-project-once', approvalId: randomUUID() };
  const stale = await f.call('/runtime/identity/import', { cookie: b.cookie, identityKey: a.identityKey, method: 'POST', body });
  assert.equal(stale.status, 401); assert.equal(stale.value.code, 'core_consumer_identity_changed');
  assert.equal(f.store.get(b.identity.workspaceOwner, 'guest-copy'), null);
  assert.equal((await f.call('/runtime/identity/import', { ...b, method: 'POST', body })).status, 201);
  assert.deepEqual(f.store.get(b.identity.workspaceOwner, 'guest-copy').files, snapshot.files);
  assert.equal(f.store.get(a.identity.workspaceOwner, 'guest-copy'), null);
});

for (const kind of ['launch', 'copy']) test(`logout during the ${kind} HTTP body prevents late journal, driver or workspace writes`, async t => {
  const f = await fixture(t), a = await f.login('a'), before = f.verifications();
  const path = kind === 'launch' ? '/runtime/codeoss' : '/runtime/identity/import';
  const body = JSON.stringify(kind === 'launch' ? launchBody : { projectId: 'guest-copy', expectedGuestRevision: 1, approval: 'copy-guest-project-once', approvalId: randomUUID() });
  let request;
  const pending = new Promise((resolve, reject) => {
    request = rawRequest({ hostname: '127.0.0.1', port: f.port, path, method: 'POST', headers: {
      host: 'developer.ynxweb4.com', origin: PARENT, cookie: a.cookie, 'x-ynx-agent-identity': a.identityKey,
      'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
    } }, res => { let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, value: JSON.parse(text) })); });
    request.on('error', reject); request.write(body.slice(0, 20));
  });
  while (f.verifications() <= before) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.call('/runtime/identity/logout', { cookie: a.cookie, method: 'POST' })).status, 200);
  request.end(body.slice(20)); const result = await pending;
  assert.equal(result.status, 401); assert.equal(f.starts.length, 0);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 0);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM codeoss_sessions').get().n, 0);
  assert.equal(f.store.get(a.identity.workspaceOwner, 'guest-copy'), null);
  assert.deepEqual(f.store.get(f.guest, 'guest-copy').files, snapshot.files);
});

test('revocation during launch URL admission cannot create a writer or session after the awaited preflight', async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { beforeLaunchURL: async () => { entered(); await held; } }), a = await f.login('a');
  const pending = f.call('/runtime/codeoss', { ...a, method: 'POST', body: launchBody });
  await started; await f.call('/runtime/identity/logout', { cookie: a.cookie, method: 'POST' }); release();
  assert.equal((await pending).status, 401); assert.equal(f.starts.length, 0);
  assert.equal(f.store.nativeJournalDatabase().prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 0);
});

test('more than 100 stopped sessions cannot hide a live or recovery writer or expose another owner', async t => {
  const f = await fixture(t), a = await f.login('a'), b = await f.login('b');
  const launched = await f.call('/runtime/codeoss', { ...a, method: 'POST', body: launchBody }); assert.equal(launched.status, 201);
  const db = f.store.nativeJournalDatabase(), id = launched.value.session.sessionId;
  db.prepare("UPDATE codeoss_sessions SET created_at=1,status='recovery-required' WHERE id=?").run(id);
  const row = db.prepare('SELECT * FROM codeoss_sessions WHERE id=?').get(id), keys = Object.keys(row);
  const insert = db.prepare(`INSERT INTO codeoss_sessions(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`);
  for (let index = 0; index < 105; index++) {
    const history = { ...row, id: randomUUID(), status: 'stopped', created_at: index + 2 };
    insert.run(...keys.map(key => history[key]));
  }
  const foreign = { ...row, id: randomUUID(), owner: b.identity.owner, workspace_owner: b.identity.workspaceOwner, created_at: 1000 };
  insert.run(...keys.map(key => foreign[key]));
  const result = await f.call('/runtime/codeoss?projectId=project', a);
  assert.equal(result.status, 200); assert.equal(result.value.sessions.length, 101);
  assert.equal(result.value.sessions[0].sessionId, id); assert.equal(result.value.sessions[0].status, 'recovery-required');
  assert.equal(result.value.sessions.some(session => session.sessionId === foreign.id), false);
  assert.equal(result.value.capacityVerified, false); assert.equal(result.value.capacityScope, 'single-durable-broker');
  assert.equal((await f.call(`/runtime/codeoss/${id}`, { ...a, method: 'DELETE' })).status, 200);
  // The synthetic foreign row has no runtime/files and is removed from the
  // fixture before shutdown; its presence was solely an isolation assertion.
  db.prepare('DELETE FROM codeoss_sessions WHERE id=?').run(foreign.id);
});

test('remote revocation after driver start settles into protected recovery without recursively waiting for its own launch', { timeout: 2000 }, async t => {
  let f;
  f = await fixture(t, { afterDriverStart: () => f.revokeRemote('a') });
  const a = await f.login('a');
  const result = await f.call('/runtime/codeoss', { ...a, method: 'POST', body: launchBody });
  assert.equal(result.status, 503); assert.equal(result.value.code, 'core_launch_recovery_required');
  const db = f.store.nativeJournalDatabase();
  assert.equal(db.prepare('SELECT status FROM codeoss_sessions').get().status, 'recovery-required');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 1);
  await f.core.drain();
  assert.equal(db.prepare('SELECT status FROM codeoss_sessions').get().status, 'stopped');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM workspace_writers').get().n, 0);
});
