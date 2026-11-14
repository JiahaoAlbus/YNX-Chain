import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, appendFile, chmod, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeProtectedControlBridge } from '../acceptance-kit/native-control-bridge.mjs';

// Transport fixtures ONLY. These JSON files are never NE/WK/readiness or route-PASS evidence.
const hash = 'a'.repeat(64), uuid = '10000000-0000-0000-0000-000000000001';
async function inputs() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'ynx-native-control-'))); await chmod(directory, 0o700);
  const commandFile = join(directory, 'command.json'), eventFile = join(directory, 'events.jsonl');
  await writeFile(commandFile, JSON.stringify({ schema: 'P05_PROTECTED_ACCEPTANCE_COMMAND_V1', runID: 'transport-fixture', sequence: 1, operation: 'open' }) + '\n', { mode: 0o600 });
  const record = { schema: 'P05_PROTECTED_ACCEPTANCE_EVENT_V1', consumer: 'BrowserRouteProtection', kind: 'consumer-attached', mode: 'tor', runID: 'transport-fixture', epoch: uuid, providerGeneration: uuid, rootPID: String(process.pid), rootAuditTokenSHA256: hash, executableSHA256: hash, manifestSHA256: hash, bootstrapSHA256: hash };
  await writeFile(eventFile, JSON.stringify(record) + '\n', { mode: 0o600 });
  const options = { commandFile, eventFile, runID: 'transport-fixture', mode: 'tor', manifestSHA256: hash, expectedRootPID: process.pid, expectedExecutableSHA256: hash, timeoutMilliseconds: 150 };
  return { directory, options, record };
}
test('native file bridge sends one bound real file command and requires matching readback', async () => {
  const value = await inputs();
  try {
    const bridge = new NativeProtectedControlBridge(value.options); assert.equal((await bridge.binding()).rootPID, process.pid);
    let watching = true, seen;
    const observer = (async () => {
      while (watching) {
        const raw = await readFile(value.options.commandFile, 'utf8'); const command = JSON.parse(raw);
        if (command.sequence === 2) {
          seen = command;
          const { createHash } = await import('node:crypto');
          await appendFile(value.options.eventFile, JSON.stringify({ schema: 'P05_PROTECTED_DISPATCH_EVENT_V1', runID: value.record.runID, kind: 'command-accepted', commandSHA256: createHash('sha256').update(raw).digest('hex'), sequence: '2' }) + '\n');
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    })();
    const command = await bridge.command('baseline'); watching = false; await observer;
    assert.equal(command.sequence, 2); assert.equal(seen.operation, 'baseline'); assert.equal(seen.runID, 'transport-fixture');
    assert.equal(JSON.parse(await readFile(value.options.commandFile, 'utf8')).sequence, 2);
  } finally { await rm(value.directory, { recursive: true }); }
});
test('native bridge preserves UNKNOWN after timeout and never sends the next mutation', async () => {
  const value = await inputs();
  try {
    const bridge = new NativeProtectedControlBridge(value.options); await bridge.binding();
    await assert.rejects(bridge.command('route-loss'), error => error.commandEffect?.state === 'UNKNOWN-no-automatic-retry');
    const before = await readFile(value.options.commandFile, 'utf8');
    await assert.rejects(bridge.command('route-loss'), /UNKNOWN/);
    assert.equal(await readFile(value.options.commandFile, 'utf8'), before);
  } finally { await rm(value.directory, { recursive: true }); }
});
test('native bridge rejects wrong process and nonprivate/symlink event sources', async () => {
  const value = await inputs();
  try {
    await assert.rejects(new NativeProtectedControlBridge({ ...value.options, expectedRootPID: process.pid + 1 }).binding(), /process/);
    await chmod(value.options.eventFile, 0o644);
    await assert.rejects(new NativeProtectedControlBridge(value.options).binding(), /owner-only/);
    await chmod(value.options.eventFile, 0o600);
    const link = join(value.directory, 'linked.jsonl'); await symlink(value.options.eventFile, link);
    await assert.rejects(new NativeProtectedControlBridge({ ...value.options, eventFile: link }).binding(), /Canonical/);
  } finally { await rm(value.directory, { recursive: true }); }
});
