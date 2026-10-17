import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Execute the actual production start branch and actual retire function.
// Public unit controls deliberately spy on process creation; these are not
// sandbox/runtime, language-debugger or installed-App acceptance claims.
const source = await readFile(new URL('./local-js-debug-session.mjs', import.meta.url), 'utf8');
const start = source.slice(source.indexOf("if(message.op!=='start')"), source.indexOf("\n        if(!entry||entry.phase!=='running')")).trim().replace(/\}$/, '');
const retire = source.slice(source.indexOf('async function retire(entry)'), source.indexOf('  function prepare(consoleMode,noDebug)'));
assert.ok(start.includes('pty.spawn') && retire.includes('launches.delete(entry.id)'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function deferred() { let release; const promise = new Promise(ok => { release = ok; }); return { promise, release }; }
async function fixture(holdAt, debug = false) {
  const held = deferred(), entered = deferred();
  const calls = [], replies = [];
  const gate = async name => { if (name === holdAt) { entered.release(); await held.promise; } };
  const context = { workspace: '/qa/project', ipcTemporary: '/qa/ipc' };
  const entry = { id: 'public-unit-launch', phase: 'prepared', noDebug: !debug, consoleMode: 'integratedTerminal', port: 43125 };
  let exited;
  const child = { pid: 40000, onData: () => ({ dispose() {} }), onExit: callback => { exited = callback; return { dispose() {} }; } };
  const factory = new AsyncFunction('entrySeed', 'context', 'gate', 'child', 'calls', 'replies', 'join', 'resolve', `
    const launches=new Map([[entrySeed.id,entrySeed]]),leased=new Set([entrySeed.port]),socket={destroyed:false};
    let stopped=false,faulted=false;const deadlineMs=30000,workspaceProof={paths:[context.workspace]},pathIdentities=[workspaceProof];
    const inside=(root,path)=>path===root||path.startsWith(root+'/');
    let proofChecks=0;
    const realpath=async path=>{await gate(path.endsWith('.sock')?'ipc-realpath':'realpath');return path;};
    const lstat=async()=>{await gate('ipc-stat');return {isSymbolicLink:()=>false,isSocket:()=>true,uid:process.getuid()};};
    const assertWorkspacePathIdentity=async()=>{await gate(++proofChecks===1?'first-proof':'last-proof');};
    const canonical=async()=>{await gate('canonical');};
    const pty={spawn(...args){calls.push(args);return child;}};
    const runtime={root:'/qa/runtime'},basePolicy='public-unit-policy',extension='/qa/extension',alias='/qa/node',jsDebugSessionPolicy=base=>base;
    const path='/qa/ipc/js-debug.sock',credential='public-unit-only',warn=error=>{throw error;},exec=async()=>{throw Error('unit control must not signal a process');};
    const reply=value=>replies.push(value),relative=(root,path)=>path.slice(root.length+1);
    ${retire}
    async function start(message){let entry;${start}}
    return {start,retire,launches,leased,socket,stop(){stopped=true;},fault(){faulted=true;}};
  `);
  const owner = await factory(entry, context, gate, child, calls, replies, join, resolve);
  const message = { op: 'start', launchId: entry.id, cwd: context.workspace, args: ['main.js'], env: debug ? {
    NODE_OPTIONS: ' --require /qa/extension/src/bootloader.js ',
    VSCODE_INSPECTOR_OPTIONS: JSON.stringify({ inspectorIpc: '/qa/ipc/node-cdp.sock' }),
  } : {} };
  return { owner, entry, message, calls, replies, held, entered, exit: () => exited({ exitCode: 0 }) };
}
for (const holdAt of ['ipc-stat', 'ipc-realpath']) {
  test(`retired debugger cannot spawn after pending ${holdAt} resolves`, async () => {
    const f = await fixture(holdAt, true), pending = f.owner.start(f.message);
    await f.entered.promise; await f.owner.retire(f.entry); f.held.release();
    const error = await pending.then(() => null, error => error);
    assert.equal(f.calls.length, 0); assert.match(error?.message || '', /cancel|retired/i);
    assert.equal(f.owner.launches.size, 0); assert.equal(f.owner.leased.size, 0);
  });
}
for (const holdAt of ['realpath', 'first-proof', 'canonical', 'last-proof']) {
  test(`retired launch cannot spawn after pending ${holdAt} resolves`, async () => {
    const f = await fixture(holdAt), pending = f.owner.start(f.message);
    await f.entered.promise; await f.owner.retire(f.entry);
    assert.equal(f.owner.launches.size, 0); assert.equal(f.owner.leased.size, 0);
    f.held.release();
    const error = await pending.then(() => null, error => error);
    assert.equal(f.calls.length, 0, 'retired request must not reach the process creator');
    assert.match(error?.message || '', /expired|cancel|retired|inactive/i); assert.deepEqual(f.replies, []);
    assert.equal(f.owner.launches.size, 0); assert.equal(f.owner.leased.size, 0);
  });
}
test('closed requester and stopped/faulted supervisor cannot dispatch late process creation', async () => {
  for (const invalidate of [f => { f.owner.socket.destroyed = true; }, f => { f.owner.socket.writableEnded = true; }, f => { f.owner.socket.readableEnded = true; }, f => f.owner.stop(), f => f.owner.fault()]) {
    const f = await fixture('canonical'), pending = f.owner.start(f.message);
    await f.entered.promise; invalidate(f); f.held.release();
    const error = await pending.then(() => null, error => error);
    assert.equal(f.calls.length, 0, 'invalid requester must not reach the process creator');
    assert.match(error?.message || '', /expired|cancel|retired|inactive/i); await f.owner.retire(f.entry);
  }
});
test('current launch still starts once, sends ready and retires after actual exit callback', async () => {
  const f = await fixture(null); await f.owner.start(f.message);
  assert.equal(f.calls.length, 1); assert.equal(f.entry.phase, 'running');
  assert.equal(f.replies.filter(item => item.kind === 'ready').length, 1);
  f.exit(); await f.entry.stopping;
  assert.equal(f.owner.launches.size, 0); assert.equal(f.owner.leased.size, 0);
});
