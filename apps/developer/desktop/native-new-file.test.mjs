import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { installNativeNewFile } = createRequire(import.meta.url)('../runtime/ynx-workbench/lib/native-file-picker');
function fixture(native = true, errorFeedback) {
  const events = [], handlers = []; let finish, fail = false;
  class URI {
    constructor(path) { this.value = path; this.scheme = path.split(':')[0]; this.path = { base: path.split('/').at(-1) }; }
    resolve(name) { return new URI(this.value + '/' + name); }
    get parent() { return new URI(this.value.slice(0, this.value.lastIndexOf('/'))); }
    isEqualOrParent(other) { return other.value === this.value || other.value.startsWith(this.value + '/'); }
  }
  class Contribution {
    registerCommands(registry) { registry.registerHandler('new', { execute: async () => { events.push('html'); } }); }
    newWorkspaceRootUriAwareCommandHandler(handler) { return handler; }
    async getDirectory() { return { resource: new URI('file:///qa') }; }
    getDefaultFileConfig() { return { fileName: 'Untitled', fileExtension: '.txt' }; }
    fireCreateNewFile(event) { events.push(['created', event.parent.value, event.uri.value]); }
  }
  const target = native ? { ynxDesktopFiles: {} } : {}, root = { resource: new URI('file:///qa') };
  let editor = {};
  installNativeNewFile?.({ Contribution, command: { id: 'new' }, target,
    open: async (_, uri) => events.push(['open', uri.value]),
    uniqueResource: (_, uri) => uri, getCurrentEditor: () => editor });
  const instance = new Contribution();
  instance.workspaceService = { workspace: root, tryGetRoots: () => [root] };
  instance.fileDialogService = { showSaveDialog: props => { events.push(['native', props.inputValue]); return new Promise(resolve => { finish = resolve; }); } };
  instance.fileService = { async create(uri, content, options) { events.push(['create', uri.value, options]); if (fail) throw Error('EXISTS'); } };
  instance.messageService = { error: async message => { events.push(['error', message]); return errorFeedback; } };
  instance.registerCommands({ registerHandler: (_, handler) => handlers.unshift(handler) });
  return { run: () => handlers[0].execute(root.resource), events, target, instance, finish: path => finish(path && new URI(path)), changeEditor: () => editor = {}, fail: (value = true) => fail = value };
}
async function tick() { await Promise.resolve(); await Promise.resolve(); }
test('Explorer new file uses native destination and creates once without overwrite', async () => {
  const f = fixture(), p = f.run(); await tick();
  assert.deepEqual(f.events, [['native', 'Untitled.txt']]);
  f.finish('file:///qa/sub/new.txt'); await p;
  assert.deepEqual(f.events.slice(1), [['create','file:///qa/sub/new.txt',{overwrite:false}],['created','file:///qa/sub','file:///qa/sub/new.txt'],['open','file:///qa/sub/new.txt']]);
});
test('cancel and duplicate clicks neither create nor invalidate current picker', async () => {
  const f = fixture(), p = f.run(); await tick(); await f.run(); f.finish(undefined); await p;
  assert.equal(f.events.length,1);
  const retry=f.run(); await tick(); f.finish('file:///qa/retry.txt'); await retry;
  assert.equal(f.events.filter(e=>e[0]==='create').length,1);
});
for (const change of ['editor','workspace','bridge','roots']) test(`stale ${change} cannot create`, async () => {
  const f=fixture(),p=f.run(); await tick();
  if(change==='editor')f.changeEditor();
  if(change==='workspace')f.instance.workspaceService.workspace={};
  if(change==='bridge')f.target.ynxDesktopFiles={};
  if(change==='roots')f.instance.workspaceService.tryGetRoots=()=>[];
  f.finish('file:///qa/stale.txt'); await p;
  assert.equal(f.events.filter(e=>e[0]==='create').length,0);
});
test('foreign destination rejects and create failure cannot report created or open', async () => {
  const foreign=fixture(),p=foreign.run(); await tick();foreign.finish('file:///outside/new.txt');await p;
  assert.equal(foreign.events.length,1);
  const f=fixture();f.fail();const q=f.run();await tick();f.finish('file:///qa/existing.txt');await q;
  assert.equal(f.events.some(e=>e[0]==='created'||e[0]==='open'),false);
  assert.deepEqual(f.events.at(-1),['error','EXISTS']);
});
test('browser keeps upstream new-file behavior', async () => { const f=fixture(false);await f.run();assert.deepEqual(f.events,['html']); });

test('failed create releases its request before error feedback is dismissed so an explicit retry can open a fresh picker', async () => {
  let dismiss;
  const feedback = new Promise(resolve => { dismiss = resolve; });
  const f = fixture(true, feedback);
  f.fail();
  let settled = false;
  const failed = f.run().finally(() => { settled = true; });
  await tick(); f.finish('file:///qa/existing.txt');
  // Model a real notification that remains visible until the user dismisses it.
  // Use an event-loop turn rather than a product delay or closing that notice.
  await new Promise(resolve => setImmediate(resolve));
  const beforeDismissal = settled;
  f.fail(false);
  const retry = f.run(); await tick();
  const pickersBeforeDismissal = f.events.filter(event => event[0] === 'native').length;
  if (pickersBeforeDismissal === 2) f.finish('file:///qa/retried.txt');
  // Always release the fixture to avoid leaving a pending test after a RED.
  dismiss(); await Promise.all([failed, retry]);
  assert.equal(beforeDismissal, true, 'the failed command must finish while feedback is still visible');
  assert.equal(pickersBeforeDismissal, 2, 'an explicit retry must not depend on dismissing old feedback');
  assert.equal(f.events.filter(event => event[0] === 'create' && event[1] === 'file:///qa/retried.txt').length, 1);
  assert.equal(f.events.filter(event => event[0] === 'created').length, 1);
});

for (const kind of ['throw', 'reject']) test(`a ${kind} from feedback cannot leak or block a subsequent file creation`, async () => {
  const f = fixture();
  f.instance.messageService.error = () => {
    if (kind === 'throw') throw Error('notification unavailable');
    return Promise.reject(Error('notification unavailable'));
  };
  f.fail();
  const first = f.run(); await tick(); f.finish('file:///qa/existing.txt'); await first;
  assert.equal(f.events.some(event => event[0] === 'created' || event[0] === 'open'), false);
  f.fail(false);
  const retry = f.run(); await tick(); f.finish('file:///qa/recovered.txt'); await retry;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events.filter(event => event[0] === 'created').length, 1);
  assert.equal(f.events.filter(event => event[0] === 'open').length, 1);
});
