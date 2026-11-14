import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import vm from 'node:vm';
import { NativeProtectedControlBridge } from '../acceptance-kit/native-control-bridge.mjs';
import { buildInFlightAcceptanceBootstrap } from '../acceptance-kit/bootstrap.mjs';

// Owned file transport and bootstrap sequencing controls. No WebKit, GUI or NE.
const dispatch = 'P05_PROTECTED_DISPATCH_EVENT_V1', consumer = 'P05_PROTECTED_ACCEPTANCE_EVENT_V1';
const hash = 'a'.repeat(64), nonce = 'd'.repeat(32);
const uuid = number => '10000000-0000-0000-0000-00000000000' + number;
const binding = { consumer: 'BrowserRouteProtection', mode: 'tor', runID: 'inflight-binding', rootPID: String(process.pid),
  epoch: uuid(1), providerGeneration: uuid(2), rootAuditTokenSHA256: hash, executableSHA256: hash,
  manifestSHA256: hash, bootstrapSHA256: hash };
const row = (kind, time, fields = {}, schema = consumer) =>
  ({ ...binding, kind, schema, atMonotonicNanoseconds: String(time), ...fields });
const download = uuid(3);
const frame = (frameSequence, time, details = {}) => row('instrument', time, {
  phase: 'baseline', probeID: 'baseline-long-wss', messageKind: 'wss', status: 'body-match',
  frameSequence: String(frameSequence), sha256: hash, ...details,
});
const accepted = row('download-accepted', 14, { downloadID: download, committed: 'false' });
const destination = row('download-destination', 15, { downloadID: download, committed: 'false', generation: '1' });
const progress = row('download-progress', 16, { downloadID: download, committed: 'false', bytes: '16384' });
const options = { wssMinimumFrames: 2, downloadMinimumBytes: 16384, downloadMustBeUncommitted: true };

async function fileBridge(t, records) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'p05-inflight-binding-')));
  const commandFile = join(directory, 'command.json'), eventFile = join(directory, 'events.jsonl');
  await writeFile(commandFile, JSON.stringify({ schema: 'P05_PROTECTED_ACCEPTANCE_COMMAND_V1',
    runID: binding.runID, sequence: 1, operation: 'open' }), { mode: 0o600 });
  await writeFile(eventFile, JSON.stringify(row('consumer-attached', 1)) + '\n', { mode: 0o600 });
  const bridge = new NativeProtectedControlBridge({ commandFile, eventFile, runID: binding.runID, mode: binding.mode,
    manifestSHA256: hash, expectedRootPID: process.pid, expectedExecutableSHA256: hash, timeoutMilliseconds: 180 });
  await bridge.binding();
  let stopping = false;
  const writer = (async () => {
    while (!stopping) {
      const bytes = await readFile(commandFile), command = JSON.parse(bytes);
      if (command.sequence === 2) {
        const rows = [
          row('command-accepted', 10, { operation: 'baseline', commandSHA256: createHash('sha256').update(bytes).digest('hex'), sequence: '2' }, dispatch),
          row('instrument', 11, { phase: 'baseline', messageKind: 'phase-started' }),
          ...records,
          row('phase-dispatched', 20, { phase: 'baseline' }),
        ];
        await appendFile(eventFile, rows.map(value => JSON.stringify(value) + '\n').join(''));
        return;
      }
      await pause(5);
    }
  })();
  t.after(async () => { stopping = true; try { await writer; } finally { await rm(directory, { recursive: true }); } });
  return { bridge, commandFile };
}

test('a live baseline requires distinct matching frames and the same unfinished download', { timeout: 5000 }, async t => {
  const wss = [frame(2, 12), frame(1, 13)]; // Promise completion order may differ from receive order.
  const downloadRows = [accepted, destination, progress];
  const negatives = {
    'closed websocket': [...wss, ...downloadRows, frame(2, 17, { status: 'closed' })],
    'mismatched websocket body': [frame(1, 12), frame(2, 13, { status: 'body-mismatch' }), ...downloadRows],
    'duplicate websocket sequence': [frame(2, 12), frame(2, 13), ...downloadRows],
    'foreign websocket epoch': [frame(1, 12), frame(2, 13, { epoch: uuid(4) }), ...downloadRows],
    'websocket before command': [frame(1, 8), frame(2, 9), ...downloadRows],
    'progress before destination': [...wss, accepted, progress, { ...destination, atMonotonicNanoseconds: '17' }],
    'foreign destination': [...wss, accepted, { ...destination, downloadID: uuid(4) }, progress],
    'progress already committed': [...wss, accepted, destination, { ...progress, committed: 'true' }],
  };
  for (const [name, records] of Object.entries(negatives)) {
    await t.test(name, async child => {
      const { bridge, commandFile } = await fileBridge(child, records);
      await bridge.explicitPhase('baseline');
      await assert.rejects(bridge.waitForInFlight(options), /readback timeout/);
      await assert.rejects(bridge.applyReviewedFault('route-loss'), /UNKNOWN/);
      assert.equal(JSON.parse(await readFile(commandFile)).operation, 'baseline');
    });
  }
  await t.test('matching reordered frames and valid progress', async child => {
    const { bridge } = await fileBridge(child, [...wss, ...downloadRows]);
    await bridge.explicitPhase('baseline');
    assert.deepEqual(await bridge.waitForInFlight(options),
      { wssFrames: 2, downloadBytes: 16384, downloadCommitted: false, downloadID: download });
  });
});

test('real bootstrap attaches receive sequence before asynchronous digest', async () => {
  const prefix = '/ynx-route-probe/' + binding.runID;
  const origins = ['https://a.example.test', 'https://b.example.test'];
  const built = buildInFlightAcceptanceBootstrap({
    schema: 'P05_PUBLIC_NONCE_FIXTURE_V1', runID: binding.runID, origins,
    publicFixture: { nonce: binding.runID },
    paths: { proof: prefix + '/proof', download: prefix + '/download', wss: prefix + '/wss' },
    expectedSHA256: { proof: hash, download: hash, wss: hash },
    acceptance: {
      schema: 'P05_INFLIGHT_ACCEPTANCE_FLOWS_V1', wss: { contentNonce: nonce },
      paths: { streamDownload: prefix + '/stream-download', longWss: prefix + '/long-wss',
        sameOriginRedirect: prefix + '/redirect-same', crossOriginRedirect: prefix + '/redirect-cross', downgradeRedirect: prefix + '/redirect-http' },
    },
  }, { stun4: { host: '127.0.0.1', port: 13500 }, stun6: { host: '::1', port: 13501 } });
  const messages = [], websockets = [], pending = [];
  const window = { webkit: { messageHandlers: { p05Acceptance: { postMessage: value => messages.push(value) } } } };
  vm.runInNewContext(built.html.split('<script>')[1].split('</script>')[0], {
    window, TextEncoder, Uint8Array,
    WebSocket: class { constructor() { websockets.push(this); } },
    document: { createElement: () => ({ click() {} }), body: { append() {} } },
    fetch: async () => { throw Error('No socket opened by control'); },
    crypto: { subtle: { digest: () => new Promise(resolve => pending.push(resolve)) } },
  });
  window.__p05Acceptance.begin('baseline');
  const [socket] = websockets;
  const first = socket.onmessage({ data: binding.runID + ':baseline-long-wss:1:' + nonce });
  const second = socket.onmessage({ data: binding.runID + ':baseline-long-wss:2:' + nonce });
  pending[1](new Uint8Array(32)); await second;
  pending[0](new Uint8Array(32)); await first;
  assert.deepEqual(messages.filter(value => value.kind === 'wss').map(value => [value.frameSequence, value.status]),
    [[2, 'body-match'], [1, 'body-match']]);
});
