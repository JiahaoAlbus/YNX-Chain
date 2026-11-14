import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { NativeProtectedControlBridge } from '../acceptance-kit/native-control-bridge.mjs';

// These are DATA controls for the actual bridge and private journal. No Native app or NE runs.
const dispatch = 'P05_PROTECTED_DISPATCH_EVENT_V1', consumer = 'P05_PROTECTED_ACCEPTANCE_EVENT_V1';
const hash = 'a'.repeat(64);
const uuid = n => `10000000-0000-0000-0000-00000000000${n}`;
const binding = {
  consumer: 'BrowserRouteProtection', mode: 'tor', runID: 'terminal-binding', rootPID: String(process.pid),
  epoch: uuid(1), providerGeneration: uuid(2), rootAuditTokenSHA256: hash,
  executableSHA256: hash, manifestSHA256: hash, bootstrapSHA256: hash,
};
const row = (kind, time, fields = {}, schema = dispatch) =>
  ({ ...binding, kind, schema, atMonotonicNanoseconds: String(time), ...fields });

async function withCommand(t, operation, resultRows, action) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'p05-terminal-bind-')));
  t.after(() => rm(dir, { recursive: true }));
  const commandFile = join(dir, 'command.json'), eventFile = join(dir, 'events.jsonl');
  await writeFile(commandFile, JSON.stringify({ schema: 'P05_PROTECTED_ACCEPTANCE_COMMAND_V1',
    runID: binding.runID, sequence: 1, operation: 'open' }), { mode: 0o600 });
  await writeFile(eventFile, JSON.stringify(row('consumer-attached', 10, {}, consumer)) + '\n', { mode: 0o600 });
  const bridge = new NativeProtectedControlBridge({ commandFile, eventFile, mode: binding.mode, runID: binding.runID,
    expectedRootPID: process.pid, expectedExecutableSHA256: hash, manifestSHA256: hash, timeoutMilliseconds: 750 });
  await bridge.binding();
  let stopped = false;
  const writer = (async () => {
    while (!stopped) {
      const bytes = await readFile(commandFile);
      const command = JSON.parse(bytes);
      if (command.sequence !== 2) { await pause(5); continue; }
      assert.equal(command.operation, operation);
      const commandSHA256 = createHash('sha256').update(bytes).digest('hex');
      const accepted = row('command-accepted', 20, { operation, commandSHA256, sequence: '2' });
      const records = resultRows(accepted, commandSHA256);
      await appendFile(eventFile, records.map(record => JSON.stringify(record) + '\n').join(''));
      return;
    }
  })();
  try { await action(bridge, commandFile); }
  finally { stopped = true; await writer; }
}

const refused = (fields = {}) => row('phase-refused', 21, { phase: 'fault-retry', ...fields }, consumer);
const terminal = (fields = {}) => row('finished', 22, { targetVerdict: 'INCOMPLETE', productionRouteAdmission: 'false', ...fields });

test('fault retry requires refusal by the current consumer and the exact dispatcher command', async t => {
  for (const [name, change] of [
    ['old dispatcher epoch', (accepted, phase, dispatchRefusal) => [accepted, phase, { ...dispatchRefusal, epoch: uuid(3) }]],
    ['wrong command digest', (accepted, phase, dispatchRefusal) => [accepted, phase, { ...dispatchRefusal, commandSHA256: hash }]],
    ['old consumer generation', (accepted, phase, dispatchRefusal) => [accepted, { ...phase, providerGeneration: uuid(4) }, dispatchRefusal]],
    ['pre-acceptance consumer clock', (accepted, phase, dispatchRefusal) => [accepted, { ...phase, atMonotonicNanoseconds: '19' }, dispatchRefusal]],
    ['missing consumer refusal', (accepted, phase, dispatchRefusal) => [accepted, dispatchRefusal]],
  ]) {
    await t.test(name, child => withCommand(child, 'fault-retry', (accepted, commandSHA256) =>
      change(accepted, refused(), row('fault-retry-refused', 22, { commandSHA256 })), async (bridge, commandFile) => {
      await assert.rejects(bridge.explicitPhase('fault-retry'), /Native .*refusal/);
      await assert.rejects(bridge.command('close'), /UNKNOWN/);
      assert.equal(JSON.parse(await readFile(commandFile)).operation, 'fault-retry');
    }));
  }
  await t.test('current ordered two-layer refusal', child => withCommand(child, 'fault-retry', (accepted, commandSHA256) =>
    [accepted, refused(), row('fault-retry-refused', 22, { commandSHA256 })], async bridge => {
    assert.equal((await bridge.explicitPhase('fault-retry')).kind, 'fault-retry-refused');
  }));
});

test('finish requires the current terminal receipt after exact command acceptance', async t => {
  for (const [name, change] of [
    ['old dispatcher epoch', accepted => [accepted, terminal({ epoch: uuid(3) })]],
    ['older receipt', accepted => [accepted, terminal({ atMonotonicNanoseconds: '19' })]],
    ['before command acceptance', accepted => [terminal(), accepted]],
    ['wrong accepted Root', accepted => [{ ...accepted, rootAuditTokenSHA256: 'b'.repeat(64) }, terminal()]],
    ['unexpected success marker', accepted => [accepted, terminal({ targetVerdict: 'PASS', productionRouteAdmission: 'true' })]],
  ]) {
    await t.test(name, child => withCommand(child, 'finish', change, async (bridge, commandFile) => {
      await assert.rejects(bridge.finishEvidence(), /Native .*finish/);
      await assert.rejects(bridge.command('close'), /UNKNOWN/);
      assert.equal(JSON.parse(await readFile(commandFile)).operation, 'finish');
    }));
  }
  await t.test('current terminal receipt retains incomplete evidence and prevents reuse', child =>
    withCommand(child, 'finish', accepted => [accepted, terminal()], async (bridge, commandFile) => {
      const evidence = await bridge.finishEvidence();
      assert.equal(evidence.targetVerdict, 'INCOMPLETE');
      assert.equal(evidence.productionRouteAdmission, false);
      assert.equal(evidence.actualOSCrashIsolation, 'NOT_RUN');
      await assert.rejects(bridge.finishEvidence(), /closed/);
      assert.equal(JSON.parse(await readFile(commandFile)).sequence, 2);
    }));
});

test('protected terminal evidence refuses to certify DNS or STUN without same-run independent observations', async t => {
  for (const [name, fields] of [
    ['missing observations', {}],
    ['native-only claims cannot supply independent observations', {
      independentNetworkCoverage: {
        dns: 'PASS', stunIPv4: 'PASS', stunIPv6: 'PASS', kernelFlowCutoff: 'PASS',
      },
    }],
  ]) {
    await t.test(name, child => withCommand(child, 'finish', accepted => [accepted, terminal(fields)], async (bridge, commandFile) => {
      const evidence = await bridge.finishEvidence();
      assert.equal(evidence.targetVerdict, 'INCOMPLETE');
      assert.equal(evidence.productionRouteAdmission, false);
      assert.deepEqual(evidence.independentNetworkCoverage, {
        dns: 'NOT_SUPPLIED', stunIPv4: 'NOT_SUPPLIED', stunIPv6: 'NOT_SUPPLIED', kernelFlowCutoff: 'NOT_TESTED',
      });
      assert.equal(JSON.parse(await readFile(commandFile)).operation, 'finish');
      await assert.rejects(bridge.command('user-retry'), /closed/);
    }));
  }
});
