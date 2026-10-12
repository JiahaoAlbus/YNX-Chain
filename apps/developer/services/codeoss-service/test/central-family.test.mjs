import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as requestHTTP } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createDeveloperSSO } from '../src/developer-sso.mjs';

// The explicit reviewed Central source is an immutable test input. This runs
// real Node HTTP routes/signature verification; it never accesses production.
const source = process.env.YNX_QA_CENTRAL_SOURCE;
if (!source) throw Error('YNX_QA_CENTRAL_SOURCE must name the reviewed Central checkout/archive');
const load = relative => import(pathToFileURL(join(source, relative)).href);
const { CentralBrowserSessionAuthority, CentralBrowserSessionNodeRoutes, centralBrowserConsentSignBytes } = await load('packages/wallet-auth/src/central-browser-session.js');
const { CentralBrowserSessionStore } = await load('packages/wallet-auth/src/central-browser-session-store.js');
const { createCentralBrowserSessionRegistry } = await load('packages/wallet-auth/src/central-browser-session-registry.js');
const { walletIdentity } = await load('packages/wallet-auth/src/crypto.js');
const { secp256k1 } = await load('packages/wallet-auth/node_modules/@noble/curves/secp256k1.js');
const { sha256 } = await load('packages/wallet-auth/node_modules/@noble/hashes/sha2.js');
const { hexToBytes, bytesToHex, utf8ToBytes } = await load('packages/wallet-auth/node_modules/@noble/hashes/utils.js');
const { readFile } = await import('node:fs/promises');
const registry = createCentralBrowserSessionRegistry(JSON.parse(await readFile(join(source, 'packages/wallet-auth/product-session-registry.json'))));
const client = registry.find(c => c.productId === 'developer'), random = () => randomBytes(32).toString('base64url');

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ynx-developer-family-real-')), keys = generateKeyPairSync('ed25519');
  const keyPath = join(directory, 'backend.pem'); await writeFile(keyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  let clock = Date.now(), unavailable = false, dropRenew = false, holdRedeem = null, badRevoke = false;
  const store = new CentralBrowserSessionStore(join(directory, 'central'));
  const authority = new CentralBrowserSessionAuthority(registry, store, { now: () => clock,
    backendClients: [{ clientId: client.clientId, keyId: 'developer-qa', publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }) }], familySealKey: randomBytes(32) });
  const routes = new CentralBrowserSessionNodeRoutes(authority), calls = [];
  const central = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    calls.push(request.url);
    if (unavailable) { response.writeHead(503, { 'content-type': 'application/json' }); response.end('{"ok":false,"error":{"code":"SSO_TEMPORARY"}}'); return; }
    const result = routes.handle({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() });
    if (request.url.endsWith('/token-family') && holdRedeem) await holdRedeem;
    if (request.url.endsWith('/renew') && dropRenew && result.status === 200) { dropRenew = false; response.destroy(); return; }
    response.writeHead(result.status, result.headers); response.end(request.url.endsWith('/revoke-family') && badRevoke ? '{"revoked":false}' : result.body);
  });
  await new Promise(resolve => central.listen(0, '127.0.0.1', resolve));
  const fetchImpl = (url, options) => fetch('http://127.0.0.1:' + central.address().port + new URL(url).pathname, options);
  const configuration = { filename: join(directory, 'identity.sqlite'), keyPath: join(directory, 'identity.key'), familyKeyPath: keyPath, familyKeyId: 'developer-qa', now: () => clock, fetchImpl,
    coreSessionInfo: async () => ({ origin: 'https://core.example.test', expiresAt: clock + 7200000 }) };
  let service = await createDeveloperSSO(configuration);
  const developer = createServer((request, response) => service.handler(request, response));
  await new Promise(resolve => developer.listen(0, '127.0.0.1', resolve));
  t.after(async () => { service.close(); await Promise.all([new Promise(r => developer.close(r)), new Promise(r => central.close(r))]); });
  function call(path, { cookie = '', method = 'GET', input, host = 'developer.ynxweb4.com', form = '' } = {}) {
    return new Promise((resolve, reject) => {
      const request = requestHTTP({ hostname: '127.0.0.1', port: developer.address().port, path, method,
        headers: { host, cookie, ...(method === 'POST' ? { origin: client.origin, 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}) } }, response => {
        let body = ''; response.on('data', b => body += b); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body, json: () => JSON.parse(body) }));
      }); request.on('error', reject); request.end(form || (input ? JSON.stringify(input) : undefined));
    });
  }
  async function begin(index = 1) {
    const start = await call('/sso/start'); assert.equal(start.status, 303);
    const input = Object.fromEntries(new URL(start.headers.location).searchParams), binding = random(), { challenge } = authority.challenge(input, binding);
    const key = String(index).padStart(64, '0'), identity = walletIdentity(key);
    const approval = { challengeId: challenge.challengeId, ...identity, walletSignature: bytesToHex(secp256k1.sign(sha256(utf8ToBytes(centralBrowserConsentSignBytes(challenge, identity.account, identity.accountPublicKey))), hexToBytes(key), { prehash: false, format: 'compact', lowS: true })) };
    const session = authority.complete(approval, binding), result = authority.authorize(input, session.sessionToken);
    const callback = '/sso/callback' + new URL(result.redirectUri).search;
    return { cookie: start.headers['set-cookie'][0].split(';')[0], callback, session, identity };
  }
  async function signIn(index) { const pending = await begin(index), result = await call(pending.callback, { cookie: pending.cookie }); assert.equal(result.status, 303, result.body); return { ...pending, cookie: result.headers['set-cookie'][0].split(';')[0], maxAge: result.headers['set-cookie'][0] }; }
  return { call, begin, signIn, authority, store, calls, advance: ms => clock += ms, outage: v => unavailable = v,
    dropRenew: () => dropRenew = true, holdRedeem: value => holdRedeem = value, badRevoke: value => badRevoke = value,
    verifyCore: (cookie) => service.verifyIdentity({ headers: { host: 'core.example.test', cookie } }),
    coreActivity: (cookie, session, action) => service.recordCoreActivity({ headers: { host: 'core.example.test', cookie } }, session, random(), action),
    async restart() { service.close(); service = await createDeveloperSSO(configuration); } };
}

test('real Central Developer family renews beyond access TTL; restart retries lost response; global revoke and other browser isolation', async t => {
  const f = await fixture(t), a = await f.signIn(1), b = await f.signIn(2);
  assert.match(a.maxAge, /Max-Age=7200/); assert.equal((await f.call('/runtime/identity', { cookie: a.cookie })).status, 200);
  f.advance(241000); f.dropRenew(); assert.equal((await f.call('/runtime/identity', { cookie: a.cookie })).status, 503);
  const firstEpoch = f.store.snapshot().families[0].epoch; assert.equal(firstEpoch, 1);
  await f.restart(); assert.equal((await f.call('/runtime/identity', { cookie: a.cookie })).status, 200);
  assert.equal(f.store.snapshot().families[0].epoch, firstEpoch);
  f.outage(true); assert.equal((await f.call('/runtime/identity', { cookie: a.cookie })).status, 503); f.outage(false);
  assert.equal((await f.call('/runtime/identity', { cookie: a.cookie })).status, 200);
  f.authority.logout(a.session.sessionToken);
  assert.equal((await f.call('/runtime/identity', { cookie: a.cookie })).status, 401);
  assert.equal((await f.call('/runtime/identity', { cookie: b.cookie })).status, 200);
});

test('logout during actual Central redemption installs only a fenced revoke target; independent browser survives', async t => {
  const f = await fixture(t), pending = await f.begin(1), b = await f.signIn(2);
  let release; const held = new Promise(resolve => release = resolve); f.holdRedeem(held);
  const late = f.call(pending.callback, { cookie: pending.cookie });
  while (!f.calls.some(path => path.endsWith('/token-family')) || f.store.snapshot().families.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
  const logout = await f.call('/runtime/identity/logout', { cookie: pending.cookie, method: 'POST' }); assert.equal(logout.status, 200);
  release(); f.holdRedeem(null); assert.equal((await late).status, 401);
  const snapshot = f.store.snapshot(), ownSession = snapshot.sessions.find(v => v.account === pending.identity.account);
  assert.equal(snapshot.families.find(v => v.sessionId === ownSession.id).revoked, true);
  assert.equal((await f.call('/runtime/identity', { cookie: b.cookie })).status, 200);
});

test('only reviewed activity extends finite idle; passive requests cannot renew absolute deadline; pending logout recovers', async t => {
  const f = await fixture(t), a = await f.signIn(1), absolute = f.store.snapshot().families[0].absoluteExpiresAt;
  f.advance(1200000); const current = await f.call('/runtime/identity', { cookie: a.cookie }); assert.equal(current.status, 200);
  assert.equal((await f.call('/runtime/identity/activity', { cookie: a.cookie, method: 'POST', input: { csrf: current.json().csrf, action: 'poll', eventId: random() } })).status, 403);
  assert.equal((await f.call('/runtime/identity/activity', { cookie: a.cookie, method: 'POST', input: { csrf: current.json().csrf, action: 'save', eventId: random() } })).status, 200);
  assert.equal(f.store.snapshot().families[0].absoluteExpiresAt, absolute);
  f.advance(1200000); assert.equal((await f.call('/runtime/identity', { cookie: a.cookie })).status, 200);
  f.outage(true); const failed = await f.call('/runtime/identity/logout', { cookie: a.cookie, method: 'POST' }); assert.equal(failed.status, 503); assert.equal(failed.json().signedOut, true);
  assert.equal((await f.call('/runtime/identity', { cookie: a.cookie })).status, 401);
  await f.restart(); f.outage(false); assert.equal((await f.call('/runtime/identity/logout', { cookie: a.cookie, method: 'POST' })).status, 200);
  assert.equal(f.store.snapshot().families[0].revoked, true);
});

test('unconfirmed revoke response retains the original durable retry target across restart', async t => {
  const f = await fixture(t), a = await f.signIn(1); f.badRevoke(true);
  const unconfirmed = await f.call('/runtime/identity/logout', { cookie: a.cookie, method: 'POST' });
  assert.equal(unconfirmed.status, 503); assert.equal(unconfirmed.json().revocationPending, true);
  assert.equal((await f.call('/runtime/identity', { cookie: a.cookie })).status, 401);
  await f.restart(); f.badRevoke(false);
  assert.equal((await f.call('/runtime/identity/logout', { cookie: a.cookie, method: 'POST' })).status, 200);
});

test('isolated core cookie remains parent-bound across access expiry and rejects parent logout immediately', async t => {
  const f = await fixture(t), a = await f.signIn(1);
  const opened = await f.call('/sso/core-open?sessionId=12345678-1234-1234-1234-123456789012', { cookie: a.cookie }); assert.equal(opened.status, 200);
  const ticket = opened.body.match(/name="ticket" value="([^"]+)"/)[1];
  const admitted = await f.call('/sso/core-admit', { method: 'POST', host: 'core.example.test', form: 'ticket=' + ticket }); assert.equal(admitted.status, 303);
  const cookie = admitted.headers['set-cookie'][0].split(';')[0]; assert.match(admitted.headers['set-cookie'][0], /Max-Age=7200/);
  const before = await f.verifyCore(cookie); f.advance(301000);
  const after = await f.verifyCore(cookie); assert.equal(after.owner, before.owner); assert.equal(after.identityReference, before.identityReference); assert.ok(after.expiresAt > before.expiresAt);
  await assert.rejects(f.coreActivity(cookie, 'other-session', 'edit'), { status: 403 });
  await assert.rejects(f.coreActivity(cookie, '12345678-1234-1234-1234-123456789012', 'focus'), { status: 403 });
  const absolute = f.store.snapshot().families[0].absoluteExpiresAt;
  await f.coreActivity(cookie, '12345678-1234-1234-1234-123456789012', 'terminal-input');
  assert.equal(f.store.snapshot().families[0].absoluteExpiresAt, absolute);
  assert.ok(f.calls.some(path => path.endsWith('/activity')));
  await f.call('/runtime/identity/logout', { cookie: a.cookie, method: 'POST' }); await assert.rejects(f.verifyCore(cookie), { status: 401 });
  await assert.rejects(f.coreActivity(cookie, '12345678-1234-1234-1234-123456789012', 'edit'), { status: 403 });
});

test('passive traffic cannot extend idle and explicit activity never resets original absolute end', async t => {
  const idle = await fixture(t), a = await idle.signIn(1); idle.advance(1800001);
  assert.equal((await idle.call('/runtime/identity', { cookie: a.cookie })).status, 401);
  const active = await fixture(t), b = await active.signIn(2), end = active.store.snapshot().families[0].absoluteExpiresAt;
  for (let i = 0; i < 5; i++) {
    active.advance(1200000); const identity = await active.call('/runtime/identity', { cookie: b.cookie }); assert.equal(identity.status, 200);
    assert.equal((await active.call('/runtime/identity/activity', { cookie: b.cookie, method: 'POST', input: { csrf: identity.json().csrf, eventId: random(), action: 'edit' } })).status, 200);
  }
  assert.equal(active.store.snapshot().families[0].absoluteExpiresAt, end); active.advance(1200001);
  assert.equal((await active.call('/runtime/identity', { cookie: b.cookie })).status, 401);
});
