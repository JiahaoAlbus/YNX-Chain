import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const { TestControllerImpl } = require('@theia/plugin-ext/lib/plugin/tests');
const { CancellationTokenSource } = require('@theia/core/lib/common/cancellation');
const { DebugExtImpl } = require('@theia/plugin-ext/lib/plugin/debug/debug-ext');
const { PluginDebugAdapterSession } = require('@theia/plugin-ext/lib/plugin/debug/plugin-debug-adapter-session');
const { ProcessDebugAdapter } = require('@theia/debug/lib/node/stream-debug-adapter');
const { Emitter } = require('@theia/core/lib/common/event');
const { adaptApi } = require('../../ynx-workbench/lib/plugin-vscode-init-adapter');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const notifications = [];
  const proxy = new Proxy({}, { get: (_, name) => (...args) => notifications.push({ name, args }) });
  const nativeDebug = new DebugExtImpl();
  const starts = [];
  nativeDebug.proxy = { $startDebugging(...args) { starts.push(args); return true; } };
  const debug = {
    startDebugging: nativeDebug.startDebugging.bind(nativeDebug),
    registerDebugAdapterTrackerFactory: nativeDebug.registerDebugAdapterTrackerFactory.bind(nativeDebug),
  };
  const api = adaptApi({ CancellationTokenSource, debug, tests: {
    createTestController: () => new TestControllerImpl(() => {}, proxy, 'actual-tests', 'Tests'),
  } });
  const controller = api.tests.createTestController();
  const items = ['pending', 'passed', 'failed', 'skipped', 'queued'].map(id => {
    const item = controller.createTestItem(id, id); controller.items.add(item); return item;
  });
  function run(handler) {
    const profile = controller.createRunProfile('Run', 1, handler, true);
    controller.runTestsForUI(profile.profileId, '', items.map(item => item.path), [], false);
  }
  return { api, nativeDebug, starts, controller, items, notifications, run,
    states: () => notifications.filter(n => n.name === '$notifyTestStateChanged').flatMap(n => n.args[2]),
  };
}
function stateRun(f, request) {
  const run = f.controller.createTestRun(request);
  run.started(f.items[0]); run.passed(f.items[1]);
  run.failed(f.items[2], { message: 'real assertion failed' }); run.skipped(f.items[3]); run.enqueued(f.items[4]);
  return run;
}
test('rejected actual profile ends live run and preserves completed results', async () => {
  const f = fixture(); let run, token;
  f.run(async (request, cancellation) => { token = cancellation; run = stateRun(f, request); throw new Error('adapter crashed'); });
  await tick();
  assert.equal(run.ended, true); assert.equal(token.isCancellationRequested, true); assert.equal(run.token.isCancellationRequested, true);
  assert.equal(f.controller.activeRuns.size, 0);
  assert.deepEqual(f.states().map(s => s.state), [6, 3, 4, 5, 6]);
  assert.equal(f.states()[0].messages[0].message.value, 'adapter crashed');
  assert.equal(f.notifications.filter(n => n.name === '$notifyTestRunEnded').length, 1);
  f.controller.dispose();
});
test('synchronous handler throw cleans a native run and rethrows the original error', () => {
  const f = fixture(); let run; const error = new Error('launch denied');
  assert.throws(() => f.run(request => { run = stateRun(f, request); throw error; }), value => value === error);
  assert.equal(run.ended, true); assert.equal(f.controller.activeRuns.size, 0); f.controller.dispose();
});
test('cancel seals an uncooperative run; late output and state cannot resurrect it', () => {
  const f = fixture(); let run;
  f.run(request => { run = stateRun(f, request); }); f.controller.cancelRun(run.id);
  assert.equal(run.ended, true); assert.equal(f.controller.activeRuns.size, 0);
  const before = f.notifications.length;
  run.appendOutput('late output'); run.passed(f.items[0]); run.end();
  assert.equal(f.notifications.length, before);
  assert.deepEqual(f.states().map(s => s.state), [2, 3, 4, 5, 1]); f.controller.dispose();
});
test('cancel before creation and controller disposal cancel late-created native runs', async () => {
  for (const action of ['cancel', 'dispose']) {
    const f = fixture(); let resume, run, token; const gate = new Promise(resolve => { resume = resolve; });
    f.run(async (request, cancellation) => { token = cancellation; await gate; run = f.controller.createTestRun(request); });
    if (action === 'cancel') f.controller.cancelRun(); else f.controller.dispose();
    resume(); await tick();
    assert.equal(token.isCancellationRequested, true); assert.equal(run.ended, true); assert.equal(run.token.isCancellationRequested, true);
    assert.equal(f.controller.activeRuns.size, 0); if (action === 'cancel') f.controller.dispose();
  }
});
test('multiple runs per request end once and selective cancellation leaves other requests live', () => {
  const f = fixture(); const runs = [];
  f.run(request => { runs.push(f.controller.createTestRun(request), f.controller.createTestRun(request)); });
  f.run(request => { runs.push(f.controller.createTestRun(request)); });
  f.controller.cancelRun(runs[0].id);
  assert.equal(runs[0].ended, true); assert.equal(runs[1].ended, true); assert.equal(runs[2].ended, undefined);
  assert.equal(f.controller.activeRuns.size, 1); runs[2].end(); assert.equal(f.controller.activeRuns.size, 0); f.controller.dispose();
});
test('a successfully returned handler keeps its legitimate async run alive', async () => {
  const f = fixture(); let run;
  f.run(async request => { run = f.controller.createTestRun(request); run.started(f.items[0]); });
  await tick(); assert.equal(run.ended, undefined); assert.equal(f.controller.activeRuns.size, 1); run.end(); f.controller.dispose();
});
function startRun(f) { let run; f.run(request => { run = stateRun(f, request); }); return run; }
async function tracker(f) { return f.nativeDebug.createDebugAdapterTracker({ type: 'debugpy', configuration: f.starts.at(-1)[1] }); }
test('normal debugger API/config/options remain unchanged', async () => {
  const f = fixture(); const config = { type: 'debugpy', request: 'launch' }, options = {};
  assert.equal(await f.api.debug.startDebugging(undefined, config, options), true);
  assert.equal(f.starts[0][1], config); assert.equal(f.nativeDebug.trackerFactories.length, 0); f.controller.dispose();
});
test('false/rejected/synchronous start failure cleans only the associated test run and tracker', async () => {
  for (const behavior of [() => false, () => Promise.reject(new Error('start rejected')), () => { throw new Error('start threw'); }]) {
    const f = fixture(), run = startRun(f), unrelated = startRun(f);
    f.nativeDebug.proxy.$startDebugging = behavior;
    try { await f.api.debug.startDebugging(undefined, { type: 'debugpy' }, { testRun: run }); } catch {}
    assert.equal(run.ended, true); assert.equal(unrelated.ended, undefined); assert.equal(f.nativeDebug.trackerFactories.length, 0);
    assert.equal(f.controller.activeRuns.size, 1); f.controller.dispose();
  }
});
test('actual tracker failure DAP response seals unresolved tests; late responses do not replace results', async () => {
  const f = fixture(), run = startRun(f); const config = { type: 'debugpy', request: 'launch' };
  await f.api.debug.startDebugging(undefined, config, { testRun: run });
  assert.equal(config.__ynxTestAdapterRequest, undefined);
  const nativeTracker = await tracker(f);
  nativeTracker.onDidSendMessage({ type: 'response', command: 'initialize', success: false, message: 'Permission denied' });
  assert.equal(run.ended, true); assert.deepEqual(f.states().map(s => s.state), [6,3,4,5,6]);
  nativeTracker.onExit(); assert.equal(f.nativeDebug.trackerFactories.length, 0); f.controller.dispose();
});
test('successful launch preserves test result drain on native undefined-code exit', async () => {
  const f = fixture(), run = startRun(f);
  await f.api.debug.startDebugging(undefined, { type: 'debugpy' }, { testRun: run });
  const nativeTracker = await tracker(f);
  nativeTracker.onDidSendMessage({ type: 'response', command: 'launch', success: true }); nativeTracker.onExit(undefined, undefined);
  assert.equal(run.ended, undefined); assert.equal(f.nativeDebug.trackerFactories.length, 0);
  run.passed(f.items[0]); run.passed(f.items[4]); run.end();
  assert.equal(f.states().at(-1).state, 3); assert.equal(f.controller.activeRuns.size, 0); f.controller.dispose();
});
test('real child adapter early exit travels through actual stream/session/tracker and ends test', async () => {
  const f = fixture(), run = startRun(f);
  await f.api.debug.startDebugging(undefined, { type: 'debugpy' }, { testRun: run });
  const child = spawn(process.execPath, ['-e', 'process.exit(17)'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  const adapter = new ProcessDebugAdapter(child);
  const session = new PluginDebugAdapterSession(adapter, await tracker(f), { id: 'real-child-exit', type: 'debugpy', configuration: f.starts[0][1] });
  const message = new Emitter(), close = new Emitter(); let channelClosed = 0;
  await session.start({ onMessage: message.event, onClose: close.event, send() {}, close() { channelClosed++; close.fire(); } });
  const [code] = await closed;
  assert.equal(code, 17); assert.equal(session.isClosed, true); assert.equal(channelClosed, 1);
  assert.equal(run.ended, true); assert.equal(f.controller.activeRuns.size, 0);
  assert.equal(f.nativeDebug.trackerFactories.length, 0);
  assert.match(f.states()[0].messages[0].message.value, /connection closed before launch/);
  f.controller.dispose(); message.dispose(); close.dispose();
});
test('tracker error cancels a settled profile and run token before listeners are released', async () => {
  const f = fixture(); let run, profileCancelled = 0, runCancelled = 0;
  f.run((request, token) => {
    run = stateRun(f, request);
    token.onCancellationRequested(() => profileCancelled++);
    run.token.onCancellationRequested(() => runCancelled++);
  });
  await f.api.debug.startDebugging(undefined, { type: 'debugpy' }, { testRun: run });
  const nativeTracker = await tracker(f); nativeTracker.onError(new Error('adapter transport failed'));
  assert.equal(profileCancelled, 1); assert.equal(runCancelled, 1); assert.equal(run.ended, true);
  assert.equal(f.nativeDebug.trackerFactories.length, 0); assert.equal(f.controller.activeRuns.size, 0);
  f.controller.dispose();
});
test('failed request with no run does not invent results and a late-created run is ended', async () => {
  const f = fixture(); let request;
  f.run(async value => { request = value; throw new Error('preparation failed'); });
  await tick();
  assert.equal(f.notifications.filter(n => n.name === '$notifyTestRunCreated').length, 0);
  const late = f.controller.createTestRun(request);
  assert.equal(late.ended, true); assert.equal(late.token.isCancellationRequested, true);
  assert.equal(f.states().length, 0); assert.equal(f.controller.activeRuns.size, 0); f.controller.dispose();
});
test('end removes only its own request while an intermediate run leaves the latest active', () => {
  const f = fixture(); let first, latest;
  f.run(request => { first = f.controller.createTestRun(request); latest = f.controller.createTestRun(request); });
  first.end(); assert.equal(f.controller.activeRuns.size, 1); assert.equal([...f.controller.activeRuns.values()][0], latest);
  f.controller.cancelRun(latest.id); assert.equal(latest.ended, true); assert.equal(f.controller.activeRuns.size, 0); f.controller.dispose();
});
test('cancellation before delayed debug start resolves false cannot turn it into failure', async () => {
  const f = fixture(), run = startRun(f); let resume;
  f.nativeDebug.proxy.$startDebugging = () => new Promise(resolve => { resume = resolve; });
  const pending = f.api.debug.startDebugging(undefined, { type: 'debugpy' }, { testRun: run });
  f.controller.cancelRun(run.id); resume(false); assert.equal(await pending, false);
  assert.deepEqual(f.states().map(s => s.state), [2,3,4,5,1]);
  assert.equal(f.nativeDebug.trackerFactories.length, 0); f.controller.dispose();
});
test('tracker registration failure seals the run without changing a separate native run', () => {
  const f = fixture(), run = startRun(f), other = startRun(f);
  f.api.debug.registerDebugAdapterTrackerFactory = () => { throw new Error('tracker unavailable'); };
  assert.throws(() => f.api.debug.startDebugging(undefined, { type: 'debugpy' }, { testRun: run }), /tracker unavailable/);
  assert.equal(run.ended, true); assert.equal(other.ended, undefined); f.controller.dispose();
});
test('explicit transport error after launch remains an error and cancels only its associated run', async () => {
  const f = fixture(), run = startRun(f), other = startRun(f);
  await f.api.debug.startDebugging(undefined, { type: 'debugpy' }, { testRun: run });
  const nativeTracker = await tracker(f);
  nativeTracker.onDidSendMessage({ type: 'response', command: 'attach', success: true });
  nativeTracker.onError(new Error('transport lost'));
  assert.equal(run.ended, true); assert.equal(other.ended, undefined);
  assert.equal(f.nativeDebug.trackerFactories.length, 0); f.controller.dispose();
});
