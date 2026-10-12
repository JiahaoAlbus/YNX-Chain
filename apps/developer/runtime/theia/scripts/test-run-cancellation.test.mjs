import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TestControllerImpl } = require('@theia/plugin-ext/lib/plugin/tests');
const { CancellationTokenSource } = require('@theia/core/lib/common/cancellation');
const { adaptApi } = require('../../ynx-workbench/lib/plugin-vscode-init-adapter');

function fixture() {
  const notifications = [];
  const proxy = new Proxy({}, { get: (_, name) => (...args) => notifications.push({ name, args }) });
  const api = adaptApi({ CancellationTokenSource, tests: {
    createTestController: () => new TestControllerImpl(() => {}, proxy, 'actual-tests', 'Tests'),
  } });
  const controller = api.tests.createTestController();
  const item = controller.createTestItem('balance', 'balance');
  controller.items.add(item);
  return { controller, item, notifications };
}

test('UI profile receives cancellation, ends the actual run and removes active records', () => {
  const { controller, item, notifications } = fixture();
  let run, token, request, ended = 0;
  const handler = (value, cancellation) => {
    request = value; token = cancellation;
    run = controller.createTestRun(value, 'Python-style handler');
    run.onDidEnd(() => ended++);
    token.onCancellationRequested(() => run.end());
  };
  const profile = controller.createRunProfile('Run', 1, handler, true);
  controller.runTestsForUI(profile.profileId, 'run', [item.path], [], true);
  assert.deepEqual(request.include, [item]);
  assert.equal(request.preserveFocus, true);
  assert.equal(request.profile, profile);
  assert.equal(profile.runHandler, handler);
  controller.cancelRun(run.id);
  assert.equal(token.isCancellationRequested, true);
  assert.equal(run.token.isCancellationRequested, true);
  assert.equal(run.ended, true);
  assert.equal(controller.activeRuns.size, 0);
  run.end();
  assert.equal(ended, 1);
  assert.equal(notifications.filter(event => event.name === '$notifyTestRunEnded').length, 1);
  controller.dispose();
});

test('selective cancellation leaves unrelated runs live; cancel all reaches the remainder', () => {
  const { controller, item } = fixture();
  const runs = [];
  const profile = controller.createRunProfile('Run', 1, (request, token) => {
    const run = controller.createTestRun(request);
    token.onCancellationRequested(() => run.end());
    runs.push({ run, token });
  }, true);
  controller.runTestsForUI(profile.profileId, '', [item.path], [], false);
  controller.runTestsForUI(profile.profileId, '', [item.path], [], false);
  controller.cancelRun(runs[0].run.id);
  assert.equal(runs[0].run.ended, true);
  assert.equal(runs[1].token.isCancellationRequested, false);
  assert.equal(controller.activeRuns.size, 1);
  assert.throws(() => controller.cancelRun('missing'), /non - existing/);
  assert.equal(runs[1].token.isCancellationRequested, false);
  controller.cancelRun();
  assert.equal(runs[1].run.ended, true);
  assert.equal(controller.activeRuns.size, 0);
  controller.dispose();
});

test('native run-token listener ending first does not swallow profile cancellation', () => {
  const { controller, item } = fixture();
  let run, profileCancelled = 0;
  const profile = controller.createRunProfile('Run', 1, (request, token) => {
    run = controller.createTestRun(request);
    run.token.onCancellationRequested(() => run.end());
    token.onCancellationRequested(() => profileCancelled++);
  }, true);
  controller.runTestsForUI(profile.profileId, '', [item.path], [], false);
  controller.cancelRun(run.id);
  assert.equal(profileCancelled, 1);
  assert.equal(controller.activeRuns.size, 0);
  controller.dispose();
});

test('normal completion cleans actual framework records and controller disposal cancels live profiles', () => {
  const { controller, item } = fixture();
  let run, token;
  const profile = controller.createRunProfile('Run', 1, (request, cancellation) => {
    token = cancellation;
    run = controller.createTestRun(request);
    token.onCancellationRequested(() => run.end());
  }, true);
  controller.runTestsForUI(profile.profileId, '', [item.path], [], false);
  run.end();
  assert.equal(controller.activeRuns.size, 0);
  assert.equal(token.isCancellationRequested, false);
  controller.runTestsForUI(profile.profileId, '', [item.path], [], false);
  controller.dispose();
  assert.equal(token.isCancellationRequested, true);
  assert.equal(run.token.isCancellationRequested, true);
  assert.equal(run.ended, true);
  assert.equal(controller.activeRuns.size, 0);
});

test('cancel all reaches an async profile before it has created a run', async () => {
  const { controller, item } = fixture();
  let resume, token;
  const gate = new Promise(resolve => { resume = resolve; });
  const profile = controller.createRunProfile('Run', 1, async (request, cancellation) => {
    token = cancellation;
    await gate;
    assert.equal(token.isCancellationRequested, true);
  }, true);
  controller.runTestsForUI(profile.profileId, '', [item.path], [], false);
  controller.cancelRun();
  assert.equal(token.isCancellationRequested, true);
  resume();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.activeRuns.size, 0);
  controller.dispose();
});

test('ending an intermediate run keeps cancellation live until the async profile settles', async () => {
  const { controller, item } = fixture();
  let resume, cancelled = 0;
  const gate = new Promise(resolve => { resume = resolve; });
  const profile = controller.createRunProfile('Run', 1, async (request, token) => {
    token.onCancellationRequested(() => cancelled++);
    const run = controller.createTestRun(request);
    run.end();
    await gate;
  }, true);
  controller.runTestsForUI(profile.profileId, '', [item.path], [], false);
  controller.cancelRun();
  assert.equal(cancelled, 1);
  resume();
  await new Promise(resolve => setImmediate(resolve));
  controller.dispose();
});
