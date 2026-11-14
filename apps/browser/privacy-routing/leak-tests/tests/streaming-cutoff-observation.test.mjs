import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { once } from 'node:events';
import { lstat, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
import test from 'node:test';
import { createTemporaryTLS } from '../temporary-tls.mjs';
import * as runner from '../streaming-fault-runner.mjs';
import { startSyntheticEndpoints } from '../synthetic-endpoints.mjs';

const childScript = fileURLToPath(new URL('../fixtures/stream-socks-process.mjs', import.meta.url));

test('streaming WSS counts only genuine complete application frames', { timeout: 7000 }, async t => {
  const temporary = await createTemporaryTLS();
  t.after(() => temporary.cleanup());
  const runID = 'stream-opcode-test', hostname = `${runID}.leak.test`;
  const frame = (header, sequence) => {
    const payload = Buffer.from(`${runID}:${sequence}`);
    return Buffer.concat([Buffer.from([header, payload.length]), payload]);
  };
  const textHashes = [1, 2].map(sequence => createHash('sha256').update(`${runID}:${sequence}`).digest('hex'));
  for (const [name, frames, expected] of [
    ['nonce-matching Pong', [frame(0x8a, 1), frame(0x8a, 2)], { hashes: [], truncated: false }],
    ['text plus partial frame at close', [frame(0x81, 1), frame(0x81, 2), frame(0x81, 3).subarray(0, 5)], { hashes: textHashes, truncated: true }],
    ['invalid RSV with matching bytes', [frame(0xc1, 1)], { hashes: [], truncated: true, error: 'INVALID_FIXTURE_FRAME' }],
  ]) {
    await t.test(name, async () => {
      const peers = new Set();
      const server = tls.createServer({ key: temporary.key, cert: temporary.cert }, socket => {
        peers.add(socket);
        socket.on('error', () => {});
        socket.once('close', () => peers.delete(socket));
        socket.once('data', bytes => {
          const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(bytes.toString('ascii'))?.[1];
          const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
          socket.end(Buffer.concat([Buffer.from(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`), ...frames]));
        });
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const socket = tls.connect({ host: '127.0.0.1', port: server.address().port, servername: hostname, ca: temporary.ca });
      try {
        await once(socket, 'secureConnect', { signal: AbortSignal.timeout(1000) });
        const closed = once(socket, 'close', { signal: AbortSignal.timeout(1000) });
        const observed = runner.websocket(socket, { hostname });
        await closed;
        assert.equal(observed.opened, true);
        assert.equal(observed.closed, true);
        assert.deepEqual(observed.messageHashes, expected.hashes);
        assert.equal(observed.truncatedFrameAtClose, expected.truncated);
        assert.equal(observed.error, expected.error);
      } finally {
        socket.destroy();
        for (const peer of peers) peer.destroy();
        await new Promise(resolve => server.close(resolve));
      }
    });
  }
});

test('cutoff observes genuine IPv6 DNS and TCP while original owned route exits', { timeout: 8000 }, async t => {
  const temporary = await createTemporaryTLS();
  t.after(() => temporary.cleanup());
  const target = await startSyntheticEndpoints({ tls: temporary, runID: 'stream-cursor-test' });
  t.after(() => target.close());
  if (target.manifest.ipv6.status !== 'LISTENING') { t.skip('owned IPv6 listeners unavailable'); return; }

  const endpoint = target.manifest.ipv6.https;
  const child = fork(childScript, [target.manifest.hostname, String(endpoint.port), '::1'],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] });
  const exit = once(child, 'exit').then(([code, signal]) => ({ code, signal }));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exit;
  });
  const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(1000) });
  assert.equal(ready.kind, 'ready');
  assert.equal(ready.pid, child.pid);

  const tcp = [], udp = target.records;
  const observe = runner.beginStreamingCutoffObservation(tcp, target);
  assert.equal(child.kill('SIGKILL'), true);
  const resolver = new Resolver({ timeout: 600, tries: 1 });
  resolver.setServers([`[::1]:${target.manifest.ipv6.dns.port}`]);
  try { assert.deepEqual(await resolver.resolve6(target.manifest.hostname), ['::1']); }
  finally { resolver.cancel(); }

  const socket = net.connect(endpoint.port, endpoint.host);
  try {
    await once(socket, 'connect', { signal: AbortSignal.timeout(1000) });
    const end = performance.now() + 500;
    while (!udp.some(record => record.kind === 'tcp-accepted') && performance.now() < end) await delay(5);
    const actual = udp.find(record => record.kind === 'tcp-accepted');
    assert.ok(actual);
    tcp.push({ kind: 'tcp', localPort: actual.localPort, family: 'IPv6' });
  } finally { socket.destroy(); }
  assert.deepEqual(await exit, { code: null, signal: 'SIGKILL' });
  const result = observe();
  assert.equal(result.postFaultTargetRecords[0]?.kind, 'tcp', 'real TCP arrived while the old runner had no cursor');
  assert.equal(result.ownedUDP[0]?.kind, 'dns');
  assert.equal(result.ownedUDP[0]?.addressFamily, 'ipv6');
});

test('streaming download retires only its own private staging file', { timeout: 8000 }, async t => {
  const temporary = await createTemporaryTLS();
  t.after(() => temporary.cleanup());
  const hostname = 'stream-download-test.leak.test';
  const fragment = Buffer.alloc(16384, 0x53);
  const expectedBody = Buffer.concat([fragment, fragment]);
  const digest = data => createHash('sha256').update(data).digest('hex');
  const target = { hostname, length: expectedBody.length, fullSHA256: digest(expectedBody) };
  const sentinel = Buffer.from('unowned staging file');

  for (const name of ['incomplete body', 'exclusive open collision', 'staging inode replacement']) {
    await t.test(name, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'p05-stream-download-'));
      const staging = join(directory, 'control.partial'), final = join(directory, 'control.bin');
      const peers = new Set();
      let peer;
      const server = tls.createServer({ key: temporary.key, cert: temporary.cert }, socket => {
        peers.add(socket);
        socket.on('error', () => {});
        socket.once('close', () => peers.delete(socket));
        socket.once('data', () => {
          const headers = Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${target.length}\r\nConnection: close\r\n\r\n`);
          peer = socket;
          if (name === 'staging inode replacement') socket.write(Buffer.concat([headers, fragment]));
          else socket.end(Buffer.concat([headers, fragment]));
        });
      });
      let socket;
      try {
        if (name === 'exclusive open collision') await writeFile(staging, sentinel, { flag: 'wx', mode: 0o600 });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening', { signal: AbortSignal.timeout(1000) });
        socket = tls.connect({ host: '127.0.0.1', port: server.address().port, servername: hostname, ca: temporary.ca });
        await once(socket, 'secureConnect', { signal: AbortSignal.timeout(1000) });
        const download = await runner.download(socket, target, directory, 'control');
        if (name === 'staging inode replacement') {
          const end = performance.now() + 1000;
          while ((download.observed.bytes !== fragment.length || download.observed.stagingRetirement !== 'PENDING') && performance.now() < end) {
            await delay(5);
          }
          assert.equal(download.observed.bytes, fragment.length);
          assert.equal(download.observed.stagingRetirement, 'PENDING');
          await rename(staging, join(directory, 'original.partial'));
          await writeFile(staging, sentinel, { flag: 'wx', mode: 0o600 });
          peer.end();
        }
        let result;
        try { result = await Promise.race([download.done, delay(2000, undefined, { ref: false })]); }
        finally { socket.destroy(); }
        assert.ok(result, 'download retirement must finish after its response closes');
        assert.equal(result.committed, false);
        await assert.rejects(lstat(final), { code: 'ENOENT' });
        if (name === 'exclusive open collision') {
          assert.equal(result.error, 'EEXIST');
          assert.equal(result.stagingRetirement, 'NOT_OPENED');
          assert.deepEqual(await readFile(staging), sentinel);
        } else {
          assert.equal(result.error, 'ABORTED');
          assert.equal(result.bytes, fragment.length);
          assert.equal(result.sha256, digest(fragment));
          if (name === 'staging inode replacement') {
            assert.equal(result.stagingRetirement, 'UNKNOWN');
            assert.equal(result.cleanupError, 'STAGING_IDENTITY_CHANGED');
            assert.deepEqual(await readFile(staging), sentinel);
            assert.deepEqual(await readFile(join(directory, 'original.partial')), fragment);
          } else {
            assert.equal(result.stagingRetirement, 'REMOVED');
            await assert.rejects(lstat(staging), { code: 'ENOENT' });
          }
        }
      } finally {
        socket?.destroy();
        for (const peer of peers) peer.destroy();
        await new Promise(resolve => server.close(resolve));
        await rm(directory, { recursive: true });
      }
    });
  }
});
