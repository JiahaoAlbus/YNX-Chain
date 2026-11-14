import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOwnedScope, parseProcessTable, parseLsofFields, identifyWebKitRoles, observeDedicatedClient, classifyScopedSockets } from '../scoped-collector.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runOwnedFaultPlan } from '../owned-fault-runner.mjs';

test('scope uses exact root executable and OS ancestry, never all WebKit processes', () => {
  const table = parseProcessTable('100 1 /test/Browser\n101 100 /test/WebContent\n102 101 /test/Network\n200 1 /unrelated/WebContent');
  assert.deepEqual(deriveOwnedScope(table, 100, '/test/Browser').map(row => row.pid), [100, 101, 102]);
  assert.throws(() => deriveOwnedScope(table, 100, '/different/Browser'));
  assert.throws(() => parseLsofFields('p200\0f1\0PTCP\0n127.0.0.1:3->127.0.0.1:4\0', deriveOwnedScope(table, 100, '/test/Browser')));
});

test('UDP on the same number as a TCP route-entry port is not silently treated as routed', () => {
  const [socket] = classifyScopedSockets([{ protocol: 'udp', remote: { host: '127.0.0.1', port: 19050 } }], [{ host: '127.0.0.1', port: 19050 }], []);
  assert.equal(socket.destinationClass, 'outside-synthetic-allowlist'); assert.deepEqual(socket.remote, { redacted: true });
});

test('native WebKit roles require both exact system executable and owned ancestry; a synthetic flag is not silently inferred', async () => {
  const prefix = '/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/';
  const table = [
    { pid: 100, ppid: 1, executable: '/exact/Browser' },
    { pid: 101, ppid: 100, executable: prefix + 'com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking' },
    { pid: 102, ppid: 1, executable: prefix + 'com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent' }
  ];
  const identity = identifyWebKitRoles(deriveOwnedScope(table, 100, '/exact/Browser'), 100);
  assert.ok(identity.attributedRoles.includes('webkit-network')); assert.deepEqual(identity.missing, ['webkit-webcontent']); assert.equal(identity.xpcResponsibilityVerified, false);
  const expectedSHA256 = createHash('sha256').update(await readFile(process.execPath)).digest('hex');
  await assert.rejects(observeDedicatedClient({ rootPID: process.pid, executable: process.execPath, expectedSHA256, runID: 'not-launched-synthetically', samples: 1, routeEndpoints: [], syntheticTargets: [] }), /startup marker is absent/);
});

test('real owned helpers provide OS socket correlation and all four bounded process/link faults; real direct negative is detected', { timeout: 30000, skip: process.platform !== 'darwin' }, async () => {
  const result = await runOwnedFaultPlan({ injectDirectNegative: true });
  assert.equal(result.observedHelperContract, true);
  assert.equal(result.negativeDetected, true);
  assert.equal(result.targetVerdict, 'INCOMPLETE'); assert.equal(result.opensRouteMode, false); assert.equal(result.testsRealWebKit, false);
  assert.equal(result.rawCapture.bytesRead, 0); assert.equal(result.rawCapture.rawCaptureStarted, false);
  assert.equal(result.scenarios.find(value => value.scenario === 'killroute').fault.effect.signal, 'SIGTERM');
  assert.equal(result.scenarios.find(value => value.scenario === 'crash').fault.effect.signal, 'SIGKILL');
  assert.match(result.scenarios.find(value => value.scenario === 'sleepwake').fault.effect.observedState, /T/);
  for (const scenario of result.scenarios.filter(value => value.scenario !== 'baseline')) {
    assert.equal(scenario.postFaultProbe.dispatched, false); assert.equal(scenario.targetReceiptsAfterBlockedProbe, 0);
  }
});
