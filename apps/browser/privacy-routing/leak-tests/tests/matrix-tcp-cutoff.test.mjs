import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { recordMatrixTargetObservations } from '../platform-matrix-runner.mjs';
import { startScopedSocksFixture } from '../scoped-socks-fixture.mjs';
import { startSyntheticEndpoints } from '../synthetic-endpoints.mjs';
import { createTemporaryTLS } from '../temporary-tls.mjs';

// Only owned loopback sockets. This does not identify the process responsible for a flow.
async function sampleAccept(target, endpoint) {
  const cursor = target.records.length;
  const client = net.connect(endpoint.port, endpoint.host);
  const deadline = AbortSignal.timeout(1500);
  try {
    await once(client, 'connect', { signal: deadline });
    while (!deadline.aborted) {
      const accepted = target.records.slice(cursor).find(row => row.kind === 'tcp-accepted' &&
        row.peerPort === client.localPort && row.localPort === endpoint.port);
      if (accepted) return accepted;
      await pause(5, undefined, { signal: deadline });
    }
    throw new Error('Owned target TCP accept missing');
  } finally {
    const closed = once(client, 'close').catch(() => {});
    client.destroy();
    await closed;
  }
}

test('owned TCP arrivals cross the cutoff by journal position and exact fixture endpoint', { timeout: 10000 }, async t => {
  const tls = await createTemporaryTLS();
  let target, socks;
  try {
    target = await startSyntheticEndpoints({ tls, runID: 'matrix-tcp-cutoff' });
    const { manifest } = target;
    socks = await startScopedSocksFixture({ hostname: manifest.hostname, targetPort: manifest.https.port });
    const route = socks.endpoint;
    const baseline = await sampleAccept(target, manifest.https);
    const targetCursor = target.records.length;
    const faultAt = Date.now();
    await socks.close();
    socks = null;
    const probe = net.connect(route.port, route.host);
    try { await assert.rejects(once(probe, 'connect', { signal: AbortSignal.timeout(1500) }), { code: 'ECONNREFUSED' }); }
    finally { probe.destroy(); }
    const arrivals = [await sampleAccept(target, manifest.https)];
    if (manifest.ipv6.status === 'LISTENING') arrivals.push(await sampleAccept(target, manifest.ipv6.https));
    else await t.test('IPv6 loopback unavailable', { skip: true }, () => {});

    // Reuse actual accept records with injected clock values to make both timestamp boundary
    // cases deterministic without modifying the host clock.
    const observed = (records, direct = false, cut = targetCursor) => {
      const result = { targetRecords: records, socksRecords: [], publicRecords: [], targetCursor: cut, faultAt,
        targetVerdict: 'INCOMPLETE' };
      recordMatrixTargetObservations(result, { manifest, direct });
      return result;
    };
    await t.test('equal and earlier wall times on new accepts are still post-cutoff', () => {
      for (const at of [faultAt, faultAt - 1000]) {
        const rows = target.records.map(row => arrivals.includes(row) ? { ...row, at } : row);
        const result = observed(rows);
        assert.deepEqual(result.afterFaultTargetTCP.map(row => row.sequence), arrivals.map(row => row.sequence));
        assert.equal(result.targetVerdict, 'FAIL');
        assert.equal(observed(rows, true).targetVerdict, 'INCOMPLETE');
      }
    });
    await t.test('an old accept does not cross the cutoff even if its clock reads later', () => {
      const rows = target.records.slice(0, targetCursor).map(row => row === baseline ? { ...row, at: faultAt + 1000 } : row);
      const result = observed(rows);
      assert.deepEqual(result.afterFaultTargetTCP, []);
      assert.equal(result.targetVerdict, 'INCOMPLETE');
    });
    await t.test('foreign run, listener and family cannot be reported as the owned post-cutoff accept', () => {
      for (const fields of [{ runID: 'foreign-run' }, { localPort: manifest.dns.port },
        { hostname: 'foreign-run.leak.test' }, { protocol: 'udp' }, { actor: 'foreign' },
        { addressFamily: 'unknown' }]) {
        const result = observed([...target.records.slice(0, targetCursor), { ...arrivals[0], ...fields, at: faultAt + 1000 }]);
        assert.deepEqual(result.afterFaultTargetTCP, []);
        assert.equal(result.targetVerdict, 'INCOMPLETE');
      }
    });
  } finally {
    if (socks) await socks.close();
    if (target) await target.close();
    await tls.cleanup();
  }
});
