import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createCodeOSSProxy } from '../src/proxy.mjs';

const helper = await readFile(new URL('../../../native/ynx-brand/workbench-activity.js', import.meta.url), 'utf8');
const html = `<html><head><script data-ynx-workbench-activity="v1">${helper}</script></head><body></body></html>`;
async function fixture(t) {
  let clock = Date.now(), reference = 'parent-A', allowed = true, entry = html;
  const events = [];
  const kernel = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; script-src 'self'; frame-src 'self'", 'service-worker-allowed': '/' }); res.end(entry); });
  await new Promise(resolve => kernel.listen(0, '127.0.0.1', resolve));
  const proxy = createCodeOSSProxy({ now: () => clock, sessionForHost: async () => 'core-A', originForSession: async () => 'https://core.example/',
    service: { authorizeConnection: async () => { if (!allowed) throw Object.assign(new Error('retired'), { status: 401 });
      return { context: {}, expiresAt: clock + 7200000, identity: { identityReference: reference, isCurrent() { if (!allowed) throw Object.assign(new Error('retired'), { status: 401 }); } } }; } },
    recordActivity: async (_request, session, eventId, action) => events.push({ session, eventId, action }),
    driver: { connect: async () => ({ socket: connect(kernel.address().port, '127.0.0.1'), tokenMode: 'private-loopback-without-connection-token' }) } });
  const server = createServer(async (req, res) => { await proxy.handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { proxy.close(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => kernel.close(resolve))]); });
  async function call(path, headers = {}, input) {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server.address().port, method: input ? 'POST' : 'GET', path,
        headers: { host: 'core.example', ...(input ? { origin: 'https://core.example', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty' } : {}), ...headers } }, res => {
        let body = ''; res.on('data', b => body += b); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }); req.on('error', reject); req.end(input ? JSON.stringify(input) : undefined);
    });
  }
  async function document() { const result = await call('/', { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' });
    assert.equal(result.status, 200); const capability = result.body.match(/const capability = "([A-Za-z0-9_-]{43})"/)[1]; return { ...result, capability }; }
  return { call, document, events, tamper: value => entry = value, advance: () => clock += 30001, switch: () => reference = 'parent-B', logout: () => allowed = false };
}

test('upstream cannot alter the reviewed bootstrap or run a script before its captured primitives', async t => {
  const f = await fixture(t), navigation = { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' };
  f.tamper(html.replace('event.isTrusted', 'true'));
  assert.equal((await f.call('/', navigation)).status, 503);
  f.tamper(html.replace('<head>', '<head><script src="/workspace.js"></script>'));
  assert.equal((await f.call('/', navigation)).status, 503);
  assert.equal(f.events.length, 0);
});

test('fixed top document gets a private per-window capability; fetch and iframe do not', async t => {
  const f = await fixture(t), doc = await f.document();
  assert.ok(doc.headers['content-security-policy'].includes("'nonce-"));
  assert.ok(!doc.body.includes('__YNX_WORKBENCH_WINDOW_CAPABILITY_V1__'));
  assert.ok((await f.call('/')).body.includes('__YNX_WORKBENCH_WINDOW_CAPABILITY_V1__'));
  assert.ok((await f.call('/', { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' })).body.includes('__YNX_WORKBENCH_WINDOW_CAPABILITY_V1__'));
  assert.equal(f.events.length, 0);
});

test('activity is bound to verified parent reference and exact event; replay, wrong origin and passive action reject', async t => {
  const f = await fixture(t), doc = await f.document(), input = { capability: doc.capability, eventId: randomUUID(), action: 'edit' };
  assert.equal((await f.call('/runtime/workbench-activity', {}, input)).status, 200);
  assert.equal(f.events.length, 1); assert.match(f.events[0].eventId, /^[A-Za-z0-9_-]{43}$/);
  f.advance(); assert.equal((await f.call('/runtime/workbench-activity', {}, input)).status, 409);
  assert.equal((await f.call('/runtime/workbench-activity', { origin: 'https://workspace.example' }, { ...input, eventId: randomUUID() })).status, 403);
  assert.equal((await f.call('/runtime/workbench-activity', {}, { ...input, eventId: randomUUID(), action: 'focus' })).status, 403);
  f.switch(); assert.equal((await f.call('/runtime/workbench-activity', {}, { ...input, eventId: randomUUID() })).status, 403);
  assert.equal(f.events.length, 1);
});

test('logout retires existing document admission; active workspace documents have opaque sandbox and cannot register root service worker', async t => {
  const f = await fixture(t), doc = await f.document();
  const workspace = await f.call('/vscode-remote-resource?path=/project/preview.html', { 'sec-fetch-dest': 'document' });
  assert.ok(workspace.headers['content-security-policy'].includes('sandbox allow-scripts allow-downloads'));
  assert.equal(workspace.headers['service-worker-allowed'], undefined);
  assert.equal((await f.call('/vscode-remote-resource?path=/project/worker.js', { 'service-worker': 'script' })).status, 403);
  f.logout(); assert.equal((await f.call('/runtime/workbench-activity', {}, { capability: doc.capability, eventId: randomUUID(), action: 'terminal-input' })).status, 401);
  assert.equal(f.events.length, 0);
});
