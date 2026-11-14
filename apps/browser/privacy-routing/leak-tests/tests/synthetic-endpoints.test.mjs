import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createTemporaryTLS } from '../temporary-tls.mjs';
import { startSyntheticEndpoints, dnsQuestion, stunBindingResponse } from '../synthetic-endpoints.mjs';

function request(endpoint, ca, path, host = endpoint.hostname) {
  return new Promise((resolve, reject) => {
    https.get({ host: endpoint.https.host, port: endpoint.https.port, servername: endpoint.hostname, ca, path, headers: { host } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
async function udpRoundtrip(packet, endpoint) {
  const ipv6 = endpoint.host === '::1';
  const socket = dgram.createSocket(ipv6 ? 'udp6' : 'udp4'); socket.bind(0, ipv6 ? '::1' : '127.0.0.1'); await once(socket, 'listening');
  try {
    const reply = once(socket, 'message', { signal: AbortSignal.timeout(3000) });
    socket.send(packet, endpoint.port, endpoint.host); return (await reply)[0];
  } finally { socket.close(); }
}

test('local TLS verifies CA, HTTPS/WSS/download receipts are separate from route proof; DNS/STUN are real loopback exchanges', async () => {
  const temporary = await createTemporaryTLS(); let endpoints;
  try {
    endpoints = await startSyntheticEndpoints({ tls: temporary, runID: 'endpoint-test' });
    const manifest = endpoints.manifest;
    const httpsResult = await request(manifest, temporary.ca, '/https?probe=https-test');
    assert.equal(httpsResult.status, 200); assert.equal(JSON.parse(httpsResult.bytes).synthetic, true);
    const downloaded = await request(manifest, temporary.ca, '/download?probe=download-test');
    assert.equal(downloaded.status, 200); assert.equal(createHash('sha256').update(downloaded.bytes).digest('hex'), manifest.payloadSHA256);
    assert.equal((await request(manifest, temporary.ca, '/https', 'unrelated.test')).status, 421);
    const page = await request(manifest, temporary.ca, '/probe');
    assert.ok(page.bytes.toString().includes('RTCPeerConnection')); assert.equal(page.bytes.toString().includes('getUserMedia'), false);

    const socket = tls.connect({ host: manifest.https.host, port: manifest.https.port, servername: manifest.hostname, ca: temporary.ca });
    await once(socket, 'secureConnect');
    socket.write(`GET /wss?probe=wss-test HTTP/1.1\r\nHost: ${manifest.hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
    const [handshake] = await once(socket, 'data'); assert.ok(handshake.toString().includes('101 Switching Protocols')); socket.destroy();

    const labels = manifest.hostname.split('.').map(label => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]));
    const header = Buffer.alloc(12); header.writeUInt16BE(0x1234); header.writeUInt16BE(1, 4);
    for (const type of [1, 28]) {
      const tail = Buffer.alloc(5); tail.writeUInt16BE(type, 1); tail.writeUInt16BE(1, 3);
      const packet = Buffer.concat([header, ...labels, tail]);
      const reply = await udpRoundtrip(packet, manifest.dns); assert.equal(reply.readUInt16BE(6), 1); assert.equal(dnsQuestion(reply).type, type);
    }
    const stun = Buffer.alloc(20); stun.writeUInt16BE(1); stun.writeUInt32BE(0x2112a442, 4); Buffer.from('123456789012').copy(stun, 8);
    const stunReply = await udpRoundtrip(stun, manifest.stun); assert.equal(stunReply.readUInt16BE(0), 0x0101); assert.equal(stunReply.subarray(8, 20).toString(), '123456789012');
    if (manifest.ipv6.status === 'LISTENING') {
      assert.equal((await request({ ...manifest, https: manifest.ipv6.https }, temporary.ca, '/https?probe=https-v6-test')).status, 200);
      const tail = Buffer.alloc(5); tail.writeUInt16BE(28, 1); tail.writeUInt16BE(1, 3);
      assert.equal((await udpRoundtrip(Buffer.concat([header, ...labels, tail]), manifest.ipv6.dns)).readUInt16BE(6), 1);
      assert.equal((await udpRoundtrip(stun, manifest.ipv6.stun)).length, 44);
      assert.ok(endpoints.records.some(record => record.protocol === 'stun' && record.addressFamily === 'ipv6'));
    } else {
      assert.equal(manifest.ipv6.status, 'UNAVAILABLE_NOT_COVERED');
    }
    assert.deepEqual(new Set(endpoints.records.map(record => record.protocol)), new Set(['tcp', 'https', 'wss', 'download', 'dns', 'stun']));
    assert.ok(endpoints.records.filter(record => record.kind === 'tcp-accepted').every(record => Number.isInteger(record.peerPort) && [manifest.https.port, manifest.ipv6.https?.port].includes(record.localPort)));
    assert.ok(endpoints.records.filter(record => record.protocol === 'stun').every(record => Number.isInteger(record.peerPort) && ['127.0.0.1', '::1'].includes(record.targetHost) && [manifest.stun.port, manifest.ipv6.stun?.port].includes(record.targetPort)));
    assert.equal(manifest.targetAcceptance, 'NOT_RUN'); assert.equal(manifest.webRTC, 'PAGE_PROBE_SUPPLIED_NOT_EXECUTED');
  } finally { if (endpoints) await endpoints.close(); await temporary.cleanup(); }
});

test('malformed/unrelated datagrams are ignored, no external resolver exists', () => {
  assert.equal(dnsQuestion(Buffer.alloc(2)), null); assert.equal(stunBindingResponse(Buffer.alloc(20), { family: 'IPv4', address: '127.0.0.1', port: 1000 }), null);
});
