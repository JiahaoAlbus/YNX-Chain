import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnedListenerCapturePlan } from '../platform-probe/capture-plan.mjs';
import { prepareOwnedListenerCapture } from '../platform-probe/capture-plan.mjs';
import { buildWebKitBootstrap } from '../platform-probe/bootstrap.mjs';
import { waitForApprovedFixture } from '../platform-probe/tunnel-readiness.mjs';
import { startPublicNonceFixture } from '../public-nonce-fixture.mjs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('administrator review plan permits only owned loopback tuples; no pktap userspace or all-DNS filter', () => {
  const plan = buildOwnedListenerCapturePlan({ runID: 'platform-test', listeners: [{ pid: 12345, host: '127.0.0.1', port: 19443, transport: 'tcp' }, { pid: 12345, host: '::1', port: 13478, transport: 'udp' }] });
  assert.equal(plan.arguments[1], 'lo0'); assert.ok(!plan.arguments.includes('-Q')); assert.ok(!plan.arguments.some(value => value.includes('pktap')));
  assert.equal(plan.automaticallyElevates, false); assert.match(plan.arguments.at(-1), /port 19443/);
  for (const listener of [{ pid: 123, host: '0.0.0.0', port: 19443, transport: 'tcp' }, { pid: 123, host: '127.0.0.1', port: 53, transport: 'udp' }]) assert.throws(() => buildOwnedListenerCapturePlan({ runID: 'platform-test', listeners: [listener] }));
});

test('allocated URL is not readiness; exact same approved tunnel retries only after registration', async () => {
  let now = 0, probes = 0;
  const tunnel = { origin: 'https://synthetic-readiness.trycloudflare.com', alive: true, registered: false };
  const fixture = { registerPublicOrigins() {}, manifest: () => ({}) };
  const observed = await waitForApprovedFixture({ tunnels: [tunnel], fixture, milliseconds: 5000, now: () => now, pause: async ms => { now += ms; if (now >= 1000) tunnel.registered = true; }, probe: async origin => { probes++; assert.equal(origin, tunnel.origin); assert.ok(tunnel.registered); return probes === 1 ? { error: 'ENOTFOUND' } : { exactBody: true, status: 200 }; } });
  assert.equal(observed.ready, true); assert.equal(probes, 2); assert.equal(observed.attempts[0].error, 'ENOTFOUND');
  tunnel.alive = false; probes = 0;
  const failed = await waitForApprovedFixture({ tunnels: [tunnel], fixture, milliseconds: 5000, now: () => now, probe: async () => { probes++; } });
  assert.equal(failed.ready, false); assert.equal(probes, 0); assert.equal(failed.noReplacementProvisioned, true);
});

test('nonce-only loopback fixture serves exact proof/download/WSS bytes and rejects other paths', async t => {
  const fixture = await startPublicNonceFixture({ runID: 'public-fixture-test', lifetimeSeconds: 10 }); t.after(() => fixture.close());
  const manifest = fixture.manifest();
  const get = path => new Promise((resolve, reject) => { http.get({ host: fixture.endpoint.host, port: fixture.endpoint.port, path }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, bytes: Buffer.concat(chunks) })); }).on('error', reject); });
  for (const key of ['proof', 'download']) { const value = await get(manifest.paths[key]); assert.equal(value.status, 200); assert.equal(createHash('sha256').update(value.bytes).digest('hex'), manifest.expectedSHA256[key]); }
  assert.equal((await get('/etc/passwd')).status, 404);
  assert.equal((await get('/ynx-route-probe/other-run/proof')).status, 404);
  const message = await new Promise((resolve, reject) => { const socket = net.connect(fixture.endpoint.port, fixture.endpoint.host); let bytes = Buffer.alloc(0); socket.on('error', reject); socket.on('connect', () => socket.write(`GET ${manifest.paths.wss} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: YWJjZGVmZ2hpamtsbW5vcA==\r\nSec-WebSocket-Version: 13\r\n\r\n`)); socket.on('data', chunk => { bytes = Buffer.concat([bytes, chunk]); const at = bytes.indexOf('\r\n\r\n'); if (at < 0 || bytes.length < at + 6) return; const length = bytes[at + 5] & 127; if (bytes.length < at + 6 + length) return; const payload = bytes.subarray(at + 6, at + 6 + length); socket.destroy(); resolve(payload); }); });
  assert.equal(createHash('sha256').update(message).digest('hex'), manifest.expectedSHA256.wss);
  assert.equal(fixture.records.length, 3); assert.ok(fixture.records.every(record => record.originTransport.startsWith('http-loopback')));
});

test('reviewable capture executor denies an ordinary user before opening any capture', { skip: process.platform !== 'darwin' || process.getuid() === 0 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'p05-capture-deny-')); t.after(() => rm(directory, { recursive: true }));
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => listener.close(resolve)));
  const review = await prepareOwnedListenerCapture({ runID: 'capture-deny-test', listeners: [{ host: '127.0.0.1', port: listener.address().port, pid: process.pid, transport: 'tcp' }] }, join(directory, 'review'));
  await assert.rejects(promisify(execFile)(review.reviewedCommand[0], review.reviewedCommand.slice(1)), error => error.code === 77 && error.stderr.includes('No capture attempted'));
  await assert.rejects(stat(join(review.directory, 'owned-lo0.pcap')), { code: 'ENOENT' });
  assert.equal(review.automaticallyElevates, false);
});

test('bootstrap is a run-bound real-WebKit probe instrument, not a JS network API replacement', () => {
  const result = buildWebKitBootstrap({ runID: 'platform-test', httpsPort: 19443, stunPort: 13478 });
  assert.match(result.sha256, /^[a-f0-9]{64}$/); assert.ok(result.html.includes('new RTCPeerConnection')); assert.ok(result.html.includes('new WebSocket')); assert.ok(result.html.includes('/download?probe='));
  assert.equal(result.modifiesNetworkingAPIs, false); assert.equal(result.html.includes('window.RTCPeerConnection ='), false); assert.equal(result.html.includes('getUserMedia'), false);
  assert.throws(() => buildWebKitBootstrap({ runID: 'platform-test', httpsPort: 19443, stunPort: 13478, targetHost: 'ordinary-user.example.com' }));
  assert.throws(() => buildWebKitBootstrap({ runID: 'platform-test', stunPort: 13478, publicFixture: { nonce: 'platform-test', origins: ['https://synthetic.example:8443'], responseSHA256: 'a'.repeat(64), downloadSHA256: 'b'.repeat(64) } }));
});
