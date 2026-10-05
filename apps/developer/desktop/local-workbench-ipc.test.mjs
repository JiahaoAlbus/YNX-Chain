import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, lstat, writeFile, readFile, rm, symlink, rename, chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createLocalIpcSession, reclaimLocalIpcSessions, localIpcRoot } from './local-workbench-ipc.mjs';
import { localProjectContext, localWorkbenchEnvironment, localWorkbenchSandboxPolicy } from './local-workbench.mjs';
const node = await realpath(fileURLToPath(new URL('../.ynx-developer-candidates/ynx-native-folder-native-7cbf63638-20261005/YNX Developer Testnet Preview.app/Contents/Resources/runtime/node', import.meta.url)));
const socketName = 'node-cdp.40672-ac189868-0.sock';
const run = (policy, env, cwd, program) => spawnSync('/usr/bin/sandbox-exec', ['-p', policy, node, '-e', program], { env, cwd, encoding: 'utf8', timeout: 5000 });
const exchange = `const n=require('net'),p=require('path').join(require('os').tmpdir(),${JSON.stringify(socketName)});const s=n.createServer(c=>c.end('IPC_OK'));s.on('error',e=>{console.log(JSON.stringify({code:e.code,bytes:Buffer.byteLength(p)}));process.exitCode=1});s.listen(p,()=>{const c=n.connect(p);c.on('data',d=>console.log(String(d)));c.on('end',()=>s.close());c.on('error',e=>{console.log(e.code);process.exitCode=2;s.close()})});`;
async function fixture(task) {
  const root = await realpath(await mkdtemp('/private/tmp/ynx-ipc-test-'));
  const sessions = [];
  try {
    const workspace = join(root, '中文 workspace with spaces'); await mkdir(workspace);
    const context = await localProjectContext({ supportRoot: join(root, 'Library/Application Support/YNXDeveloper'), projectDirectory: workspace });
    const session = await createLocalIpcSession(context); sessions.push(session);
    const c = { ...context, ipcTemporary: session.path }, runtime = { root };
    const input = { node, lockHelper: '/usr/bin/true', runtime, context: c, port: 43119, plugins: root };
    await task({ root, context: c, runtime, input, session, sessions, env: localWorkbenchEnvironment(input), policy: localWorkbenchSandboxPolicy(input) });
  } finally {
    for (const session of sessions) try { await session.cleanup({ confirmedExited: true }); } catch {}
    await rm(root, { recursive: true, force: true });
  }
}
test('same exact packaged Node and policy confirm long EINVAL, short denied EPERM, scoped Unix IPC succeeds twice', async () => fixture(async f => {
  assert.equal(spawnSync(node, ['--version'], { encoding: 'utf8' }).stdout.trim(), 'v26.7.0');
  const oldContext = { ...f.context }; delete oldContext.ipcTemporary;
  const oldInput = { ...f.input, context: oldContext }, oldPolicy = localWorkbenchSandboxPolicy(oldInput);
  const old = run(oldPolicy, localWorkbenchEnvironment(oldInput), f.context.workspace, exchange);
  assert.equal(old.status, 1); assert.equal(JSON.parse(old.stdout).code, 'EINVAL');
  const shortDenied = run(f.policy.split('\n').filter(line => !line.includes('unix-socket')).join('\n'), f.env, f.context.workspace, exchange);
  assert.equal(shortDenied.status, 1); assert.equal(JSON.parse(shortDenied.stdout).code, 'EPERM');
  for (let i = 0; i < 2; i++) { const good = run(f.policy, f.env, f.context.workspace, exchange); assert.equal(good.status, 0, good.stderr); assert.equal(good.stdout.trim(), 'IPC_OK'); }
  assert.ok(Buffer.byteLength(join(f.session.path, socketName)) <= 103);
  assert.match(f.policy, /\(deny network\*\)/); assert.doesNotMatch(f.policy, /localhost:\*|unix-socket \(subpath "\/private\/tmp"/);
}));
test('environment is a bounded child-only short-root injection; user/project/profile and sealed copies stay unchanged', async () => fixture(async f => {
  for (const key of ['TMPDIR', 'TMP', 'TEMP', 'XDG_RUNTIME_DIR']) assert.equal(f.env[key], f.session.path);
  assert.equal(f.env.YNX_LOCAL_WORKSPACE, f.context.workspace); assert.equal(f.env.YNX_LOCAL_PROFILE, f.context.profile);
  assert.notEqual(f.context.temporary, f.session.path); assert.match(f.context.temporary, /local-projects\/[a-f0-9]{64}\/tmp$/);
  assert.equal(f.env.HOME, undefined); assert.equal(f.env.YNX_CORE_SESSION_ID, undefined);
  assert.equal((await lstat(localIpcRoot())).mode & 0o777, 0o700); assert.equal((await lstat(f.session.path)).mode & 0o777, 0o700);
  const marker = JSON.parse(await readFile(f.session.path + '.json'));
  assert.equal(marker.projectId, f.context.id); assert.equal(marker.ownerPid, process.pid); assert.equal(marker.phase, 'prepared');
  assert.equal((await lstat(f.session.path + '.json')).mode & 0o777, 0o600);
}));
test('two project sessions communicate independently but cannot bind/connect across sessions or elsewhere; TCP remains refused', async () => fixture(async f => {
  const other = join(f.root, 'another project'); await mkdir(other);
  const context = await localProjectContext({ supportRoot: join(f.root, 'other-support'), projectDirectory: other });
  const second = await createLocalIpcSession(context); f.sessions.push(second);
  assert.notEqual(second.path, f.session.path);
  const otherInput = { ...f.input, context: { ...context, ipcTemporary: second.path } };
  const secondRun = run(localWorkbenchSandboxPolicy(otherInput), localWorkbenchEnvironment(otherInput), other, exchange);
  assert.equal(secondRun.status, 0, secondRun.stderr);
  const socket = join(second.path, 'outside.sock'), server = createServer(c => c.end('UNEXPECTED'));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  try {
    const denied = run(f.policy, f.env, f.context.workspace, `const c=require('net').connect(${JSON.stringify(socket)});c.on('error',e=>{console.log(e.code);process.exitCode=1});c.on('data',d=>console.log(String(d)));`);
    assert.equal(denied.status, 1); assert.match(denied.stdout, /EPERM|EACCES/); assert.doesNotMatch(denied.stdout, /UNEXPECTED/);
    const alias = join(f.session.path, 'foreign-socket'); await symlink(socket, alias);
    const aliasDenied = run(f.policy, f.env, f.context.workspace, `const c=require('net').connect(${JSON.stringify(alias)});c.on('error',e=>{console.log(e.code);process.exitCode=1});c.on('data',d=>console.log(String(d)));`);
    assert.equal(aliasDenied.status, 1); assert.match(aliasDenied.stdout, /EPERM|EACCES/); assert.doesNotMatch(aliasDenied.stdout, /UNEXPECTED/);
  } finally { await new Promise(resolve => server.close(resolve)); }
  for (const path of [join(second.path, 'denied.sock'), join(f.context.workspace, 'outside.sock')]) {
    const result = run(f.policy, f.env, f.context.workspace, `const s=require('net').createServer();s.on('error',e=>{console.log(e.code);process.exitCode=1});s.listen(${JSON.stringify(path)},()=>s.close());`);
    assert.equal(result.status, 1); assert.match(result.stdout, /EPERM|EACCES/);
  }
  const tcp = run(f.policy, f.env, f.context.workspace, `const s=require('net').createServer();s.on('error',e=>{console.log(e.code);process.exitCode=1});s.listen(0,'127.0.0.1',()=>s.close());`);
  assert.equal(tcp.status, 1); assert.match(tcp.stdout, /EPERM/);
}));
test('socket conflict is a real failure, not a fallback or silent replacement', async () => fixture(async f => {
  const socket = join(f.session.path, socketName), server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  try { const result = run(f.policy, f.env, f.context.workspace, exchange); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).code, 'EADDRINUSE'); }
  finally { await new Promise(resolve => server.close(resolve)); }
}));
test('cleanup waits for actual backend exit, removes only its session, and is idempotent', async () => fixture(async f => {
  await f.session.beginLaunch();
  const child = spawn(node, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], { env: f.env, stdio: ['ignore','pipe','pipe'] });
  const closed = once(child, 'close');
  try {
    await once(child.stdout, 'data'); await f.session.attach(child.pid);
    assert.equal(await f.session.cleanup(), false); assert.equal((await lstat(f.session.path)).isDirectory(), true);
    child.kill('SIGKILL'); await closed;
    await writeFile(join(f.session.path, 'crash-residue'), 'owned scratch');
    assert.equal(await f.session.cleanup(), true); assert.equal(await f.session.cleanup(), true);
    await assert.rejects(lstat(f.session.path), { code: 'ENOENT' }); await assert.rejects(lstat(f.session.path + '.json'), { code: 'ENOENT' });
    assert.equal((await lstat(f.context.workspace)).isDirectory(), true); assert.equal((await lstat(f.context.profile)).isDirectory(), true);
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; } }
}));
test('safe crash reclaim checks leases; launching/live/corrupt entries remain untouched', async () => fixture(async f => {
  const a = await createLocalIpcSession(f.context), b = await createLocalIpcSession(f.context), c = await createLocalIpcSession(f.context); f.sessions.push(a,b,c);
  const abandoned = JSON.parse(await readFile(a.path + '.json')); abandoned.ownerPid = 2147483647; await writeFile(a.path + '.json', JSON.stringify(abandoned));
  const uncertain = JSON.parse(await readFile(b.path + '.json')); uncertain.ownerPid = 2147483647; uncertain.phase = 'launching'; await writeFile(b.path + '.json', JSON.stringify(uncertain));
  await writeFile(c.path + '.json', '{}');
  const result = await reclaimLocalIpcSessions(); assert.ok(result.removed >= 1); assert.ok(result.retained >= 3);
  await assert.rejects(lstat(a.path), { code:'ENOENT' }); assert.equal((await lstat(b.path)).isDirectory(), true); assert.equal((await lstat(c.path)).isDirectory(), true);
  // These intentionally changed leases are not valid helper handles; fixture cleanup is exact-path only.
  for (const item of [b,c]) { await rm(item.path, { recursive:true }); await rm(item.path + '.json'); }
}));
test('open orphan file/socket prevents stale reclaim until the real user closes it', async () => fixture(async f => {
  const marker = JSON.parse(await readFile(f.session.path + '.json')); marker.ownerPid = 2147483647; await writeFile(f.session.path + '.json', JSON.stringify(marker));
  const socket = join(f.session.path, 'orphan.sock'), server = createServer(); await new Promise(resolve => server.listen(socket, resolve));
  try { await reclaimLocalIpcSessions(); assert.equal((await lstat(f.session.path)).isDirectory(), true); }
  finally { await new Promise(resolve => server.close(resolve)); }
  await reclaimLocalIpcSessions(); await assert.rejects(lstat(f.session.path), { code:'ENOENT' });
}));
test('symlinked/replaced/nonprivate session and modified lease refuse cleanup while outside data survives', async () => fixture(async f => {
  const outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep'), 'untouched');
  const saved = f.session.path + '-saved'; await rename(f.session.path, saved); await symlink(outside, f.session.path);
  await assert.rejects(f.session.cleanup(), /ownership|canonical/); assert.equal(await readFile(join(outside,'keep'),'utf8'), 'untouched');
  await rm(f.session.path); await rename(saved, f.session.path);
  await chmod(f.session.path,0o755); await assert.rejects(f.session.cleanup(), /permissions/); await chmod(f.session.path,0o700);
  assert.equal(await f.session.cleanup(),true);
}));
test('cleanup unlinks a child symlink without following it outside the session', async () => fixture(async f => {
  const outside = join(f.root,'preserve'); await mkdir(outside); await writeFile(join(outside,'keep'),'kept');
  await symlink(outside,join(f.session.path,'alias')); assert.equal(await f.session.cleanup(),true);
  assert.equal(await readFile(join(outside,'keep'),'utf8'),'kept');
}));
test('unknown launch cannot be reclaimed without exit confirmation; arbitrary IPC policy paths are refused', async () => fixture(async f => {
  await f.session.beginLaunch(); assert.equal(await f.session.cleanup(),false);
  assert.equal(await f.session.cleanup({confirmedExited:true}),true);
  for(const ipcTemporary of['/private/tmp',localIpcRoot(),f.context.temporary,localIpcRoot()+'/../other']) assert.throws(()=>localWorkbenchSandboxPolicy({...f.input,context:{...f.context,ipcTemporary}}),/owned short/);
}));
