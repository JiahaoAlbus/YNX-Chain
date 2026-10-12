import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { mkdtemp, mkdir, cp, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createLocalIpcSession } from './local-workbench-ipc.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const desktop = dirname(fileURLToPath(import.meta.url)), python = '/Library/Developer/CommandLineTools/usr/bin/python3';
const extensionSource = process.env.YNX_DEBUG_TEST_EXTENSION;
const runtimeRoot = process.env.YNX_DEBUG_TEST_RUNTIME;
const artifacts = process.env.YNX_DEBUG_QA_ROOT;
const packagedDesktop = process.env.YNX_DEBUG_TEST_DESKTOP;
assert.ok(extensionSource && runtimeRoot && artifacts && packagedDesktop, 'Explicit retained debug extension, runtime, packaged desktop and owned external QA root are required; never download test inputs');
// A packaged supervisor must consume its own executable inputs, just as the
// native launcher does. Mixing a Homebrew Node or temporary helper into an App
// fixture correctly fails the production package boundary before debugging.
const bundledRuntime = packagedDesktop.endsWith('/Contents/Resources/code/apps/developer/desktop')
  ? resolve(packagedDesktop, '../../../../runtime') : undefined;
const { createDebugSessionSupervisor, debugSessionPolicy, dapDecoder, DEBUGPY_PINS } = await import(pathToFileURL(join(packagedDesktop, 'local-debug-session.mjs')));
const { localProjectContext, localWorkbenchEnvironment, localWorkbenchSandboxPolicy, localWorkbenchPathIdentities } = await import(pathToFileURL(join(packagedDesktop, 'local-workbench.mjs')));
const tick = () => new Promise(ok => setTimeout(ok, 20));
const receipts = [];
async function until(check) { for (let i = 0; i < 600; i++) { const value = check(); if (value) return value; await tick(); } throw Error('Timed out waiting for debug session'); }
async function fixture(task, budget = {}) {
  const root = await realpath(await mkdtemp(join(artifacts, 'session-')));
  const project = join(root, 'project'); await mkdir(project, { mode: 0o700 });
  const context = await localProjectContext({ supportRoot: join(root, 'support'), projectDirectory: project });
  const ipc = await createLocalIpcSession(context); context.ipcTemporary = ipc.path;
  const plugins = join(context.temporary, 'plugins'); await mkdir(plugins);
  const extension = join(plugins, 'ms-python.debugpy-2026.6.0'); await mkdir(extension);
  await cp(join(extensionSource, 'bundled'), join(extension, 'bundled'), { recursive: true, force: false });
  await cp(join(extensionSource, 'package.json'), join(extension, 'package.json'));
  const helper = bundledRuntime ? join(bundledRuntime, 'workspace-path-identity') : join(root, 'workspace-path-identity');
  if (!bundledRuntime) {
    const compile = spawnSync('/Library/Developer/CommandLineTools/usr/bin/clang', ['-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', join(desktop, 'macos/workspace-path-identity.c'), '-o', helper], { encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr);
  }
  const input = { node: bundledRuntime ? join(bundledRuntime, 'node') : process.execPath,
    lockHelper: bundledRuntime ? join(bundledRuntime, 'ynx-local-workbench-lock') : helper,
    runtime: { root: runtimeRoot }, context, port: 43119, plugins };
  const pathIdentities = await localWorkbenchPathIdentities({ ...input, helper });
  const basePolicy = localWorkbenchSandboxPolicy({ ...input, pathIdentities });
  const env = localWorkbenchEnvironment(input);
  const supervisor = await createDebugSessionSupervisor({ context, plugins, runtime: budget.setupRuntime ? { root: await budget.setupRuntime(root) } : input.runtime, basePolicy, env, pathIdentities, pathIdentityHelper: helper, ...budget });
  const descriptor = { command: python, args: [join(extension, 'bundled/libs/debugpy/adapter')] };
  await writeFile(join(project, 'target.py'), 'value = 41\nvalue += 1\nprint("YNX_PY_DEBUG", value, flush=True)\n');
  const f = { root, project, context, ipc, input, env, basePolicy, supervisor, descriptor, extension };
  try { await task(f); }
  catch (error) { receipts.push({ case: 'failure', root, message: error.message }); throw error; }
  finally {
    if (f.expectedCleanupFailure) await assert.rejects(supervisor.stop(), /unverified/); else await supervisor.stop();
    assert.equal(supervisor.activeSessions(), 0); assert.equal(await ipc.cleanup(), true);
    // Retain source/command/receipt files in the explicitly owned external QA
    // directory; no user launch/tasks files or project content is touched.
  }
}
class Rpc {
  constructor(socket) { this.socket = socket; this.messages = []; this.seq = 0; this.buffer = ''; socket.setEncoding('utf8'); socket.on('error', () => {}); socket.on('data', data => { this.buffer += data; for (let i; (i = this.buffer.indexOf('\n')) >= 0;) { this.messages.push(JSON.parse(this.buffer.slice(0, i))); this.buffer = this.buffer.slice(i + 1); } }); }
  send(message) { this.socket.write(JSON.stringify(message) + '\n'); }
  async message(kind, predicate = () => true) { return until(() => { const value = this.messages.find(message => message.kind === kind && predicate(message)); if (value) return value; const error = this.messages.find(message => message.kind === 'error'); if (kind !== 'error' && error) throw Error(error.message); const exit = this.messages.find(message => message.kind === 'exit'); if (exit && kind !== 'exit') throw Error('Adapter exited: ' + JSON.stringify(this.messages)); return undefined; }); }
  request(command, args = {}) { const seq = ++this.seq; this.send({ op: 'dap', message: { seq, type: 'request', command, arguments: args } }); return this.message('dap', m => m.message.type === 'response' && m.message.request_seq === seq).then(m => m.message); }
  event(name) { return this.message('dap', m => m.message.type === 'event' && m.message.event === name).then(m => m.message); }
  close() { this.socket.destroy(); }
}
async function admitted(f, extra = {}) {
  const rpc = new Rpc(connect(f.supervisor.path));
  rpc.send({ op: 'start', credential: f.supervisor.credential, projectId: f.context.id, requestId: randomUUID(), ...f.descriptor, ...extra });
  await rpc.message('ready'); return rpc;
}
async function launch(f, console, rpc) {
  assert.equal((await rpc.request('initialize', { adapterID: 'debugpy', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsRunInTerminalRequest: true, supportsVariableType: true })).success, true);
  const response = rpc.request('launch', { name: 'Real bounded Python', type: 'debugpy', request: 'launch', program: console === 'internalConsole' ? 'target.py' : join(f.project, 'target.py'), cwd: f.project, console, python, justMyCode: true, subProcess: true });
  if (console === 'integratedTerminal' && !rpc.autoTerminal) { const reverse = await rpc.message('dap', m => m.message.type === 'request' && m.message.command === 'runInTerminal'); rpc.send({ op: 'terminal', requestSeq: reverse.message.seq }); await rpc.message('terminalReady'); }
  await rpc.event('initialized');
  const bp = await rpc.request('setBreakpoints', { source: { path: join(f.project, 'target.py') }, breakpoints: [{ line: 2 }] });
  assert.equal(bp.body.breakpoints[0].verified, true);
  assert.equal((await rpc.request('configurationDone')).success, true); assert.equal((await response).success, true);
  const stopped = await rpc.event('stopped'); assert.equal(stopped.body.reason, 'breakpoint');
  const stack = await rpc.request('stackTrace', { threadId: stopped.body.threadId }); const frame = stack.body.stackFrames[0]; assert.equal(frame.line, 2);
  const scopes = await rpc.request('scopes', { frameId: frame.id });
  const variables = await rpc.request('variables', { variablesReference: scopes.body.scopes[0].variablesReference });
  assert.equal(variables.body.variables.find(v => v.name === 'value').value, '41');
  await rpc.beforeStep?.();
  assert.equal((await rpc.request('next', { threadId: stopped.body.threadId })).success, true);
  await rpc.message('dap', m => m.message.event === 'stopped' && m.message.body.reason === 'step');
  const nextStack = await rpc.request('stackTrace', { threadId: stopped.body.threadId }); assert.equal(nextStack.body.stackFrames[0].line, 3);
  assert.equal((await rpc.request('continue', { threadId: stopped.body.threadId })).success, true);
  await rpc.event('terminated');
  if (console === 'integratedTerminal' && rpc.autoTerminal) { await until(() => rpc.autoTerminal.output.join('').includes('YNX_PY_DEBUG 42')); }
  else if (console === 'integratedTerminal') { assert.match((await rpc.message('terminalData', m => m.data.includes('YNX_PY_DEBUG'))).data, /YNX_PY_DEBUG 42/); assert.equal((await rpc.message('terminalExit')).exitCode, 0); }
  else assert.ok(rpc.messages.some(m => m.message?.event === 'output' && m.message.body.output.includes('YNX_PY_DEBUG')));
  const exited = await rpc.event('exited'); assert.equal(exited.body.exitCode, 0);
  // Standard debugpy keeps its stdio client open until the IDE disposes it.
  // The target's exited event is authoritative; adapter teardown is separate.
  receipts.push({ case: console, root: f.root, endpoints: rpc.messages.find(m => m.kind === 'ready')?.ports, breakpoint: bp.body, frame, variables: variables.body, nextFrame: nextStack.body.stackFrames[0], output: rpc.messages.filter(m => m.kind === 'terminalData' || m.message?.event === 'output'), targetExit: exited.body, actualTheiaTerminal: rpc.autoTerminal?.output });
  rpc.close(); await until(() => f.supervisor.activeSessions() === 0);
}
test('official debugpy internalConsole retains launch/breakpoint/variables/step/normal exit under exact three-port policy', async () => fixture(async f => { const rpc = await admitted(f); await launch(f, 'internalConsole', rpc); rpc.close(); }));
test('official debugpy integratedTerminal uses real node-pty and same standard launch lifecycle', async () => fixture(async f => { const rpc = await admitted(f); await launch(f, 'integratedTerminal', rpc); rpc.close(); }));
test('ordinary host still denies fixed debug ports, bind zero, and session cannot bind or connect another endpoint', async () => fixture(async f => {
  const a = await admitted(f), b = await admitted(f);
  const portsA = (await a.message('ready')).ports, portsB = (await b.message('ready')).ports;
  assert.equal(new Set([...portsA, ...portsB]).size, 6);
  const bootstrap = join(packagedDesktop, 'local-debugpy-bootstrap.py');
  const policy = debugSessionPolicy(f.basePolicy, portsA, bootstrap);
  for (const [name, code, expected] of [
    ['host-bind-debug', `import socket; s=socket.socket();s.bind(('127.0.0.1',${portsA[1]}))`, false],
    ['session-bind-zero', "import socket;s=socket.socket();s.bind(('127.0.0.1',0))", false],
    ['other-session-bind', `import socket;s=socket.socket();s.bind(('127.0.0.1',${portsB[1]}))`, false],
    ['other-session-connect', `import socket;s=socket.socket();s.connect(('127.0.0.1',${portsB[0]}))`, false],
    ['own-fixed-bind', `import socket;s=socket.socket();s.bind(('127.0.0.1',${portsA[1]}));print('OWN_OK')`, true],
  ]) { const result = spawnSync('/usr/bin/sandbox-exec', ['-p', name.startsWith('host') ? f.basePolicy : policy, python, '-c', code], { env: f.env, cwd: f.project, encoding: 'utf8', timeout: 3000 }); assert.equal(result.status === 0, expected, result.stderr); if (!expected) assert.match(result.stderr, /Operation not permitted/); receipts.push({ case: name, status: result.status, stderr: result.stderr }); }
  a.close(); b.close(); await until(() => !f.supervisor.activeSessions());
}));
test('credential, project binding, request replay and changed pinned runtime fail closed', async () => fixture(async f => {
  const id = randomUUID(); const good = await admitted(f, { requestId: id });
  for (const extra of [{ credential: '0'.repeat(64) }, { projectId: randomUUID() }, { requestId: id }, { args: ['/bin/sh'] }]) {
    const rpc = new Rpc(connect(f.supervisor.path)); rpc.send({ op: 'start', credential: f.supervisor.credential, projectId: f.context.id, requestId: randomUUID(), ...f.descriptor, ...extra }); assert.ok((await rpc.message('error')).message); rpc.close();
  }
  const path = join(f.extension, 'bundled/libs/debugpy/common/sockets.py'); await writeFile(path, '# changed contract');
  const rpc = new Rpc(connect(f.supervisor.path)); rpc.send({ op: 'start', credential: f.supervisor.credential, projectId: f.context.id, requestId: randomUUID(), ...f.descriptor }); assert.match((await rpc.message('error')).message, /contract changed/); rpc.close(); good.close(); await until(() => !f.supervisor.activeSessions());
}));
test('cancel before launch, adapter disconnect and deadline reap actual process groups', async () => {
  await fixture(async f => { const rpc = await admitted(f); rpc.close(); await until(() => !f.supervisor.activeSessions()); });
  await fixture(async f => { const rpc = await admitted(f); assert.match((await rpc.message('error')).message, /limit/); await until(() => !f.supervisor.activeSessions()); rpc.close(); }, { lifetimeMs: 1000 });
});
test('malformed framing, unbounded ports and nonlocal endpoint policies are refused', () => {
  for (const ports of [[0, 1, 2], [23456, 23456, 23457], [23456, 23457, 70000]]) assert.throws(() => debugSessionPolicy('(deny network*)', ports, '/private/tmp/bootstrap.py'));
  assert.throws(() => dapDecoder(() => {})(Buffer.from('Content-Length: 999999999\r\n\r\n')), /bound/);
  assert.throws(() => dapDecoder(() => {})(Buffer.from('Content-Length: 1\r\nContent-Length: 1\r\n\r\n{}')), /length/);
  assert.equal(Object.keys(DEBUGPY_PINS).length, 6);
  const messages = [], decode = dapDecoder(message => messages.push(message));
  const payload = JSON.stringify({ text: '简体中文' }); const wire = Buffer.from(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
  for (const byte of wire) decode(Buffer.from([byte])); assert.deepEqual(messages, [{ text: '简体中文' }]);
});

const require = createRequire(join(desktop, '../runtime/theia/package.json'));
const { Emitter } = require('@theia/core/lib/common/event');
const { CancellationTokenSource } = require('@theia/core/lib/common/cancellation');
const { DebugExtImpl } = require('@theia/plugin-ext/lib/plugin/debug/debug-ext');
const { PluginDebugAdapterCreator } = require('@theia/plugin-ext/lib/plugin/debug/plugin-debug-adapter-creator');
const { PluginDebugAdapterSession } = require('@theia/plugin-ext/lib/plugin/debug/plugin-debug-adapter-session');
const { TestControllerImpl } = require('@theia/plugin-ext/lib/plugin/tests');
const { compilePythonTerminalHost, PythonTerminalWidget, PythonTerminalLifecycle, TerminalWatcher, CommandRegistry, subscribeNativeExit } = await import('../runtime/theia/scripts/python-terminal-test-fixture.mjs');
const { TerminalServiceExtImpl, adaptApi, adaptLocalDebugging, main: terminalMain } = await compilePythonTerminalHost();
const { DebugAdapterExecutable, DebugAdapterInlineImplementation } = require('@theia/plugin-ext/lib/plugin/types-impl');

function actualApi(f) {
  const native = new DebugExtImpl(), output = [], ids = [], shown = [], starts = [], states = [];
  native.proxy = { $startDebugging(folder, configuration, options) { starts.push(configuration); return true; } };
  let terminalService;
  const widgets=new Map(),created=new Emitter(),watcher=new TerminalWatcher();let terminalId=0;
  const lifecycle=new PythonTerminalLifecycle({getContext:async()=>({mode:'local',workspace:f.project})},
    {onDidCreateTerminal:created.event,getById:id=>widgets.get(id)},watcher,{getSession:id=>native.sessions.get(id)});
  const commands=new CommandRegistry({getContributions:()=>[]});lifecycle.registerCommands(commands);lifecycle.initialize();
  const main=Object.create(terminalMain);main.toIconClass=()=>undefined;main.getTerminalLocation=()=>undefined;
  main.terminals={newTerminal:async options=>{
    const widget=new PythonTerminalWidget();widget.id=options.id;widget.options=options;widget._terminalId=++terminalId;widget.terminalWatcher=watcher;widget.shellTerminalServer={close(){}};
    subscribeNativeExit.call(widget);widget.term=new (require('xterm').Terminal)();widget.termOpened=true;widget._currentTerminalOutput=[];
    widget.onDidDispose(()=>widget.term.dispose());
    widget.start=()=>{terminalService.$terminalCreated(widget.id,options.title);terminalService.$terminalOpened(widget.id,undefined,widget.terminalId,80,24);};
    widget.onTerminalDidClose(value=>terminalService.$terminalClosed(widget.id,value.exitStatus));
    widget.onDidDispose(()=>widgets.delete(widget.id));widgets.set(widget.id,widget);created.fire(widget);return widget;
  }};
  const proxy = {
    $createTerminal(...args) { assert.equal(args[3],true);ids.push(args[0]);return main.$createTerminal(...args); },
    $write(id,data){assert.ok(widgets.has(id));output.push(data);widgets.get(id).write(data);},
    $show(id){shown.push(id);},
    $dispose(id){widgets.get(id)?.close();},
  };
  terminalService = new TerminalServiceExtImpl({ getProxy: () => proxy });
  const debug = { registerDebugAdapterDescriptorFactory: native.registerDebugAdapterDescriptorFactory.bind(native),
    registerDebugAdapterTrackerFactory: native.registerDebugAdapterTrackerFactory.bind(native), startDebugging: native.startDebugging.bind(native),
    onDidTerminateDebugSession: native.onDidTerminateDebugSession };
  const api = adaptApi({ CancellationTokenSource, EventEmitter: Emitter, DebugAdapterInlineImplementation, debug, commands:{executeCommand:(...args)=>commands.executeCommand(...args)},
    tests: { createTestController: () => new TestControllerImpl(() => {}, new Proxy({}, { get: (_, key) => (...args) => { if (key === '$notifyTestStateChanged') states.push(...args[2]); } }), 'actual-python-tests', 'Python Tests') },
    window: { createTerminal: options => terminalService.createTerminal({ model: { id: 'ms-python.debugpy' } }, options) } });
  adaptLocalDebugging(api, { ...f.env, YNX_DEBUG_SOCKET: f.supervisor.path, YNX_DEBUG_CREDENTIAL: f.supervisor.credential, YNX_DEBUG_PROJECT: f.context.id });
  api.debug.registerDebugAdapterDescriptorFactory('debugpy', { createDebugAdapterDescriptor: () => new DebugAdapterExecutable(f.descriptor.command, f.descriptor.args) });
  return { api, native, terminalService, output, ids, shown, starts, states, widgets, lifecycle };
}
async function nativeSession(f, state, configuration = { type: 'debugpy', request: 'launch', console: 'integratedTerminal' }) {
  const session = { id: randomUUID(), configuration, options:{workspaceFolderUri:pathToFileURL(f.project).toString()} }; state.native.sessions.set(session.id, session);
  const adapter = await new PluginDebugAdapterCreator().createDebugAdapter(session, configuration, undefined, state.native.descriptorFactories.get('debugpy'));
  assert.equal(adapter.constructor.name, 'InlineDebugAdapter');
  const rpc = Object.create(Rpc.prototype); rpc.messages = []; rpc.seq = 0;
  const receive = new Emitter();
  const bridge = new PluginDebugAdapterSession(adapter, await state.native.createDebugAdapterTracker(session), session);
  await bridge.start({ onMessage: receive.event, onClose: () => ({ dispose() {} }), send: data => rpc.messages.push({ kind: 'dap', message: JSON.parse(data) }), close() {} });
  rpc.send = message => { assert.equal(message.op, 'dap'); receive.fire(JSON.stringify(message.message)); };
  rpc.close = () => bridge.stop(); rpc.autoTerminal = state;
  return { rpc, session, adapter };
}
test('actual Theia descriptor/InlineDebugAdapter/PseudoTerminal subscribes before open, forwards input and resize, and closes all children', async () => fixture(async f => {
  await writeFile(join(f.project, 'target.py'), 'import os; value = 41\nanswer = input("Theia input: ")\nvalue += 1\nprint("YNX_PY_DEBUG", value, answer, flush=True); print("SIZE", os.get_terminal_size().columns, os.get_terminal_size().lines, flush=True)\n');
  const state = actualApi(f), { rpc } = await nativeSession(f, state);
  rpc.beforeStep = async () => { const id = state.ids[0]; assert.ok(id); state.terminalService.$terminalSizeChanged(id, 101, 37); state.terminalService.$terminalOnInput(id, 'fromTheia\n'); };
  await launch(f, 'integratedTerminal', rpc);
  assert.ok(state.output.join('').includes('fromTheia')); assert.equal(state.shown.length, 1);
  assert.match(state.output.join(''), /SIZE 101 37/);
  assert.equal(state.terminalService.terminals.length, 1);
  const widget=state.widgets.get(state.ids[0]);assert.deepEqual(widget.exitStatus,{code:0,reason:2});
  widget.close();assert.equal(state.terminalService.terminals.length,0);assert.equal(state.lifecycle.entries.size,0);
}));
test('actual TestRun and PluginDebugAdapterSession ends failed local launch, preserves cancellation, and does not end successful launch early', async () => fixture(async f => {
  const state = actualApi(f), controller = state.api.tests.createTestController();
  const item = controller.createTestItem('python-example', 'Python Example'); controller.items.add(item);
  let run;
  const start = async (console = 'internalConsole') => {
    const profile = controller.createRunProfile('Debug', 2, request => { run = controller.createTestRun(request); run.started(item); return state.api.debug.startDebugging(undefined, { type: 'debugpy', request: 'launch', console }, { testRun: run }); });
    controller.runTestsForUI(profile.profileId, '', [item.path], [], false); await tick();
    return nativeSession(f, state, state.starts.at(-1));
  };
  const failed = await start(); await failed.rpc.request('initialize', { adapterID: 'debugpy' });
  const denied = await failed.rpc.request('launch', { type: 'debugpy', request: 'launch', console: 'externalTerminal' });
  assert.equal(denied.success, false); assert.equal(run.ended, true); assert.equal(controller.activeRuns.size, 0); assert.equal(state.states.at(-1).state, 6);
  failed.rpc.close(); await until(() => !f.supervisor.activeSessions());
  const cancelled = await start(); const before = state.states.length; await state.native.$sessionDidDestroy(cancelled.session.id);
  assert.equal(run.ended, true); assert.equal(run.token.isCancellationRequested, true); assert.ok(state.states.slice(before).every(state => state.state <= 2), 'cancel must not invent a passed/failed/errored result'); cancelled.rpc.close(); await until(() => !f.supervisor.activeSessions());
  const normal = await start('integratedTerminal'); await normal.rpc.request('initialize', { adapterID: 'debugpy', supportsRunInTerminalRequest: true });
  const pending = normal.rpc.request('launch', { type: 'debugpy', request: 'launch', console: 'integratedTerminal', program: join(f.project, 'target.py'), cwd: f.project, python });
  await normal.rpc.event('initialized'); await normal.rpc.request('setBreakpoints', { source: { path: join(f.project, 'target.py') }, breakpoints: [{ line: 2 }] }); await normal.rpc.request('configurationDone');
  assert.equal((await pending).success, true); await normal.rpc.event('stopped'); assert.equal(run.ended, undefined);
  state.widgets.get(state.ids.at(-1)).close();
  await until(() => !f.supervisor.activeSessions()); assert.equal(run.ended, true); assert.equal(run.token.isCancellationRequested, true); normal.rpc.close();
  controller.dispose();
}));
test('cleanup helper rejection and timeout still close owned adapter/listener/socket, report failure and refuse reuse', async () => {
  for (const mode of ['reject', 'timeout']) {
    const warnings = [];
    await fixture(async f => {
      f.expectedCleanupFailure = true;
      const rpc = await admitted(f); rpc.close(); await until(() => !f.supervisor.activeSessions());
      assert.ok(warnings.some(error => /leases retained/.test(error.message)));
      const denied = new Rpc(connect(f.supervisor.path)); denied.send({ op: 'start', credential: f.supervisor.credential, projectId: f.context.id, requestId: randomUUID(), ...f.descriptor }); assert.match((await denied.message('error')).message, /refused/); denied.close();
      await assert.rejects(f.supervisor.stop(), /unverified/); await assert.rejects(readFile(f.supervisor.path), { code: 'ENOENT' });
      receipts.push({ case: 'cleanup-' + mode, warnings: warnings.map(error => error.message), listenerClosed: true, socketUnlinked: true, successClaimed: false });
    }, { cleanupTimeoutMs: 100, warn: error => warnings.push(error), setupRuntime: async root => {
      const runtime = join(root, 'cleanup-runtime'); await mkdir(join(runtime, 'lib/backend'), { recursive: true });
      await writeFile(join(runtime, 'lib/backend/ynx-process-tree'), mode === 'reject' ? '#!/bin/sh\nexit 77\n' : '#!/bin/sh\nexec /bin/sleep 2\n', { mode: 0o700 }); return runtime;
    } });
  }
});
test('actual descriptor pending launch failure, native session termination, and unaffected other debugger factories', async () => fixture(async f => {
  const state = actualApi(f);
  const ordinary = { createDebugAdapterDescriptor: () => 'ordinary' };
  state.api.debug.registerDebugAdapterDescriptorFactory('cppdbg', ordinary); assert.equal(state.native.descriptorFactories.get('cppdbg'), ordinary);
  await assert.rejects(nativeSession(f, state, { type: 'debugpy', request: 'launch', console: 'externalTerminal' }), /External/);
  const { rpc, session } = await nativeSession(f, state, { type: 'debugpy', request: 'launch', console: 'internalConsole' });
  await rpc.request('initialize', { adapterID: 'debugpy' });
  const launch = rpc.request('launch', { request: 'launch', type: 'debugpy', console: 'externalTerminal' });
  assert.equal((await launch).success, false); await rpc.event('terminated'); await until(() => !f.supervisor.activeSessions());
  const second = await nativeSession(f, state);
  await state.native.$sessionDidDestroy(second.session.id); await until(() => !f.supervisor.activeSessions());
  rpc.close(); second.rpc.close();
}));
// Transport scheduling tests use explicit local protocol messages, not a fake
// debugpy success claim. Creator, InlineAdapter, TerminalExt/Main and frontend
// widget/watcher/commands remain the same retained classes as runtime tests.
test('actual terminal bridge drains terminated-before-tail exit17 and closes failed/timeout widgets without invented status', async () => fixture(async f => {
  for (const mode of ['tail', 'transport', 'timeout', 'finish-reject']) {
    const path=join(f.ipc.path,'retention-'+mode+'.sock');let connection;
    const server=createServer(socket=>{connection=socket;let buffer='';socket.setEncoding('utf8');socket.on('error',()=>{});socket.on('data',chunk=>{buffer+=chunk;for(let end;(end=buffer.indexOf('\n'))>=0;){const message=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(message.op==='start')socket.write(JSON.stringify({kind:'ready'})+'\n');}});});
    await new Promise((ok,bad)=>{server.once('error',bad);server.listen(path,ok);});
    const state=actualApi({...f,supervisor:{path,credential:f.supervisor.credential}});
    if(mode==='finish-reject'){const execute=state.api.commands.executeCommand;state.api.commands.executeCommand=(id,...args)=>id==='ynx.debug.terminal.finish'?Promise.reject(Error('actual frontend finish rejected')):execute(id,...args);}
    const {rpc}=await nativeSession(f,state);
    const send=value=>connection.write(JSON.stringify(value)+'\n');
    send({kind:'dap',message:{type:'request',seq:1,command:'runInTerminal',arguments:{kind:'integrated',title:'Python',cwd:f.project,args:[python,join(f.project,'target.py')]}}});
    await until(()=>state.shown.length);
    const widget=state.widgets.get(state.ids[0]);send({kind:'terminalData',data:'actual retained transcript\r\n'});
    await until(()=>state.output.join('').includes('transcript'));
    if(mode==='tail') {
      send({kind:'dap',message:{type:'event',event:'terminated',seq:2}});
      send({kind:'terminalData',data:'last bytes before exit17\r\n'});
      send({kind:'terminalExit',exitCode:17});connection.end();
      await until(()=>widget.exitStatus?.code===17);assert.equal(widget.isDisposed,false);assert.match(state.output.join(''),/last bytes before exit17/);
      await new Promise(ok=>widget.term.write('',ok));const buffer=widget.term.buffer.active;const transcript=Array.from({length:buffer.length},(_,i)=>buffer.getLine(i)?.translateToString()).join('\n');assert.match(transcript,/last bytes before exit17/);assert.match(transcript,/actual retained transcript/);
      assert.deepEqual(widget.exitStatus,{code:17,reason:2});widget.close();
    } else {
      if(mode==='transport')connection.destroy();else if(mode==='finish-reject')send({kind:'terminalExit',exitCode:0});else send({kind:'dap',message:{type:'event',event:'terminated',seq:2}});
      await until(()=>widget.isDisposed);assert.notEqual(widget.exitStatus?.reason,2);assert.equal(state.lifecycle.entries.size,0);assert.equal(state.terminalService.terminals.length,0);
    }
    rpc.close();connection.destroy();await new Promise(ok=>server.close(ok));state.lifecycle.onStop();
  }
}));
test.after(async () => { await writeFile(join(artifacts, 'debug-session-receipt.json'), JSON.stringify({ retained: { extensionSource, runtimeRoot, python }, receipts, GUI: 'NOT_VERIFIED' }, null, 2)); });
