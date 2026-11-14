import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { startSyntheticEndpoints } from '../synthetic-endpoints.mjs';
import { createTemporaryTLS } from '../temporary-tls.mjs';

const COOKIE = 0x2112a442;
const STUN_MASK = Buffer.from('2112a442', 'hex');

function question(name, { id, type = 1, dnsClass = 1, flags = 0x0100, answers = 0, authority = 0, extra } = {}) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answers, 6);
  header.writeUInt16BE(authority, 8);
  header.writeUInt16BE(extra ? 1 : 0, 10);
  const labels = name.split('.').map(label => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]));
  const tail = Buffer.alloc(5);
  tail.writeUInt16BE(type, 1);
  tail.writeUInt16BE(dnsClass, 3);
  return Buffer.concat([header, ...labels, tail, extra ?? Buffer.alloc(0)]);
}

function binding(id, attributes = Buffer.alloc(0)) {
  const header = Buffer.alloc(20, id);
  header.writeUInt16BE(1, 0);
  header.writeUInt16BE(attributes.length, 2);
  header.writeUInt32BE(COOKIE, 4);
  return Buffer.concat([header, attributes]);
}

async function exchange(endpoint, malformed, positive, stun = false) {
  const socket = dgram.createSocket(endpoint.host === '::1' ? 'udp6' : 'udp4');
  const replies = [];
  try {
    const ready = once(socket, 'listening', { signal: AbortSignal.timeout(1500) });
    socket.bind(0, endpoint.host);
    await ready;
    socket.on('message', bytes => replies.push(bytes));
    const localPort = socket.address().port;
    for (const packet of [...malformed, positive]) {
      await new Promise((resolve, reject) => socket.send(packet, endpoint.port, endpoint.host,
        error => error ? reject(error) : resolve()));
    }
    const matches = stun
      ? bytes => bytes.subarray(8, 20).equals(positive.subarray(8, 20))
      : bytes => bytes.readUInt16BE(0) === positive.readUInt16BE(0);
    for (let i = 0; i < 50 && !replies.some(matches); i++) await pause(10);
    await pause(100);
    return { replies, localPort };
  } finally {
    await new Promise(resolve => socket.close(resolve));
  }
}

test('only well-formed owned DNS questions and STUN Binding requests count as UDP receipts', { timeout: 10000 }, async t => {
  const tls = await createTemporaryTLS();
  t.after(() => tls.cleanup());
  const fixture = await startSyntheticEndpoints({ tls, runID: 'udp-wire-boundary' });
  t.after(() => fixture.close());
  const { manifest, records } = fixture;
  for (const [family, endpoints] of [['ipv4', manifest], ['ipv6', manifest.ipv6]]) {
    await t.test(family, { skip: !endpoints.dns && 'IPv6 loopback fixture unavailable' }, async familyTest => {
      await familyTest.test('exact DNS exchange, positive resolver and rejected wire negatives', async () => {
        const name = manifest.hostname;
        const before = records.length;
        const opt = Buffer.from('00002904d0000000000000', 'hex'); // EDNS0 root owner, no options.
        const highBitAlias = question(name, { id: 8 });
        highBitAlias[13] |= 0x80;
        const { replies } = await exchange(endpoints.dns, [
          question(name, { id: 1, flags: 0x8400 }),
          question(name, { id: 2, dnsClass: 3 }),
          question(name, { id: 3, answers: 1 }),
          question(name, { id: 4, authority: 1 }),
          question(name, { id: 5, extra: opt.subarray(0, -1) }),
          question('unrelated.leak.test', { id: 6 }),
          question(name, { id: 7, flags: 0x0900 }),
          highBitAlias,
        ], question(name, { id: 0x1234, extra: opt }));
        assert.deepEqual(replies.map(bytes => bytes.readUInt16BE(0)), [0x1234]);
        assert.equal(replies[0].readUInt16BE(6), 1);
        assert.deepEqual(replies[0].subarray(-4), Buffer.from([127, 0, 0, 1]));
        assert.deepEqual(records.slice(before).map(row => [row.protocol, row.addressFamily, row.queryType, row.hostname]),
          [['dns', family, 1, name]]);

        const resolver = new Resolver({ timeout: 500, tries: 1 });
        const host = family === 'ipv6' ? '[::1]' : '127.0.0.1';
        resolver.setServers([`${host}:${endpoints.dns.port}`]);
        try {
          assert.deepEqual(await resolver.resolve4(name), ['127.0.0.1']);
          assert.deepEqual(await resolver.resolve6(name), ['::1']);
        } finally { resolver.cancel(); }
        const https = await exchange(endpoints.dns, [], question(name, { id: 0x5678, type: 65 }));
        assert.deepEqual(https.replies.map(bytes => [bytes.readUInt16BE(0), bytes.readUInt16BE(6)]), [[0x5678, 0]]);
        assert.deepEqual(records.slice(before + 1).map(row => [row.addressFamily, row.queryType]), [[family, 1], [family, 28], [family, 65]]);
      });
      await familyTest.test('exact STUN transaction and XOR endpoint, rejected malformed datagrams', async () => {
        const before = records.length;
        const positive = binding(0x31, Buffer.from('8022000341424300', 'hex')); // Optional SOFTWARE, with padding.
        const { replies, localPort } = await exchange(endpoints.stun, [
          binding(0x41, Buffer.alloc(1)), // Unaligned message body.
          binding(0x42, Buffer.from('80220008', 'hex')), // Attribute overruns packet.
        ], positive, true);
        assert.equal(replies.length, 1);
        const [response] = replies;
        assert.equal(response.readUInt16BE(0), 0x0101);
        assert.equal(response.readUInt16BE(2), response.length - 20);
        assert.equal(response.readUInt32BE(4), COOKIE);
        assert.deepEqual(response.subarray(8, 20), positive.subarray(8, 20));
        assert.equal(response.readUInt16BE(20), 0x0020);
        assert.equal(response[25], family === 'ipv6' ? 2 : 1);
        assert.equal(response.readUInt16BE(26) ^ 0x2112, localPort);
        const mask = Buffer.concat([STUN_MASK, positive.subarray(8, 20)]);
        const address = response.subarray(28).map((byte, index) => byte ^ mask[index]);
        assert.deepEqual(address, family === 'ipv6' ? Buffer.from('00000000000000000000000000000001', 'hex') : Buffer.from([127, 0, 0, 1]));
        assert.deepEqual(records.slice(before).map(row => [row.protocol, row.addressFamily, row.peerPort, row.targetHost, row.targetPort, row.transactionID]),
          [['stun', family, localPort, endpoints.stun.host, endpoints.stun.port, positive.subarray(8, 20).toString('hex')]]);
      });
    });
  }
  assert.equal(manifest.webRTC, 'PAGE_PROBE_SUPPLIED_NOT_EXECUTED');
  assert.equal(manifest.targetAcceptance, 'NOT_RUN');
});
