import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, realpath } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { CppDebugTerminalContribution } = require('../../ynx-workbench/lib/cpp-debug-terminal');
const { createCppTerminalDevice } = require('../../ynx-workbench/lib/cpp-terminal-device');
const id = '12345678-1234-4234-8234-123456789012';
function event() { const listeners = new Set(); return { subscribe(fn) { listeners.add(fn); return { dispose() { listeners.delete(fn); } }; }, fire(v) { for (const fn of [...listeners]) fn(v); } }; }
function setup() {
  const created = event(), destroyed = event(), closed = event(), disposed = event(); let close = 0, opens = 0;
  const terminal = { terminalId: -1, dispose() { disposed.fire(); }, onTerminalDidClose: fn => closed.subscribe(fn), onDidDispose: fn => disposed.subscribe(fn), async start() { this.terminalId = 2; }, shellTerminalServer: { async close() { close++; closed.fire(); } } };
  class URI { constructor(value) { this.value = value; } withScheme() { return this; } toString() { return 'file://' + this.value; } }
  const terminals = { async newTerminal() { return terminal; }, async open() { opens++; } };
  const context = { async getContext() { return { mode: 'local', workspace: '/project' }; }, async getCppTerminalDevice() { return { device: '/dev/ttys001' }; } };
  const contribution = new CppDebugTerminalContribution(context, terminals, { onDidCreateDebugSession: fn => created.subscribe(fn), onDidDestroyDebugSession: fn => destroyed.subscribe(fn) }, URI, () => {}); contribution.initialize();
  return { contribution, terminals, terminal, context, created, destroyed, closed, disposed, counts: () => ({close, opens}) };
}
test('real terminal endpoint is scoped to the current owned non-pseudo process', async () => {
  const workspace = await realpath(await mkdtemp('/private/tmp/ynx-cpp-device-'));
  class TerminalProcess {} const terminal = new TerminalProcess();
  terminal.options = { command: '/usr/bin/tail', args: ['-f', '/dev/null'], options: { cwd: workspace, env: { YNX_CPP_DEBUG_TERMINAL: id } } }; terminal.pid = 45; terminal.terminal = { ptsName: '/dev/ttys001' };
  const api = createCppTerminalDevice({ get: n => n === 2 ? terminal : undefined }, TerminalProcess, { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: workspace });
  assert.deepEqual(await api(2, id, workspace), { device: '/dev/ttys001' });
  await assert.rejects(api(2,id,'/other')); await assert.rejects(api(3,id,workspace)); await assert.rejects(api(2,'invalid',workspace));
  terminal.options.isPseudo = true; await assert.rejects(api(2,id,workspace)); terminal.options.isPseudo = false;
  terminal.options.options.env.YNX_CPP_DEBUG_TERMINAL = 'different'; await assert.rejects(api(2,id,workspace)); terminal.options.options.env.YNX_CPP_DEBUG_TERMINAL = id;
  terminal.terminal.ptsName = '/dev/ttys001; evil'; await assert.rejects(api(2,id,workspace));
});
test('pending terminal creation cancellation closes eventual PTY without opening or resurrecting request', async () => {
  const h=setup(); let resolve; h.terminals.newTerminal = () => new Promise(r => resolve = r);
  const preparing = h.contribution.prepare(id,'/project'); await Promise.resolve();
  await h.contribution.release(id); resolve(h.terminal); await assert.rejects(preparing,/ended/);
  // No start ran, so no backend process exists to close.
  assert.deepEqual(h.counts(),{close:0,opens:0}); assert.equal(h.contribution.records.size,0);
});
test('cancellation during PTY start closes its eventual backend process exactly once', async () => {
  const h=setup(); let resolve; h.terminal.start = () => new Promise(r => resolve=()=>{ h.terminal.terminalId=2;r(); });
  const preparing = h.contribution.prepare(id,'/project'); await Promise.resolve(); await Promise.resolve();
  await h.contribution.release(id); resolve(); await assert.rejects(preparing,/ended/);
  assert.deepEqual(h.counts(),{close:1,opens:0}); assert.equal(h.contribution.records.size,0);
});
test('session destruction closes only its matching terminal and preserves the widget output', async () => {
  const h=setup(); await h.contribution.prepare(id,'/project'); let stops=0;
  const session = { configuration:{type:'lldb-dap',__ynxCppRunId:id}, options:{workspaceFolderUri:'file:///project'}, isStopping:true, async stop(){stops++;} };
  h.created.fire(session); h.destroyed.fire({...session}); await Promise.resolve(); assert.equal(h.counts().close,0);
  h.destroyed.fire(session); await h.contribution.release(id); assert.equal(h.counts().close,1); assert.equal(stops,0); assert.equal(h.contribution.records.size,0);
});
test('closing the owned terminal stops its associated debug session and permits retry', async () => {
  const h=setup(); await h.contribution.prepare(id,'/project'); let stops=0;
  const session = { configuration:{type:'lldb-dap',__ynxCppRunId:id}, options:{workspaceFolderUri:'file:///project'}, async stop(){stops++; this.isStopping=true;} };
  h.created.fire(session); h.closed.fire(); await h.contribution.release(id);
  assert.equal(stops,1); assert.equal(h.counts().close,1); await h.contribution.prepare(id,'/project'); await h.contribution.release(id); assert.equal(h.counts().close,2);
});
test('endpoint failure and invalid workspace never leave a running holder', async () => {
  const h=setup(); await assert.rejects(h.contribution.prepare(id,'/other')); assert.equal(h.counts().close,0);
  h.context.getCppTerminalDevice = async()=>{throw Error('denied');}; await assert.rejects(h.contribution.prepare(id,'/project'),/denied/); assert.equal(h.counts().close,1);
});

test('duplicate concurrent requests cannot create a second terminal while context is pending', async () => {
 const h=setup();let resolve;h.context.getContext=()=>new Promise(r=>resolve=r);const first=h.contribution.prepare(id,'/project');await assert.rejects(h.contribution.prepare(id,'/project'),/invalid/);resolve({mode:'local',workspace:'/project'});await first;assert.equal(h.counts().opens,1);await h.contribution.release(id);
});

test('closing before session creation retains an ended owner and stops the late debugger', async () => {
 const h=setup();await h.contribution.prepare(id,'/project');await h.contribution.release(id);let stops=0;const session={configuration:{type:'lldb-dap',__ynxCppRunId:id},options:{workspaceFolderUri:'file:///project'},async stop(){stops++;this.isStopping=true;}};h.created.fire(session);await Promise.resolve();assert.equal(stops,1);h.destroyed.fire(session);await h.contribution.release(id,true);assert.equal(h.contribution.records.size,0);assert.equal(h.counts().close,1);
});
