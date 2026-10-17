import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const source = await readFile(new URL('./local-debug-session.mjs', import.meta.url), 'utf8');
const receive = source.slice(source.indexOf('session.receive = async message => {'), source.indexOf("\n        send({ kind: 'ready'"));
const stop = source.slice(source.indexOf('async function stop() {'), source.indexOf('      const timer = setTimeout'));
const current = source.match(/const assertSessionCurrent=\(\)=>\{[^\n]+\};/)?.[0] || '';
assert.ok(receive.includes('terminal = pty.spawn') && stop.includes('sessions.delete(session)'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function deferred() { let release; const promise = new Promise(ok => { release = ok; }); return { promise, release }; }
async function fixture(holdAt, mode = 'terminal') {
  const entered = deferred(), held = deferred(), created = [], writes = [], replies = [];
  const gate = async name => { if (holdAt === name) { entered.release(); await held.promise; } };
  const factory = new AsyncFunction('gate', 'created', 'writes', 'replies', 'join', 'resolve', `
    let terminated=false,stopped=false,faulted=false,stopPromise,terminal,terminalEnded=false;
    let launch={cwd:'/qa/project'},reverse={seq:7,arguments:{kind:'integrated',args:['/usr/bin/python3','/qa/debugpy/launcher','43127','--','/qa/project/main.py'],cwd:'/qa/project'}};
    const socket={destroyed:false,writableEnded:false,end(){this.writableEnded=true;}},context={workspace:'/qa/project'},plugins='/qa/plugins',runtime={root:'/qa/runtime'},cleanupTimeoutMs=100;
    const child={exitCode:0,signalCode:null,stdin:{write(data){writes.push(data);return true;}}},childDone=Promise.resolve();
    const data={env:{},debugpy:'/qa/debugpy',cwd:'/qa/project'},allocation={ports:[43125,43126,43127]},leased=new Set(allocation.ports);
    const session={},sessions=new Set([session]),timer=setTimeout(()=>{},30000);timer.unref();
    const reportCleanup=error=>{throw error;},exec=async()=>{throw Error('unit control must not signal a real PID');};
    const interpreter=async command=>{await gate('interpreter');return command;},within=async path=>{await gate('cwd');return path;};
    const realpath=async path=>{await gate('program-realpath');return path;},canonical=async()=>{await gate('program-canonical');};
    const pathIdentities=[{}],bootstrapProof=undefined,assertWorkspacePathIdentity=async()=>{await gate('proof');};
    const environment=env=>env,inside=(root,path)=>path===root||path.startsWith(root+'/'),encodeDap=JSON.stringify,policy='public-unit-policy';
    const pty={spawn(...args){created.push(args);return {onData(){},onExit(){},kill(){}};}},send=value=>replies.push(value);
    ${stop}
    ${current}
    ${receive}
    return {session,stop,sessions,leased,socket,setStopped(){stopped=true;},setFaulted(){faulted=true;},noLaunch(){launch=undefined;}};
  `);
  const owner = await factory(gate, created, writes, replies, join, resolve);
  if (mode === 'dap') owner.noLaunch();
  const message = mode === 'terminal' ? { op: 'terminal', requestSeq: 7 } : {
    op: 'dap', message: { type: 'request', command: 'launch', arguments: { cwd: '/qa/project', program: 'main.py' } },
  };
  return { owner, message, entered, held, created, writes, replies };
}
for (const holdAt of ['interpreter', 'cwd', 'proof']) {
  test(`Python terminal cannot resurrect after stop during ${holdAt}`, async () => {
    const f = await fixture(holdAt), pending = f.owner.session.receive(f.message);
    await f.entered.promise; await f.owner.stop();
    assert.equal(f.owner.sessions.size, 0); assert.equal(f.owner.leased.size, 0);
    f.held.release(); const error = await pending.then(() => null, error => error);
    assert.equal(f.created.length, 0, 'retired Python session must not call the PTY process creator');
    assert.equal(f.writes.length, 0); assert.match(error?.message || '', /ended|cancel|retired/i);
    assert.deepEqual(f.replies, []); assert.equal(f.owner.sessions.size, 0); assert.equal(f.owner.leased.size, 0);
  });
}
for (const holdAt of ['cwd', 'program-realpath', 'program-canonical']) {
  test(`Python launch cannot write to a retired adapter after ${holdAt}`, async () => {
    const f = await fixture(holdAt, 'dap'), pending = f.owner.session.receive(f.message);
    await f.entered.promise; await f.owner.stop(); f.held.release();
    const error = await pending.then(() => null, error => error);
    assert.equal(f.writes.length, 0, 'retired adapter must not receive a late launch message');
    assert.match(error?.message || '', /ended|cancel|retired/i);
    assert.equal(f.owner.sessions.size, 0); assert.equal(f.owner.leased.size, 0);
  });
}
test('closed or ended requester and stopped/faulted supervisor cannot create Python terminal', async () => {
  for (const invalidate of [f => { f.owner.socket.destroyed = true; }, f => { f.owner.socket.writableEnded = true; }, f => { f.owner.socket.readableEnded = true; }, f => f.owner.setStopped(), f => f.owner.setFaulted()]) {
    const f = await fixture('proof'), pending = f.owner.session.receive(f.message);
    await f.entered.promise; invalidate(f); f.held.release();
    const error = await pending.then(() => null, error => error);
    assert.equal(f.created.length, 0); assert.match(error?.message || '', /ended|cancel|retired/i); await f.owner.stop();
  }
});
test('current Python terminal still starts once, acknowledges, then clears session and leases', async () => {
  const f = await fixture(null); await f.owner.session.receive(f.message);
  assert.equal(f.created.length, 1); assert.equal(f.writes.length, 1);
  assert.equal(f.replies.filter(reply => reply.kind === 'terminalReady').length, 1);
  await f.owner.stop(); assert.equal(f.owner.sessions.size, 0); assert.equal(f.owner.leased.size, 0);
});
test('current Python DAP launch remains writable exactly once', async () => {
  const f = await fixture(null, 'dap'); await f.owner.session.receive(f.message);
  assert.equal(f.created.length, 0); assert.equal(f.writes.length, 1);
  await f.owner.stop(); assert.equal(f.owner.sessions.size, 0); assert.equal(f.owner.leased.size, 0);
});

// Exercise the earlier adapter-spawn continuation too, using its actual
// session registration, current check and allocator/proof await sequence.
const startup = source.slice(source.indexOf('      session = { id: randomUUID()'), source.indexOf('        childDone = new Promise'));
for (const holdAt of ['release', 'proof']) {
  test(`Python adapter cannot start after stop during ${holdAt}`, async () => {
    const entered = deferred(), held = deferred(), created = [];
    const gate = async name => { if (name === holdAt) { entered.release(); await held.promise; } };
    const factory = new AsyncFunction('gate', 'created', 'join', `
      let session,child,childDone,terminal,terminalEnded=false,terminated=false,stopPromise,stopped=false,faulted=false,preparing=1;
      const sessions=new Set(),leased=new Set([1,2,3]),socket={destroyed:false,writableEnded:false};
      const allocation={ports:[1,2,3],release:()=>gate('release')},timer=setTimeout(()=>{},30000);timer.unref();
      const runtime={root:'/qa/runtime'},cleanupTimeoutMs=100,reportCleanup=error=>{throw error;},exec=()=>{throw Error('no real PID in unit control');};
      const randomUUID=()=> 'public-unit-adapter',pathIdentities=[{}],bootstrapProof=undefined,assertWorkspacePathIdentity=()=>gate('proof');
      const policy='public-unit-policy',bootstrap='/qa/bootstrap.py',data={command:'/qa/python',flags:[],debugpy:'/qa/debugpy',args:[],env:{},cwd:'/qa/project'};
      const spawn=(...args)=>{created.push(args);return {};};
      ${stop}
      async function start(){${startup}\n}finally{}}
      return {start,stop,sessions,leased};
    `);
    const owner = await factory(gate, created, join), pending = owner.start();
    await entered.promise; await owner.stop(); held.release();
    const error = await pending.then(() => null, error => error);
    assert.equal(created.length, 0); assert.match(error?.message || '', /cancel|retired/i);
    assert.equal(owner.sessions.size, 0); assert.equal(owner.leased.size, 0);
  });
}
