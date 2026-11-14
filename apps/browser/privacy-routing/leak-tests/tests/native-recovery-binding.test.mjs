import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { NativeProtectedControlBridge } from '../acceptance-kit/native-control-bridge.mjs';

// File transport and event attribution controls only. No Native app, sockets or NE.
const hash = 'a'.repeat(64);
const dispatch = 'P05_PROTECTED_DISPATCH_EVENT_V1', consumer = 'P05_PROTECTED_ACCEPTANCE_EVENT_V1';
const uuid = number => '10000000-0000-0000-0000-00000000000' + number;
const original = { consumer: 'BrowserRouteProtection', mode: 'tor', runID: 'recovery-binding', rootPID: String(process.pid),
  epoch: uuid(1), providerGeneration: uuid(2), rootAuditTokenSHA256: hash, executableSHA256: hash,
  manifestSHA256: hash, bootstrapSHA256: hash };
const successor = { ...original, epoch: uuid(3) };
const row = (binding, kind, time, fields = {}, schema = dispatch) =>
  ({ ...binding, kind, schema, atMonotonicNanoseconds: String(time), ...fields });

function responses(operation, sha, mutation) {
  if (operation === 'close') {
    return [row(original, 'whole-window-closed', mutation === 'stale-close' ? 9 : 11, {
      closedEpoch: original.epoch, remoteState: 'closed-deny-only', localWebViewRetained: 'false',
      ownedChildrenReaped: 'true', ownedHelpersCleanupConfirmed: mutation === 'missing-helper' ? undefined : 'true',
      osCrashNoLeakProof: 'NOT_RUN',
      ...(mutation === 'old-provider' ? { providerGeneration: uuid(4) } : {}),
      ...(mutation === 'old-root' ? { rootAuditTokenSHA256: 'b'.repeat(64) } : {}),
    })];
  }
  if (operation === 'rebuild-quiet') {
    const next = { ...successor, ...(mutation === 'new-provider' ? { providerGeneration: uuid(4) } : {}) };
    const attached = row(next, 'consumer-attached', 21, {}, consumer);
    const quiet = row(next, 'route-rebuilt-quiet', 22, {
      targetDispatchState: 'idle-no-phase', controlState: 'connected', noAutomaticRequest: 'true',
      ...(mutation === 'wrong-rebuilt-epoch' ? { epoch: original.epoch } : {}),
    });
    if (mutation === 'changed-bootstrap') attached.bootstrapSHA256 = quiet.bootstrapSHA256 = 'c'.repeat(64);
    return mutation === 'reversed-quiet' ? [quiet, attached] : [attached, quiet];
  }
  if (operation === 'request-user-retry') {
    return [row(successor, 'explicit-request-acknowledged', 31, {
      actionReceiptSHA256: mutation === 'wrong-user-command' ? hash : sha,
      humanClickClaimed: 'false', targetRequestDispatched: 'false',
    })];
  }
  if (operation === 'user-retry') {
    return [row(successor, 'phase-dispatched', 41, {
      phase: 'user-retry', ...(mutation === 'wrong-phase-epoch' ? { epoch: original.epoch } : {}),
    }, consumer), row(successor, 'explicit-user-retry', 42, {
      commandSHA256: mutation === 'wrong-retry-command' ? hash : sha,
      humanClickClaimed: 'false',
    })];
  }
  throw Error('Unplanned fixture command: ' + operation);
}

async function harness(t, mutation) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'p05-recovery-binding-')));
  const commandFile = join(directory, 'command.json'), eventFile = join(directory, 'events.jsonl');
  await writeFile(commandFile, JSON.stringify({ schema: 'P05_PROTECTED_ACCEPTANCE_COMMAND_V1',
    runID: original.runID, sequence: 1, operation: 'open' }), { mode: 0o600 });
  await writeFile(eventFile, JSON.stringify(row(original, 'consumer-attached', 1, {}, consumer)) + '\n', { mode: 0o600 });
  const bridge = new NativeProtectedControlBridge({ commandFile, eventFile, runID: original.runID, mode: original.mode,
    manifestSHA256: original.manifestSHA256, expectedRootPID: process.pid, expectedExecutableSHA256: original.executableSHA256,
    timeoutMilliseconds: 400 });
  await bridge.binding();
  let stopped = false, previous = 1;
  const commands = [];
  const writer = (async () => {
    while (!stopped) {
      const bytes = await readFile(commandFile), command = JSON.parse(bytes);
      if (command.sequence > previous) {
        const { sequence, operation } = command;
        const sha = createHash('sha256').update(bytes).digest('hex');
        const binding = ['request-user-retry', 'user-retry'].includes(operation) ? successor : original;
        const records = [row(binding, 'command-accepted', (sequence - 1) * 10, {
          operation, commandSHA256: sha, sequence: String(sequence),
        }), ...responses(operation, sha, mutation)];
        if (operation === 'user-retry') {
          records.at(-1).actionReceiptSHA256 = mutation === 'wrong-retry-action' ? hash : commands.at(-1).sha;
        }
        commands.push({ sequence, operation, sha });
        await appendFile(eventFile, records.map(record => JSON.stringify(record) + '\n').join(''));
        previous = sequence;
      }
      await pause(5);
    }
  })();
  t.after(async () => { stopped = true; try { await writer; } finally { await rm(directory, { recursive: true }); } });
  return { bridge, commands, commandFile };
}

test('wrong old closure cannot send rebuild', { timeout: 5000 }, async t => {
  for (const mutation of ['old-provider', 'old-root', 'missing-helper', 'stale-close']) {
    await t.test(mutation, async child => {
      const { bridge, commands, commandFile } = await harness(child, mutation);
      await assert.rejects(bridge.rebuildOriginalRouteQuiet(), /Native .*closure|readback timeout/);
      assert.deepEqual(commands.map(value => value.operation), ['close']);
      await assert.rejects(bridge.explicitUserRequest(), /UNKNOWN/);
      assert.equal(JSON.parse(await readFile(commandFile)).operation, 'close');
    });
  }
});

test('rebuild requires ordered attachment, fixed inputs and the same provider generation', { timeout: 5000 }, async t => {
  for (const mutation of ['new-provider', 'wrong-rebuilt-epoch', 'changed-bootstrap', 'reversed-quiet']) {
    await t.test(mutation, async child => {
      const { bridge, commands, commandFile } = await harness(child, mutation);
      await assert.rejects(bridge.rebuildOriginalRouteQuiet(), /Native .*rebuild|readback timeout/);
      assert.deepEqual(commands.map(value => value.operation), ['close', 'rebuild-quiet']);
      await assert.rejects(bridge.explicitUserRequest(), /UNKNOWN/);
      assert.equal(JSON.parse(await readFile(commandFile)).operation, 'rebuild-quiet');
    });
  }
});

test('an unrelated digest cannot acknowledge this explicit user request', async t => {
  const { bridge, commands, commandFile } = await harness(t, 'wrong-user-command');
  await bridge.rebuildOriginalRouteQuiet();
  await assert.rejects(bridge.explicitUserRequest(), /Native .*request|readback timeout/);
  await assert.rejects(bridge.explicitPhase('user-retry'), /UNKNOWN/);
  assert.deepEqual(commands.map(value => value.operation), ['close', 'rebuild-quiet', 'request-user-retry']);
  assert.equal(JSON.parse(await readFile(commandFile)).operation, 'request-user-retry');
});

test('the exact old closure, new attachment, quiet rebuild and command digest are accepted in order', async t => {
  const { bridge, commands } = await harness(t);
  const rebuilt = await bridge.rebuildOriginalRouteQuiet();
  assert.equal(rebuilt.epoch, successor.epoch);
  assert.equal(rebuilt.providerGeneration, original.providerGeneration);
  const explicit = await bridge.explicitUserRequest();
  assert.equal(explicit.actionReceiptSHA256, commands.at(-1).sha);
  assert.equal(explicit.humanClickClaimed, false);
  const retried = await bridge.explicitPhase('user-retry');
  assert.equal(retried.kind, 'phase-dispatched');
  assert.equal(retried.epoch, successor.epoch);
  assert.deepEqual(commands.map(value => value.operation), ['close', 'rebuild-quiet', 'request-user-retry', 'user-retry']);
});

test('user retry evidence requires the exact new phase and both command digests', { timeout: 5000 }, async t => {
  for (const mutation of ['wrong-phase-epoch', 'wrong-retry-command', 'wrong-retry-action']) {
    await t.test(mutation, async child => {
      const { bridge, commands } = await harness(child, mutation);
      await bridge.rebuildOriginalRouteQuiet();
      await bridge.explicitUserRequest();
      await assert.rejects(bridge.explicitPhase('user-retry'), /Native .*retry|readback timeout/);
      await assert.rejects(bridge.explicitPhase('user-retry'), /UNKNOWN/);
      assert.deepEqual(commands.map(value => value.operation), ['close', 'rebuild-quiet', 'request-user-retry', 'user-retry']);
    });
  }
});
