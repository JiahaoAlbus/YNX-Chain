import assert from "node:assert/strict";
import test from "node:test";
import { applyPackageMetadata, mergeTerminalFiles, mergeStoppedTerminalWorkspace, persistTerminalWorkspace, stopSelectedTerminals, terminalCommonBase } from "../src/terminal/admission.ts";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("selected terminal stop and synchronization completes before package admission", async () => {
  const events = [], stopped = deferred(); let live = true;
  const work = stopSelectedTerminals("ours", async () => live ? [{ sessionId: "a", runtimeId: "ours" }, { sessionId: "b", runtimeId: "other" }] : [{ sessionId: "b", runtimeId: "other" }], async id => { events.push(`stop:${id}`); await stopped.promise; live = false; events.push("synced"); });
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(events, ["stop:a"]);
  stopped.resolve(); await work; events.push("install"); assert.deepEqual(events, ["stop:a", "synced", "install"]);
});
test("failed Stop and retained terminal prohibit package admission", async () => {
  const list = async () => [{ sessionId: "a", runtimeId: "ours" }];
  await assert.rejects(stopSelectedTerminals("ours", list, async () => { throw new Error("Remote child remains"); }), /child remains/);
  await assert.rejects(stopSelectedTerminals("ours", list, async () => {}), /still active/);
});
test("edits arriving during the real async save boundary are retained and stop installation", async () => {
  let editor = "original"; const saving = deferred(); let install = false;
  const operation = persistTerminalWorkspace(editor, () => editor, () => saving.promise).then(() => { install = true; });
  editor = "new local edits"; saving.resolve({ revision: 2 });
  await assert.rejects(operation, /Edits made during/); assert.equal(editor, "new local edits"); assert.equal(install, false);
});
test("metadata arriving after local package edits cannot overwrite them", async () => {
  const expected = { "package.json": "before", "package-lock.json": "lock1", "main.js": "source" }, installation = deferred();
  let local = { ...expected };
  const operation = installation.promise.then(updates => ({ updates, next: applyPackageMetadata(local, expected, updates) }));
  local["package.json"] = "new user manifest"; installation.resolve({ "package.json": "installed manifest", "package-lock.json": "lock2" });
  const result = await operation; assert.equal(result.next, null); assert.equal(local["package.json"], "new user manifest"); assert.equal(result.updates["package-lock.json"], "lock2");
});
test("online admission keeps the original common base when remote revision advances", () => {
  const base = JSON.stringify({ files: { "a.js": "base" } }), remote = JSON.stringify({ files: { "a.js": "remote edit" } });
  assert.equal(terminalCommonBase(base, remote, 1, 2), base);
  assert.equal(terminalCommonBase("", remote, 1, 2), "");
  assert.throws(() => mergeTerminalFiles(JSON.parse(base).files, { "a.js": "local edit" }, JSON.parse(remote).files), /conflict/);
});
test("disjoint edits merge while delete/edit conflicts retain both inputs", () => {
  assert.deepEqual(mergeTerminalFiles({ a: "1", b: "1" }, { a: "2", b: "1" }, { a: "1", b: "3" }), { a: "2", b: "3" });
  const ours = {}, theirs = { a: "changed" }; assert.throws(() => mergeTerminalFiles({ a: "before" }, ours, theirs), /conflict/); assert.deepEqual(theirs, { a: "changed" }); assert.deepEqual(ours, {});
});
test("terminal-created files and local tab navigation survive stop together", () => {
  const base = { name: "project", files: { "main.cpp": "compiled", "README.md": "readme" }, folders: [], open: ["main.cpp"], active: "main.cpp" };
  const local = { ...base, open: ["main.cpp", "README.md"], active: "README.md" };
  const remote = { ...base, files: { ...base.files, "native-qa-note.txt": "PTY marker\n" } };
  const merged = mergeStoppedTerminalWorkspace(base, local, remote);
  assert.equal(merged.files["native-qa-note.txt"], "PTY marker\n");
  assert.equal(merged.active, "README.md"); assert.deepEqual(merged.open, local.open);
});
test("stop merges disjoint unsaved edits and refuses same-file or project-name conflicts", () => {
  const base = { name: "project", files: { a: "base", b: "base" }, folders: [], open: ["a"], active: "a" };
  const local = { ...base, files: { ...base.files, a: "unsaved" } };
  const remote = { ...base, files: { ...base.files, b: "terminal" } };
  assert.deepEqual(mergeStoppedTerminalWorkspace(base, local, remote).files, { a: "unsaved", b: "terminal" });
  assert.throws(() => mergeStoppedTerminalWorkspace(base, local, { ...remote, files: { ...remote.files, a: "terminal edit" } }), /conflict/);
  assert.throws(() => mergeStoppedTerminalWorkspace(base, { ...local, name: "ours" }, { ...remote, name: "theirs" }), /names conflict/);
  assert.equal(local.files.a, "unsaved"); assert.equal(remote.files.b, "terminal");
});

// R33 runs the original InteractiveTerminal component callbacks with controlled
// hook, socket and service scheduling. This is source lifecycle evidence only;
// no browser, native input, signed service or real terminal process is used.
async function terminalCallerFixture({ health } = {}) {
  const { readFile } = await import('node:fs/promises');
  const { createRequire } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  const require = createRequire(import.meta.url), ts = require('../../services/language-service/node_modules/typescript/lib/typescript.js');
  const source = await readFile(new URL('../src/terminal/TerminalPanel.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics.length, 0);
  const hooks = [], effects = [], sockets = [], instances = [], active = [], synced = [], stops = [], loads = [], storage = new Map();
  let index = 0, pendingEffects = [], tree;
  const react = {
    useState(initial) { const slot = index++; hooks[slot] ||= { value: initial }; return [hooks[slot].value, value => { hooks[slot].value = typeof value === 'function' ? value(hooks[slot].value) : value; }]; },
    useRef(initial) { const slot = index++; hooks[slot] ||= { current: initial }; return hooks[slot]; },
    useEffect(callback, deps) { const slot = index++, previous = effects[slot]; if (!previous || deps.some((value, at) => value !== previous.deps[at])) pendingEffects.push(() => { previous?.cleanup?.(); effects[slot] = { deps, cleanup: callback() }; }); },
  };
  class Terminal {
    constructor() { this.lines = []; this.cols = 80; this.rows = 24; instances.push(this); }
    loadAddon() {} open() {} writeln(line) { this.lines.push(line); } write(line) { this.lines.push(line); }
    onData() { return { dispose() {} }; } dispose() { this.disposed = true; }
  }
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 1; this.listeners = new Map(); this.sent = []; sockets.push(this); }
    addEventListener(kind, callback) { this.listeners.set(kind, callback); }
    send(value) { this.sent.push(JSON.parse(value)); } close() { this.readyState = 3; }
    emit(kind, value) { this.listeners.get(kind)?.(kind === 'message' ? { data: JSON.stringify(value) } : value); }
  }
  const api = {
    runtimeHealth: () => health?.promise || Promise.resolve({}),
    stopTerminalSession: async id => { stops.push(id); },
    loadWorkspace: async id => { loads.push(id); return { revision: 7 }; },
  };
  const jsx = (type, props) => ({ type, props }), exports = {};
  runInNewContext(compiled.outputText, { exports, require: id => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id === '@xterm/xterm') return { Terminal };
    if (id === '@xterm/addon-fit') return { FitAddon: class { fit() {} } };
    if (id === '../runtime/client') return api;
    throw Error('Unexpected terminal dependency ' + id);
  }, Error, URLSearchParams, WebSocket: Socket, ResizeObserver: class { observe() {} disconnect() {} }, location: { protocol: 'https:', host: 'TEST_ONLY.invalid' }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
  const props = { projectId: 'TEST_ONLY_A', runtimeId: 'runtimeA', onWorkspaceSync: revision => synced.push(revision), onActive: value => active.push(value) };
  const render = (next = {}) => { Object.assign(props, next); index = 0; pendingEffects = []; tree = exports.InteractiveTerminal(props); const attach = node => { if (Array.isArray(node)) node.forEach(attach); else if (node && typeof node === 'object') { if (node.props?.ref) node.props.ref.current = {}; attach(node.props?.children); } }; attach(tree); for (const effect of pendingEffects) effect(); };
  const button = label => { let found; const visit = node => { if (Array.isArray(node)) node.forEach(visit); else if (node && typeof node === 'object') { if (node.type === 'button' && node.props.children === label) found = node; visit(node.props?.children); } }; visit(tree); assert.ok(found, label); return found.props; };
  const settle = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); render(); };
  const ready = (socket = sockets.at(-1), id = 'TEST_ONLY_sessionA') => { socket.emit('message', { type: 'ready', sessionId: id, sandbox: { kind: 'TEST_ONLY' } }); render(); };
  const key = () => `ynx-code-terminal:${props.projectId}:${props.runtimeId}`;
  const dispose = () => { for (const effect of effects) effect?.cleanup?.(); };
  render(); await settle();
  return { api, props, render, button, settle, ready, key, sockets, instances, active, synced, stops, loads, storage, dispose };
}

test('R33 completed Stop from departed project cannot load or stop its successor UI', async () => {
  const f = await terminalCallerFixture(), stop = deferred(); f.ready();
  f.api.stopTerminalSession = id => { f.stops.push(id); return stop.promise; };
  f.button('Stop').onClick(); f.render({ projectId: 'TEST_ONLY_B' }); await f.settle(); f.ready(undefined, 'TEST_ONLY_sessionB');
  stop.resolve(); await f.settle();
  assert.deepEqual(f.stops, ['TEST_ONLY_sessionA']); assert.deepEqual(f.loads, []); assert.deepEqual(f.synced, []);
  assert.equal(f.button('Stop').disabled, false); assert.equal(f.active.at(-1), true); assert.equal(f.storage.get(f.key()), 'TEST_ONLY_sessionB'); f.dispose();
});
test('R33 rejected Stop from departed project cannot write recovery into successor terminal', async () => {
  const f = await terminalCallerFixture(); let reject;
  const pending = new Promise((_, fail) => { reject = fail; }); f.ready(); f.api.stopTerminalSession = () => pending;
  f.button('Stop').onClick(); f.render({ projectId: 'TEST_ONLY_B' }); await f.settle(); f.ready(undefined, 'TEST_ONLY_sessionB');
  reject(Error('TEST_ONLY_old_UNKNOWN')); await f.settle();
  assert.doesNotMatch(f.instances.at(-1).lines.join('\n'), /old_UNKNOWN/); assert.equal(f.button('Stop').disabled, false); f.dispose();
});
test('R33 Stop followed by runtime switch and return retains newly admitted session identity', async () => {
  const f = await terminalCallerFixture(), stop = deferred(); f.ready(); f.api.stopTerminalSession = () => stop.promise;
  f.button('Stop').onClick(); f.render({ runtimeId: 'runtimeB' }); await f.settle(); f.render({ runtimeId: 'runtimeA' }); await f.settle(); f.ready(undefined, 'TEST_ONLY_sessionB');
  stop.resolve(); await f.settle(); assert.equal(f.storage.get(f.key()), 'TEST_ONLY_sessionB'); assert.equal(f.button('Stop').disabled, false); f.dispose();
});
test('R33 workspace load finishing after terminal departure cannot synchronize successor', async () => {
  const f = await terminalCallerFixture(), load = deferred(); f.ready(); f.api.loadWorkspace = id => { f.loads.push(id); return load.promise; };
  f.button('Stop').onClick(); await f.settle(); assert.equal(f.loads.length, 1);
  f.render({ runtimeId: 'runtimeB' }); await f.settle(); f.ready(undefined, 'TEST_ONLY_sessionB');
  load.resolve({ revision: 999 }); await f.settle(); assert.deepEqual(f.synced, []); assert.equal(f.button('Stop').disabled, false); f.dispose();
});
test('R33 terminal closed during admission never creates a late socket', async () => {
  const health = deferred(), f = await terminalCallerFixture({ health }); f.dispose(); health.resolve({}); await f.settle(); assert.equal(f.sockets.length, 0);
});
test('R33 late open callback cannot send into a disposed terminal transport', async () => {
  const f = await terminalCallerFixture(), old = f.sockets[0]; f.dispose(); old.emit('open', {}); assert.equal(old.sent.length, 0);
});
test('R33 queued workspace sync does not enter callback after terminal departure', async () => {
  const f = await terminalCallerFixture(), sync = deferred(), calls = []; f.props.onWorkspaceSync = revision => { calls.push(revision); return sync.promise; }; f.render(); await f.settle(); f.ready();
  const old = f.sockets.at(-1); old.emit('message', { type: 'workspace-synced', revision: 1 }); await f.settle(); old.emit('message', { type: 'workspace-synced', revision: 2 });
  f.render({ runtimeId: 'runtimeB' }); await f.settle(); sync.resolve(); await f.settle(); assert.deepEqual(calls, [1]); f.dispose();
});
test('R33 current Stop keeps actual session id and synchronizes before becoming stopped', async () => {
  const f = await terminalCallerFixture(); f.ready(); f.button('Stop').onClick(); await f.settle();
  assert.deepEqual(f.stops, ['TEST_ONLY_sessionA']); assert.deepEqual(f.loads, ['TEST_ONLY_A']); assert.deepEqual(f.synced, [7]); assert.equal(f.active.at(-1), false); assert.equal(f.storage.has(f.key()), false); assert.equal(f.button('Stop').disabled, true); f.dispose();
});

test('R33 repeated current Stop callback dispatches its selected session once', async () => {
  const f = await terminalCallerFixture(), stop = deferred(); f.ready(); f.api.stopTerminalSession = id => { f.stops.push(id); return stop.promise; };
  const click = f.button('Stop').onClick; click(); click(); assert.deepEqual(f.stops, ['TEST_ONLY_sessionA']);
  stop.resolve(); await f.settle(); assert.deepEqual(f.synced, [7]); f.dispose();
});
test('R33 current unknown Stop failure retains first cause and session for explicit retry', async () => {
  const f = await terminalCallerFixture(); f.ready(); f.api.stopTerminalSession = async () => { throw Error('TEST_ONLY_original_UNKNOWN'); };
  f.button('Stop').onClick(); await f.settle(); assert.match(f.instances.at(-1).lines.join('\n'), /TEST_ONLY_original_UNKNOWN/);
  assert.equal(f.storage.get(f.key()), 'TEST_ONLY_sessionA'); assert.deepEqual(f.loads, []); assert.equal(f.button('Retry Stop').disabled, false); assert.equal(f.active.at(-1), true);
  f.api.stopTerminalSession = async id => { f.stops.push(id); }; f.button('Retry Stop').onClick(); await f.settle(); assert.deepEqual(f.stops, ['TEST_ONLY_sessionA']); assert.deepEqual(f.synced, [7]); f.dispose();
});
test('R33 departure during already entered workspace synchronization cannot finish successor Stop', async () => {
  const f = await terminalCallerFixture(), sync = deferred(); f.props.onWorkspaceSync = () => sync.promise; f.render(); await f.settle(); f.ready();
  f.button('Stop').onClick(); await f.settle(); f.render({ projectId: 'TEST_ONLY_B' }); await f.settle(); f.ready(undefined, 'TEST_ONLY_sessionB');
  sync.resolve(); await f.settle(); assert.equal(f.button('Stop').disabled, false); assert.equal(f.storage.get(f.key()), 'TEST_ONLY_sessionB'); assert.equal(f.active.at(-1), true); f.dispose();
});
