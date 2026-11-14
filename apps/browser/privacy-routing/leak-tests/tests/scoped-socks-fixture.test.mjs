import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { createTemporaryTLS } from '../temporary-tls.mjs';
import { startSyntheticEndpoints } from '../synthetic-endpoints.mjs';
import { startScopedSocksFixture } from '../scoped-socks-fixture.mjs';

async function connect(socks, hostname, port) {
  const socket = net.connect(socks.endpoint); await once(socket, 'connect');
  const greeting = once(socket, 'data'); socket.write(Buffer.from([5, 1, 0])); assert.deepEqual((await greeting)[0], Buffer.from([5, 0]));
  const name = Buffer.from(hostname), request = Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 255])]);
  const result = once(socket, 'data'); socket.write(request); return { socket, reply: (await result)[0] };
}

test('actual SOCKSv5 domain CONNECT forwards only exact synthetic TLS; unrelated targets and refusal are denied', async () => {
  const certificates = await createTemporaryTLS(); let target, socks, refusing;
  try {
    target = await startSyntheticEndpoints({ tls: certificates, runID: 'socks-fixture-test' });
    socks = await startScopedSocksFixture({ hostname: target.manifest.hostname, targetPort: target.manifest.https.port });
    const { socket, reply } = await connect(socks, target.manifest.hostname, target.manifest.https.port); assert.equal(reply[1], 0);
    const secure = tls.connect({ socket, servername: target.manifest.hostname, ca: certificates.ca }); await once(secure, 'secureConnect');
    const response = once(secure, 'data'); secure.write(`GET /https?probe=socks-unit HTTP/1.1\r\nHost: ${target.manifest.hostname}\r\nConnection: close\r\n\r\n`);
    assert.ok((await response)[0].toString().startsWith('HTTP/1.1 200')); secure.destroy();
    const untrustedTunnel = await connect(socks, target.manifest.hostname, target.manifest.https.port);
    const untrusted = tls.connect({ socket: untrustedTunnel.socket, servername: target.manifest.hostname });
    const [certificateError] = await once(untrusted, 'error');
    assert.match(certificateError.code, /UNABLE_TO_VERIFY|SELF_SIGNED_CERT/); untrusted.destroy();
    const denied = await connect(socks, 'unselected.test', target.manifest.https.port); assert.equal(denied.reply[1], 2); denied.socket.destroy();
    refusing = await startScopedSocksFixture({ hostname: target.manifest.hostname, targetPort: target.manifest.https.port, refuseConnections: true });
    const rejected = await connect(refusing, target.manifest.hostname, target.manifest.https.port); assert.equal(rejected.reply[1], 5); rejected.socket.destroy();
    assert.ok(socks.records.some(event => event.kind === 'connect-request' && event.addressType === 'domain'));
    assert.ok(target.records.some(event => event.probeID === 'socks-unit'));
    assert.equal(JSON.stringify(socks.records).includes('unselected.test'), false);
  } finally { if (refusing) await refusing.close(); if (socks) await socks.close(); if (target) await target.close(); await certificates.cleanup(); }
});
