import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFile(`${root}/${file}`, "utf8");

test("collaboration UI lists durable access and confirms immediate revocation", async () => {
  const panel = await read("frontend/src/collaboration/CollaborationPanel.tsx"),
    client = await read("frontend/src/runtime/client.ts"),
    service = await read("services/collaboration-service/src/service.mjs");
  assert.match(panel, /ACCESS · \{members\.length\}/);
  assert.match(panel, /window\.confirm/);
  assert.match(client + service, /revoke-member-once/);
  assert.match(service, /access-revoked/);
  assert.match(service, /4003/);
  assert.match(service, /currentAccess/);
});

test("collaboration UI retries disconnected rooms only after durable access validation", async () => {
  const panel = await read("frontend/src/collaboration/CollaborationPanel.tsx");
  assert.match(panel, /collaborationAccess\(roomId\)/);
  assert.match(panel, /setReconnectTick/);
  assert.match(panel, /1500/);
  assert.match(panel, /Disconnected rooms\s+retry after 1\.5 seconds and revalidate durable access first/);
  assert.match(panel, /Terminal\s+input remains separately permissioned and off by default/);
});

// R31 executes the original component and its original async/socket callbacks.
// React hook/JSX and WebSocket scheduling are local stand-ins; Yjs is retained
// production Yjs. No network, signed session, room authority or browser runs.
async function collaborationFixture({ heldHealth } = {}) {
  const { createRequire } = await import('node:module');
  const vm = await import('node:vm');
  const require = createRequire(import.meta.url), Y = require('yjs');
  const ts = require('../services/language-service/node_modules/typescript/lib/typescript.js');
  const panel = await read('frontend/src/collaboration/CollaborationPanel.tsx');
  const compiled = ts.transpileModule(panel, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics.length, 0);
  const gates = [], sockets = [], accesses = [], remote = [], checkpoints = [], storage = new Map([['ynx-code-room:TEST_ONLY_project', 'roomA']]);
  const pending = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  const api = {
    runtimeHealth: () => heldHealth?.promise || Promise.resolve({}),
    collaborationAccess: async room => { accesses.push(room); return { role: 'owner', members: [{ subjectId: room + '-member', role: 'owner' }] }; },
    redeemCollaborationInvite: async () => ({ roomId: 'roomB', role: 'owner' }),
  };
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.listeners = new Map(); const index = sockets.push(this) - 1; gates[index]?.resolve(this); }
    addEventListener(kind, listener) { this.listeners.set(kind, listener); }
    send() {}
    close() { this.readyState = 3; }
    emit(value) { this.listeners.get('message')({ data: JSON.stringify(value) }); }
  }
  const hooks = [], effects = []; let index = 0, pendingEffects = [], tree;
  const react = {
    useState(initial) { const slot = index++; if (!hooks[slot]) hooks[slot] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[slot].value, value => { hooks[slot].value = typeof value === 'function' ? value(hooks[slot].value) : value; }]; },
    useRef(initial) { const slot = index++; if (!hooks[slot]) hooks[slot] = { current: initial }; return hooks[slot]; },
    useEffect(callback, deps) { const slot = index++, previous = effects[slot]; if (!previous || deps.some((value, at) => value !== previous.deps[at])) pendingEffects.push(() => { previous?.cleanup?.(); effects[slot] = { deps, cleanup: callback() }; }); },
  };
  const jsx = (type, props) => ({ type, props }), module = { exports: {} };
  vm.runInNewContext(compiled.outputText, { exports: module.exports, require: id => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (id === 'yjs') return Y;
    if (id === '../runtime/client') return api;
    if (id === '../components/ui/button') return { Button: 'button' };
    throw Error('Unexpected component dependency ' + id);
  }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, WebSocket: Socket, location: { protocol: 'https:', host: 'TEST_ONLY.invalid' }, setTimeout, clearTimeout, btoa, atob, Uint8Array, window: { confirm: () => true } });
  const props = { projectId: 'TEST_ONLY_project', files: {}, cursor: { path: '', anchor: 0, head: 0 }, onRemoteFiles: files => remote.push(files), onCheckpoint: revision => checkpoints.push(revision), onAccessChange() {}, onSessionChange() {}, onLeave: async () => {} };
  const render = () => { index = 0; pendingEffects = []; tree = module.exports.CollaborationPanel(props); for (const effect of pendingEffects) effect(); return tree; };
  const nodes = () => { const all = []; const visit = value => { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') { all.push(value); visit(value.props?.children); } }; visit(tree); return all; };
  const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null || typeof value === 'boolean' ? '' : String(value);
  const button = label => { const node = nodes().find(node => node.type === 'button' && text(node.props.children) === label); assert.ok(node, label); return node.props.onClick; };
  const socket = async at => { if (sockets[at]) return sockets[at]; gates[at] ||= pending(); return gates[at].promise; };
  const join = async () => { const input = nodes().find(node => node.props?.placeholder === 'Paste 43-character token'); assert.ok(input); input.props.onChange({ target: { value: 'x'.repeat(43) } }); render(); await button('Join workspace')(); render(); const ws = await socket(1); render(); return ws; };
  render();
  return { api, accesses, sockets, socket, render, button, join, remote, checkpoints, text: () => text(tree), dispose: () => { for (const effect of effects) effect?.cleanup?.(); }, pending };
}

test('R31 departed-room membership refresh cannot overwrite the new room', async () => {
  const f = await collaborationFixture(), old = await f.socket(0), refresh = f.pending(); f.render();
  f.api.collaborationAccess = async room => { f.accesses.push(room); return room === 'roomA' ? refresh.promise : { role: 'owner', members: [{ subjectId: 'roomB-member', role: 'owner' }] }; };
  old.emit({ type: 'presence', action: 'join', clientId: 'TEST_ONLY_joiner' });
  await f.button('Disconnect')(); f.render(); await f.join();
  assert.match(f.text(), /roomB-member/); refresh.resolve({ role: 'owner', members: [{ subjectId: 'STALE-roomA-member', role: 'owner' }] }); await refresh.promise; await Promise.resolve(); f.render();
  assert.match(f.text(), /roomB-member/); assert.doesNotMatch(f.text(), /STALE-roomA-member/); f.dispose();
});

test('R31 leaving during health preflight does not enter a retired room access call', async () => {
  let resolve; const heldHealth = { promise: new Promise(r => { resolve = r; }) }; const f = await collaborationFixture({ heldHealth });
  await f.button('Disconnect')(); f.render(); resolve({}); await heldHealth.promise; await Promise.resolve();
  assert.deepEqual(f.accesses, []); assert.equal(f.sockets.length, 0); f.dispose();
});

test('R31 current room membership refresh still updates its actual panel', async () => {
  const f = await collaborationFixture(), ws = await f.socket(0), refresh = f.pending(); f.render();
  f.api.collaborationAccess = () => refresh.promise; ws.emit({ type: 'presence', action: 'join', clientId: 'TEST_ONLY_joiner' });
  refresh.resolve({ role: 'owner', members: [{ subjectId: 'CURRENT-member', role: 'editor' }] }); await refresh.promise; await Promise.resolve(); f.render();
  assert.match(f.text(), /CURRENT-member/); f.dispose();
});
