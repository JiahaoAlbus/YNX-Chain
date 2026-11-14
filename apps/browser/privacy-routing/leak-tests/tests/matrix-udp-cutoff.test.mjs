import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { matrixOwnedListenerTuples, recordMatrixTargetObservations } from '../platform-matrix-runner.mjs';
import { buildOwnedListenerCapturePlan } from '../platform-probe/capture-plan.mjs';
import { startScopedSocksFixture } from '../scoped-socks-fixture.mjs';
import { startSyntheticEndpoints } from '../synthetic-endpoints.mjs';
import { createTemporaryTLS } from '../temporary-tls.mjs';

async function dnsRoundtrip(endpoint, hostname) {
  const resolver = new Resolver({ timeout: 700, tries: 1 });
  const host = endpoint.host === '::1' ? '[::1]' : '127.0.0.1';
  resolver.setServers([`${host}:${endpoint.port}`]);
  try { assert.deepEqual(await resolver.resolve4(hostname), ['127.0.0.1']); }
  finally { resolver.cancel(); }
}

async function stunRoundtrip(endpoint, transaction) {
  const socket = dgram.createSocket(endpoint.host === '::1' ? 'udp6' : 'udp4');
  try {
    const listening = once(socket, 'listening', { signal: AbortSignal.timeout(1000) });
    socket.bind(0, endpoint.host);
    await listening;
    const reply = once(socket, 'message', { signal: AbortSignal.timeout(1000) });
    const bytes = Buffer.alloc(20);
    bytes.writeUInt16BE(1, 0);
    bytes.writeUInt32BE(0x2112a442, 4);
    transaction.copy(bytes, 8);
    socket.send(bytes, endpoint.port, endpoint.host);
    const [response, source] = await reply;
    assert.equal(response.readUInt16BE(0), 0x0101);
    assert.deepEqual(response.subarray(8, 20), transaction);
    assert.equal(source.port, endpoint.port);
    assert.equal(source.address, endpoint.host);
  } finally { await new Promise(resolve => socket.close(resolve)); }
}

async function requireClosed(endpoint) {
  const client = net.connect({ host: endpoint.host, port: endpoint.port, timeout: 1000 });
  client.on('timeout', () => client.destroy());
  try { await assert.rejects(once(client, 'connect', { signal: AbortSignal.timeout(1500) }), { code: 'ECONNREFUSED' }); }
  finally { client.destroy(); }
}

test('matrix detects DNS and STUN after actual owned SOCKS listener closure', { timeout: 10000 }, async t => {
  const tls = await createTemporaryTLS();
  let target, socks;
  try {
    target = await startSyntheticEndpoints({ tls });
    const { manifest } = target;
    socks = await startScopedSocksFixture({ hostname: manifest.hostname, targetPort: manifest.https.port });
    const route = socks.endpoint;
    const families = [['ipv4', manifest]];
    if (manifest.ipv6.status === 'LISTENING') families.push(['ipv6', manifest.ipv6]);
    const plan = buildOwnedListenerCapturePlan({
      runID: manifest.runID, listeners: matrixOwnedListenerTuples(manifest, route, process.pid),
    });
    const targetCursor = target.records.length;
    const faultAt = Date.now();
    await socks.close();
    socks = null;
    await requireClosed(route);
    for (const [family, endpoints] of families) {
      await t.test(family, async familyTest => {
        const observations = (rows, direct = false) => {
          const result = {
            runID: manifest.runID, targetCursor, faultAt, targetRecords: rows,
            targetVerdict: 'INCOMPLETE', socksRecords: [], publicRecords: [],
          };
          recordMatrixTargetObservations(result, { manifest, direct });
          return result;
        };
        await familyTest.test('owned DNS is included in capture review and independently flags post-cutoff arrival', async () => {
          await dnsRoundtrip(endpoints.dns, manifest.hostname);
          const dns = target.records.at(-1);
          assert.equal(dns.protocol, 'dns');
          assert.equal(dns.addressFamily, family);
          const result = observations(target.records.map(row => row === dns ? { ...row, at: faultAt } : row));
          assert.equal(result.targetVerdict, 'FAIL');
          assert.deepEqual(result.afterFaultOwnedDNS.filter(row => row.addressFamily === family).map(row => row.sequence), [dns.sequence]);
          const candidate = plan.listeners.find(row => row.host === endpoints.dns.host && row.port === endpoints.dns.port && row.transport === 'udp');
          assert.equal(candidate?.pid, process.pid);
          assert.equal(plan.executesDuringPreparation, false);
          assert.equal(dns.targetHost, endpoints.dns.host);
          assert.equal(dns.targetPort, endpoints.dns.port);
          const foreign = [
            { ...dns, hostname: 'unrelated.leak.test' },
            { ...dns, runID: 'unrelated' },
            { ...dns, targetPort: endpoints.stun.port },
          ];
          for (const record of foreign) assert.equal(observations([record]).targetVerdict, 'INCOMPLETE');
          const calibration = observations(target.records, true);
          assert.equal(calibration.directControlObserved, true);
          assert.equal(calibration.targetVerdict, 'INCOMPLETE');
          assert.equal(result.udpSourceAppAttribution, 'NOT_OBSERVED');
        });
        await familyTest.test('owned STUN remains independently observable after route closure', async () => {
          const transaction = Buffer.alloc(12, family === 'ipv4' ? 4 : 6);
          await stunRoundtrip(endpoints.stun, transaction);
          const stun = target.records.at(-1);
          assert.equal(stun.transactionID, transaction.toString('hex'));
          const result = observations(target.records);
          assert.equal(result.targetVerdict, 'FAIL');
          assert.deepEqual(result.afterFaultOwnedSTUN.filter(row => row.addressFamily === family).map(row => row.transactionID),
            [transaction.toString('hex')]);
        });
      });
    }
    if (families.length === 1) await t.test('IPv6 loopback unavailable', { skip: true }, () => {});
    assert.equal(target.records.some(row => row.protocol === 'tcp' || row.protocol === 'wss' || row.protocol === 'download'), false);
    assert.equal(manifest.webRTC, 'PAGE_PROBE_SUPPLIED_NOT_EXECUTED');
  } finally {
    if (socks) await socks.close();
    if (target) await target.close();
    await tls.cleanup();
  }
});
