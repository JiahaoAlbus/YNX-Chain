import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import dgram from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { once } from 'node:events';
import { appendFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { NativeProtectedControlBridge } from '../acceptance-kit/native-control-bridge.mjs';
import { driveInFlightFault } from '../acceptance-kit/fault-sequence.mjs';
import { startSyntheticEndpoints } from '../synthetic-endpoints.mjs';
import { createTemporaryTLS } from '../temporary-tls.mjs';

// Journal checks use fixture DATA. The ingress delta additionally starts owned loopback targets.
const runID = 'cutoff-delta', hash = 'a'.repeat(64);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const binding = { consumer: 'BrowserRouteProtection', mode: 'tor', runID, rootPID: String(process.pid),
  epoch: '10000000-0000-0000-0000-000000000001', providerGeneration: '10000000-0000-0000-0000-000000000002',
  rootAuditTokenSHA256: hash, executableSHA256: hash, manifestSHA256: hash, bootstrapSHA256: hash };
const nativeRow = (kind, time, fields = {}, schema = 'P05_PROTECTED_DISPATCH_EVENT_V1') =>
  ({ ...binding, schema, kind, atMonotonicNanoseconds: time, ...fields });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fileBridge(t, afterAccept) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'p05-native-cutoff-')));
  t.after(() => rm(directory, { recursive: true }));
  const commandFile = join(directory, 'command.json'), eventFile = join(directory, 'events.jsonl');
  await writeFile(commandFile, JSON.stringify({ schema: 'P05_PROTECTED_ACCEPTANCE_COMMAND_V1', runID, sequence: 1, operation: 'open' }), { mode: 0o600 });
  await writeFile(eventFile, JSON.stringify(nativeRow('consumer-attached', '99', {}, 'P05_PROTECTED_ACCEPTANCE_EVENT_V1')) + '\n', { mode: 0o600 });
  const bridge = new NativeProtectedControlBridge({ commandFile, eventFile, runID, mode: binding.mode,
    manifestSHA256: hash, expectedRootPID: process.pid, expectedExecutableSHA256: hash, timeoutMilliseconds: 750 });
  await bridge.binding();
  const append = row => appendFile(eventFile, JSON.stringify(row) + '\n');
  let stopped = false;
  const writer = (async () => {
    while (!stopped) {
      const raw = await readFile(commandFile), command = JSON.parse(raw);
      if (command.sequence === 2) {
        const commandSHA256 = sha(raw);
        await append(nativeRow('command-accepted', '100', { sequence: '2', operation: command.operation, commandSHA256 }));
        await afterAccept(append, commandSHA256, command.operation);
        return;
      }
      await pause(5);
    }
  })();
  return { bridge, commandFile, eventFile, async join() { stopped = true; await writer; } };
}
async function routeRows(append, commandSHA256, mutation) {
  const proof = JSON.stringify({ rootBinding: binding, commandSHA256, ownedExits: [
    { pid: '500', code: '0', signal: 'none', childReaped: 'true', preparedPinSHA256: hash,
      cleanupChildPID: mutation === 'wrong-pid' ? '501' : '500', helperCleanupConfirmed: 'true' },
  ] });
  if (mutation !== 'missing-intent') await append(nativeRow('fault-commit-intent', '101', {
    fault: 'route-loss', commandSHA256, commitIntentSHA256: hash, faultApplied: 'false',
  }));
  await append(nativeRow('blocked', mutation === 'stale-block' ? '100' : '102', {
    nativeWebViewRemoved: 'true',
    ...(mutation === 'foreign-block' ? { providerGeneration: binding.epoch } : {}),
  }, 'P05_PROTECTED_ACCEPTANCE_EVENT_V1'));
  // The real callback can block the page before the gate reports physical reap.
  await pause(55);
  await append(nativeRow('fault-action-returned', '103', { fault: 'route-loss', commandSHA256,
    effectState: 'requires-closure-readback', actionReceiptSHA256: sha(proof), ownedExitReceiptJSON: proof }));
  await append(nativeRow('fault-applied-observed', '104', { fault: 'route-loss',
    observation: 'owned-children-reaped-and-native-blocked', osPacketDrop: 'NOT_OBSERVED' }));
}

test('real journal bridge binds Native commit-intent and accepts block before reap readback', async t => {
  const { bridge, join } = await fileBridge(t, routeRows);
  try {
    const action = await bridge.applyReviewedFault('route-loss');
    const blocked = await bridge.waitForBlocked();
    assert.equal(action.atMonotonicNanoseconds, '101');
    assert.equal(blocked.atMonotonicNanoseconds, '102');
    assert.ok(action.at <= blocked.at);
    assert.equal(action.ownedExits[0].cleanupChildPID, '500');
  } finally { await join(); }
});

test('native journal rejects missing intent, stale or foreign block, and wrong physical PID before retry', async t => {
  for (const mutation of ['missing-intent', 'stale-block', 'foreign-block', 'wrong-pid']) {
    await t.test(mutation, async child => {
      const { bridge, join } = await fileBridge(child, (append, commandSHA256) => routeRows(append, commandSHA256, mutation));
      try {
        await assert.rejects(bridge.applyReviewedFault('route-loss'), /Native route-loss/);
        await assert.rejects(bridge.command('fault-retry'), /UNKNOWN/);
      } finally { await join(); }
    });
  }
});

test('accepted fault command retains custody until the physical action and block readback', async t => {
  let writeBlock, unblock;
  const accepted = new Promise(resolve => { writeBlock = resolve; });
  const hold = new Promise(resolve => { unblock = resolve; });
  const { bridge, join, commandFile } = await fileBridge(t, async (append, commandSHA256) => {
    writeBlock();
    await hold;
    await routeRows(append, commandSHA256);
  });
  const fault = bridge.applyReviewedFault('route-loss');
  try {
    await accepted;
    await assert.rejects(bridge.command('fault-retry'), /UNKNOWN/);
    assert.equal(JSON.parse(await readFile(commandFile, 'utf8')).operation, 'route-loss');
  } finally {
    unblock();
    await join();
    await fault;
  }
});

test('private journal accepts partial append and rejects a rewritten complete prefix', async t => {
  const { bridge, join, eventFile } = await fileBridge(t);
  try {
    const row = JSON.stringify(nativeRow('command-accepted', '101'));
    await appendFile(eventFile, row.slice(0, 16));
    assert.equal((await bridge.readEvents()).length, 1);
    await appendFile(eventFile, row.slice(16) + '\n');
    assert.equal((await bridge.readEvents()).length, 2);
    const previous = await readFile(eventFile, 'utf8');
    await writeFile(eventFile, previous.replace('"99"', '"98"'));
    await assert.rejects(bridge.readEvents(), /prefix changed/);
    assert.equal(bridge.records[0].atMonotonicNanoseconds, '99');
  } finally { await join(); }
});

test('private bridge rejects an owner-only FIFO substitution before any journal read', async t => {
  const { join, commandFile, eventFile } = await fileBridge(t);
  await join();
  await rm(eventFile);
  const run = promisify(execFile);
  await run('mkfifo', ['-m', '600', eventFile], { timeout: 2000 });
  const bridgeModule = new URL('../acceptance-kit/native-control-bridge.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { NativeProtectedControlBridge } from ${JSON.stringify(bridgeModule)};
    const bridge = new NativeProtectedControlBridge(${JSON.stringify({ commandFile,
      eventFile, runID, mode: binding.mode, manifestSHA256: hash, expectedRootPID: process.pid, expectedExecutableSHA256: hash })});
    await assert.rejects(bridge.readEvents(), /owner-only/);
  `;
  await run(process.execPath, ['--input-type=module', '--eval', script], { timeout: 2000 });
});

function scenario(violation, cleanupUnknown = false, { ownedEndpoints, duringFault, afterRetry } = {}) {
  const records = [], calls = [];
  let now = 10;
  const target = kind => records.push({ kind, at: ++now, probeID: 'fault-retry-https' });
  const bridge = {
    binding: async () => ({ ...binding, rootPID: process.pid }),
    explicitPhase: async phase => {
      calls.push(phase);
      if (phase === 'fault-retry' && violation === 'refusal') target('receipt');
    },
    waitForInFlight: async () => ({ wssFrames: 2, downloadBytes: 16384, downloadCommitted: false }),
    applyReviewedFault: async fault => {
      if (violation === 'fault-in-flight') target('receipt');
      await duringFault?.();
      return { fault, runID, at: ++now, actionReceiptSHA256: hash };
    },
    waitForBlocked: async () => ({ runID, epoch: binding.epoch, state: 'blocked', at: ++now }),
    rebuildOriginalRouteQuiet: async () => {
      calls.push('rebuild');
      return { mode: binding.mode, epoch: binding.providerGeneration, providerGeneration: binding.providerGeneration,
        state: 'connected-no-target-phase', targetDispatchState: 'idle-no-phase', at: ++now };
    },
    explicitUserRequest: async () => {
      calls.push('request');
      if (violation === 'request-ack') target('stream-started');
      return { actionReceiptSHA256: hash };
    },
    finishEvidence: async () => {
      calls.push('finish');
      await afterRetry?.();
      if (violation === 'late') records.push({ kind: 'receipt', at: 14, probeID: 'fault-retry-https' });
      if (violation === 'explicit') records.push({ kind: 'receipt', at: Date.now(), probeID: 'user-retry-https' });
      if (cleanupUnknown) throw Error('original closure unconfirmed');
      return { targetVerdict: 'INCOMPLETE' };
    },
  };
  const fixture = { records, manifest: () => ({ runID }) };
  const run = () => driveInFlightFault({ bridge, fixture, ownedEndpoints, fault: 'route-loss', wait: async () => {
    target(violation === 'quiet' ? 'redirect-issued' : 'wss-frame-sent');
  } });
  return { run, calls };
}

test('owned UDP fault delta flags exact listener arrivals and retains existing phase boundaries', { timeout: 7000 }, async t => {
  const tls = await createTemporaryTLS();
  let endpoints;
  try {
    endpoints = await startSyntheticEndpoints({ tls, runID });
    const { manifest } = endpoints;
    async function query(name) {
      const resolver = new Resolver({ timeout: 600, tries: 1 });
      resolver.setServers([`127.0.0.1:${manifest.dns.port}`]);
      try { return await resolver.resolve4(name); }
      finally { resolver.cancel(); }
    }
    await t.test('genuine DNS arrival during fault stops before the next phase', async () => {
      const { run, calls } = scenario('none', false, {
        ownedEndpoints: endpoints,
        duringFault: async () => assert.deepEqual(await query(manifest.hostname), ['127.0.0.1']),
      });
      const result = await run();
      assert.equal(result.unexpectedTargetReceipts[0].kind, 'dns');
      assert.equal(result.targetVerdict, 'FAIL');
      assert.deepEqual(calls, ['baseline', 'finish']);
      assert.equal(result.productionRouteAdmission, false);
    });
    await t.test('pre-fault DNS and a different name do not become new run-bound evidence', async () => {
      const before = endpoints.records.length;
      const { run, calls } = scenario('none', false, {
        ownedEndpoints: endpoints,
        duringFault: async () => {
          await assert.rejects(query('different-run.leak.test'), { code: 'ETIMEOUT' });
          const dns = endpoints.records[0];
          endpoints.records.push({ ...dns, runID: 'other' }, { ...dns, targetPort: manifest.stun.port }, { ...dns, addressFamily: 'IPv6' });
        },
      });
      const result = await run();
      assert.equal(endpoints.records.length, before + 3); // Only the injected foreign DATA rows.
      assert.equal(result.targetVerdict, 'INCOMPLETE');
      assert.ok(calls.includes('user-retry'));
    });
    await t.test('TCP accept without TLS or HTTP still prevents a subsequent phase', async () => {
      const { run, calls } = scenario('none', false, {
        ownedEndpoints: endpoints,
        duringFault: async () => {
          const socket = net.connect(manifest.https.port, manifest.https.host);
          try {
            await once(socket, 'connect', { signal: AbortSignal.timeout(1000) });
            await new Promise(resolve => setImmediate(resolve));
          } finally { socket.destroy(); }
        },
      });
      const result = await run();
      assert.equal(result.targetVerdict, 'FAIL');
      assert.equal(result.unexpectedTargetReceipts[0].kind, 'tcp-accepted');
      assert.deepEqual(calls, ['baseline', 'finish']);
    });
    await t.test('STUN late in cleanup remains visible even without a page phase identifier', async () => {
      const selected = manifest.ipv6.status === 'LISTENING' ? manifest.ipv6.stun : manifest.stun;
      const ipv6 = selected.host === '::1';
      const { run } = scenario('none', true, {
        ownedEndpoints: endpoints,
        afterRetry: async () => {
          const socket = dgram.createSocket(ipv6 ? 'udp6' : 'udp4');
          try {
            const reply = once(socket, 'message', { signal: AbortSignal.timeout(1000) });
            const request = Buffer.alloc(20, 6);
            request.writeUInt16BE(1, 0); request.writeUInt16BE(0, 2); request.writeUInt32BE(0x2112a442, 4);
            socket.send(request, selected.port, selected.host);
            const [response] = await reply;
            assert.deepEqual(response.subarray(8, 20), request.subarray(8, 20));
          } finally { socket.close(); }
        },
      });
      await assert.rejects(run(), error => error.partialJournal?.targetVerdict === 'FAIL' &&
        error.partialJournal?.unexpectedTargetReceipts.some(row => row.kind === 'receipt' && row.protocol === 'stun' && row.targetHost === selected.host) &&
        error.partialJournal?.cleanupFailure === 'original closure unconfirmed');
    });
  } finally {
    if (endpoints) await endpoints.close();
    await tls.cleanup();
  }
});

test('target receipts before explicit retry close the known run before any additional target phase', async () => {
  for (const [boundary, expected] of [
    ['fault-in-flight', ['baseline', 'finish']],
    ['refusal', ['baseline', 'fault-retry', 'finish']],
    ['quiet', ['baseline', 'fault-retry', 'rebuild', 'finish']],
    ['request-ack', ['baseline', 'fault-retry', 'rebuild', 'request', 'finish']],
  ]) {
    const { run, calls } = scenario(boundary);
    const result = await run();
    assert.deepEqual(calls, expected);
    assert.equal(result.targetVerdict, 'FAIL');
    assert.equal(result.productionRouteAdmission, false);
  }
});

test('target counterexample is retained when the original finish reports UNKNOWN', async () => {
  const { run, calls } = scenario('quiet', true);
  await assert.rejects(run(), error => error.partialJournal?.targetVerdict === 'FAIL' &&
    error.partialJournal?.firstCause === 'Unexpected target request before explicit retry' &&
    error.partialJournal?.cleanupFailure === 'original closure unconfirmed');
  assert.deepEqual(calls, ['baseline', 'fault-retry', 'rebuild', 'finish']);
});

test('queued target writes are not new requests; a quiet run still needs explicit retry', async () => {
  for (const observation of ['none', 'explicit']) {
    const { run, calls } = scenario(observation);
    const result = await run();
    assert.deepEqual(calls, ['baseline', 'fault-retry', 'rebuild', 'request', 'user-retry', 'finish']);
    assert.equal(result.targetVerdict, 'INCOMPLETE');
    assert.equal(result.productionRouteAdmission, false);
  }
});

test('late pre-retry records retain the FAIL and original cleanup failure', async () => {
  const completed = await scenario('late').run();
  assert.equal(completed.targetVerdict, 'FAIL');
  assert.equal(completed.unexpectedTargetReceipts.length, 1);
  await assert.rejects(scenario('late', true).run(), error => error.partialJournal?.targetVerdict === 'FAIL' &&
    error.partialJournal?.unexpectedTargetReceipts.length === 1 &&
    error.partialJournal?.cleanupFailure === 'original closure unconfirmed');
});
