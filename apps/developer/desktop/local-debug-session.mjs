import { createServer } from 'node:net';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { lstat, realpath, readFile, chmod, unlink } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWorkspacePathIdentity, assertWorkspacePathIdentity } from './workspace-path-identity.mjs';
import { composedTreeDigest } from '../services/codeoss-service/src/composed-runtime.mjs';

const exec = promisify(execFile), MAX_FRAME = 8 * 1024 * 1024;
export const DEBUGPY_PINS = Object.freeze({
  'adapter/__main__.py': 'ce6d475e0a1e5dce3cc79b51c254561a8031041b31f1d11904a53dad4e5a095f',
  'adapter/clients.py': '92df10a72a3c013f55b856e56236649b2f9dfbc5d056735ce2e525fbaea2db7c',
  'adapter/launchers.py': '492d736c4462b2a88f709f43ec39113075222f7c7662f7820fb3f87aa0d13a3f',
  'adapter/servers.py': 'fcda211deb9c2fada184ee4d4cfa4373970c743d2a8866bd5f8c9ca99af3885b',
  'common/sockets.py': 'e3e5f47c3805e9b628b8f536c079bb9eb9d4bba81a8f421544b7aa8540e1f23a',
  'server/cli.py': '1a97b9ca4e1438df58bdf06cc039c20ed20dfcc056795e6fcdc0c3366549b3e9',
});
const PTY_JS_PINS = {
  'lib/index.js': 'c1b82c92c4c63aaa8e8441fc5a291c4727cd3f3550666d2fec7250e0f6d4b173',
  'lib/unixTerminal.js': 'a62e3a60c3bc1b0e7261f58284856df748dcee6761a2bc7a5a5ba98b22660473',
  'lib/utils.js': 'f75ad341c13fbf1a9a6605d7ee42dff5bbc5d43b7b381e413fb97eb1b8300beb',
  'lib/terminal.js': '5ed5cd66a766afba4a04093284e999f8516d41936501839055800b10eca5d304',
  'lib/eventEmitter2.js': 'f1c14613aa90c10def4ca7238329270871997eb26f919f7074dc25533e3e75dd',
};
export async function loadSealedDebugPty() {
  if (process.platform !== 'darwin' || !['v26.7.0', 'v24.19.0'].includes(process.version)) throw Error('Debug PTY requires the reviewed sealed macOS Node');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/node-pty');
  const require = createRequire(import.meta.url);
  if (require.resolve('node-pty') !== join(root, 'lib/index.js')) throw Error('Debug PTY resolved outside the owned package closure');
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (metadata.name !== 'node-pty' || metadata.version !== '1.1.0' || metadata.license !== 'MIT') throw Error('Unsupported debug PTY identity');
  for (const directory of ['build/Release', 'build/Debug']) {
    try { await lstat(join(root, directory)); throw Error('Unreviewed debug PTY build override'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const native = {
    arm64: ['e6457d66f45af3facd02920a5b212164e80fe0bb758afe6e6eab1eceeba3fc9a', '21c589109bca43e287df884f3c34ab888033a83927ea7d273949ac5030583f26'],
    x64: ['edab585d5c5c7bf35143a7a53b7d72652e90723b5f9635dfd55b2333f7069198', '46a4455777c6122d7e71cd706ea4b37b19bedd297684be8b6dabb833ff2a3965'],
  }[process.arch];
  if (!native) throw Error('Unsupported debug PTY architecture');
  const pins = { 'package.json': 'f8b6a14f7022c14f1cd5d109486f5dacd32bffb63a9a63e38eced37dacb47439',
    LICENSE: 'a3d60eaf32d2fb09c9d82ef39f14bd6e2c0f3ca7de30daa827486c0d6f8b6e9f',
    ...PTY_JS_PINS, [`prebuilds/darwin-${process.arch}/pty.node`]: native[0], [`prebuilds/darwin-${process.arch}/spawn-helper`]: native[1] };
  const ledgerPath = join(root, 'YNX-SIGNED-DISTRIBUTION.json'); await canonical(ledgerPath);
  const ledgerBytes = await readFile(ledgerPath), ledger = JSON.parse(ledgerBytes);
  if (ledger.schemaVersion !== 1 || ledger.name !== 'node-pty' || ledger.version !== '1.1.0' || ledger.platform !== `darwin-${process.arch}` || ledger.signingClass !== 'adhoc-no-team-id' || !Array.isArray(ledger.files) || ledger.files.length !== Object.keys(pins).length) throw Error('Debug PTY signed distribution is invalid');
  const resources = resolve(root, '../../../../..'), provenancePath = join(resources, 'build-provenance.json'); await canonical(provenancePath);
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  if (provenance.debugPtyDistribution?.path !== 'Contents/Resources/code/apps/developer/node_modules/node-pty/YNX-SIGNED-DISTRIBUTION.json' || provenance.debugPtyDistribution.sha256 !== createHash('sha256').update(ledgerBytes).digest('hex')) throw Error('Debug PTY distribution provenance differs');
  if (await realpath(process.execPath) !== join(resources, 'runtime/node')) throw Error('Debug supervisor must use this App sealed Node runtime');
  const paths = new Set();
  for (const entry of ledger.files) {
    if (!Object.hasOwn(pins, entry.path) || paths.has(entry.path) || entry.sourceSha256 !== pins[entry.path] || !/^[a-f0-9]{64}$/.test(entry.bundledSha256 || '') || entry.kind !== (entry.path.startsWith('prebuilds/') ? 'macho' : 'source') || entry.kind === 'source' && entry.bundledSha256 !== entry.sourceSha256 || entry.sourceMode !== 0o644 || entry.bundledMode !== (entry.path.endsWith('/spawn-helper') ? 0o755 : 0o644)) throw Error('Debug PTY source provenance changed');
    paths.add(entry.path);
  }
  for (const [relative, digest] of Object.entries(pins)) {
    const path = join(root, relative); await canonical(path);
    const entry = ledger.files.find(entry => entry.path === relative);
    if (((await lstat(path)).mode & 0o777) !== entry.bundledMode) throw Error('Debug PTY file mode changed');
    if (createHash('sha256').update(await readFile(path)).digest('hex') !== entry.bundledSha256) throw Error('Debug PTY closure changed');
    if (entry.kind === 'macho') {
      if (relative.endsWith('/spawn-helper') && !((await lstat(path)).mode & 0o111)) throw Error('Debug PTY spawn helper is not executable');
      await exec('/usr/bin/codesign', ['--verify', '--strict', path], { timeout: 5000 });
      const display = await exec('/usr/bin/codesign', ['--display', '--verbose=2', path], { timeout: 5000 });
      if (!/Signature=adhoc/.test(display.stderr) || !/TeamIdentifier=not set/.test(display.stderr)) throw Error('Debug PTY signing class changed');
    }
  }
  return require(join(root, 'lib/index.js'));
}
const inside = (root, path) => path === root || path.startsWith(root + '/');
const exact = path => typeof path === 'string' && isAbsolute(path) && resolve(path) === path && !path.includes('\0');
async function canonical(path, directory = false) {
  if (!exact(path) || await realpath(path) !== path) throw Error('Debug path must be canonical');
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) throw Error('Unsupported debug path');
  return stat;
}
function environment(base, extra = {}) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra) || Object.keys(extra).length > 256) throw Error('Invalid debug environment');
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !(value === null || typeof value === 'string' && !value.includes('\0') && value.length <= 65536)) throw Error('Invalid debug environment value');
    if (value === null) delete result[key]; else result[key] = value;
  }
  for (const key of Object.keys(result)) if (key.startsWith('YNX_DEBUG_')) delete result[key];
  result.PYTHONDONTWRITEBYTECODE = '1';
  return result;
}
export function debugSessionPolicy(base, ports, bootstrap) {
  if (!Array.isArray(ports) || ports.length !== 3 || new Set(ports).size !== 3 || ports.some(p => !Number.isInteger(p) || p < 1024 || p > 65535)) throw Error('Invalid debug endpoint allocation');
  if (!exact(bootstrap)) throw Error('Invalid debug bootstrap');
  const escaped = bootstrap.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const ancestors = []; for (let p = dirname(bootstrap); p !== '/'; p = dirname(p)) ancestors.push(p);
  return base + `\n(allow file-read* (literal "${escaped}"))` + ancestors.map(p => `\n(allow file-read-metadata (literal "${p.replaceAll('"', '\\"')}"))`).join('') +
    ports.map(p => `\n(allow network-bind (local ip "localhost:${p}"))\n(allow network-inbound (local ip "localhost:${p}"))\n(allow network-outbound (remote ip "localhost:${p}"))`).join('');
}
export function dapDecoder(receive) {
  let buffer = Buffer.alloc(0);
  return data => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) { if (buffer.length > 8192) throw Error('Invalid DAP header'); return; }
      const header = buffer.subarray(0, end).toString('ascii');
      const matches = header.split('\r\n').map(line => /^Content-Length: (\d+)$/i.exec(line)).filter(Boolean);
      if (matches.length !== 1) throw Error('Invalid DAP length');
      const size = Number(matches[0][1]);
      if (size < 1 || size > MAX_FRAME) throw Error('DAP message exceeds session bound');
      if (buffer.length < end + 4 + size) return;
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + size).toString('utf8'));
      buffer = buffer.subarray(end + 4 + size); receive(message);
    }
  };
}
const encodeDap = message => { const body = JSON.stringify(message); return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`; };
async function allocate(leased) {
  const servers = [], ports = [];
  try {
    while (ports.length < 3) {
      const server = createServer(); await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
      const port = server.address().port;
      if (leased.has(port)) { await new Promise(ok => server.close(ok)); continue; }
      leased.add(port); servers.push(server); ports.push(port);
    }
    return { ports, release: () => Promise.all(servers.map(s => new Promise(ok => s.close(ok)))) };
  } catch (error) { await Promise.all(servers.map(s => new Promise(ok => s.close(ok)))); ports.forEach(p => leased.delete(p)); throw error; }
}

// Runs OUTSIDE the ordinary workbench sandbox. Each child receives a fresh
// stricter session policy; the workbench itself receives only this Unix socket.
export async function createDebugSessionSupervisor({ context, plugins, runtime, basePolicy, env, pathIdentities = [], pathIdentityHelper, bootstrap = fileURLToPath(new URL('./local-debugpy-bootstrap.py', import.meta.url)), lifetimeMs = 2 * 60 * 60 * 1000, maxSessions = 8, cleanupTimeoutMs = 5000, warn = () => {} }) {
  await canonical(context.ipcTemporary, true); await canonical(bootstrap);
  const directory = await lstat(context.ipcTemporary);
  if (directory.uid !== process.getuid() || (directory.mode & 0o777) !== 0o700) throw Error('Debug supervisor needs its private IPC directory');
  if (!Number.isInteger(lifetimeMs) || lifetimeMs < 1000 || lifetimeMs > 2 * 60 * 60 * 1000 || !Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 16 || !Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 50 || cleanupTimeoutMs > 5000) throw Error('Invalid debug session budget');
  const path = join(context.ipcTemporary, 'debug.sock'), credential = randomBytes(32).toString('hex');
  const sessions = new Set(), sockets = new Set(), leased = new Set(), seen = new Set();
  const pty = await loadSealedDebugPty();
  let stopped = false, faulted = false, preparing = 0;
  const cleanupErrors = [];
  const reportCleanup = error => { if (!cleanupErrors.includes(error)) { cleanupErrors.push(error); try { warn(error); } catch {} } };
  const bootstrapProof = pathIdentityHelper ? await inspectWorkspacePathIdentity({ helper: pathIdentityHelper, path: bootstrap }) : undefined;
  async function interpreter(path) {
    // Project virtualenv symlinks to the already readable trusted CLT Python
    // qualify by canonical target; other interpreters need their own admission.
    if (!exact(path)) throw Error('Select an absolute local Python interpreter');
    const target = await realpath(path); const stat = await canonical(target);
    if (!(stat.mode & 0o111) || !(inside('/Library/Developer/CommandLineTools', target) && stat.uid === 0 || inside(context.workspace, target))) throw Error('Python interpreter is outside admitted local project/runtime');
    return target;
  }
  async function within(path, allowPlugins = false) {
    await canonical(path, true);
    if (!inside(context.workspace, path) && !(allowPlugins && inside(plugins, path))) throw Error('Debug working directory is outside this project');
    return path;
  }
  async function descriptor(request) {
    const command = await interpreter(request.command), args = request.args;
    if (!Array.isArray(args) || args.length < 1 || args.length > 12 || args.some(a => typeof a !== 'string' || a.includes('\0'))) throw Error('Invalid debug adapter arguments');
    // Interpreter flags from the official resolver precede the adapter entry.
    const index = args.findIndex(a => a.endsWith('/bundled/libs/debugpy/adapter'));
    if (index < 0 || args.slice(0, index).some(a => !['-E', '-s', '-S', '-u', '-B', '-I'].includes(a))) throw Error('Unsupported custom debug adapter; reviewed bundled debugpy is required');
    const adapter = args[index]; await canonical(adapter, true);
    if (!inside(plugins, adapter)) throw Error('Debug adapter is outside sealed project plugin copy');
    const debugpy = dirname(adapter), extension = resolve(debugpy, '../../..');
    const manifest = JSON.parse(await readFile(join(extension, 'package.json'), 'utf8'));
    if (manifest.publisher !== 'ms-python' || manifest.name !== 'debugpy' || manifest.version !== '2026.6.0') throw Error('Unsupported Python debug extension identity');
    for (const [relative, digest] of Object.entries(DEBUGPY_PINS)) {
      const file = join(debugpy, relative); await canonical(file);
      if (createHash('sha256').update(await readFile(file)).digest('hex') !== digest) throw Error('Debugpy source contract changed');
    }
    if (await composedTreeDigest(dirname(debugpy)) !== 'f4d77913f33c887299f3772dbe948cb567a2dc97cfdc171759797699045117ef') throw Error('Debugpy complete retained library closure changed');
    const tail = args.slice(index + 1);
    if (tail.length && !(tail.length === 2 && tail[0] === '--log-dir' && inside(extension, tail[1]) && await within(tail[1], true))) throw Error('Unsupported debug adapter options');
    const cwd = await within(request.options?.cwd || context.workspace);
    return { command, flags: args.slice(0, index), debugpy, args: tail, cwd, env: environment(env, request.options?.env) };
  }
  const server = createServer(socket => {
    sockets.add(socket); socket.setEncoding('utf8'); let session, opening = false, buffer = '', expired = false;
    const handshake = setTimeout(() => { expired = true; socket.destroy(); }, 5000);
    const send = message => { if (!socket.destroyed) { if (socket.writableLength > MAX_FRAME) socket.destroy(); else socket.write(JSON.stringify(message) + '\n'); } };
    const fail = error => { send({ kind: 'error', message: error.message }); socket.end(); session?.stop().catch(error => send({ kind: 'warning', message: error.message })); };
    async function start(request) {
      if (stopped || faulted || expired || opening || session || sessions.size + preparing >= maxSessions || request.credential !== credential || request.projectId !== context.id || !/^[a-f0-9-]{36}$/.test(request.requestId || '') || seen.has(request.requestId) || seen.size >= 4096) throw Error('Debug session admission refused');
      opening = true; seen.add(request.requestId); clearTimeout(handshake);
      preparing++;
      let data, allocation;
      try { data = await descriptor(request); if (socket.destroyed || stopped) throw Error('Debug session was cancelled during preparation'); allocation = await allocate(leased); }
      catch (error) { preparing--; throw error; }
      let child, terminal, childDone, terminalEnded = false, terminated = false, stopPromise, launch, reverse;
      const escape = path => path.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
      const policy = debugSessionPolicy(basePolicy, allocation.ports, bootstrap) + (bootstrapProof ? bootstrapProof.paths.map(path => `\n(allow file-read* (literal "${escape(path)}"))`).join('') + bootstrapProof.ancestors.map(path => `\n(allow file-read-metadata (literal "${escape(path)}"))`).join('') : '');
      async function stop() {
        if (stopPromise) return stopPromise;
        terminated = true;
        stopPromise = (async () => {
          clearTimeout(timer);
          const failures = [];
          try {
            for (const pid of [terminal?.pid, child?.pid].filter(Boolean)) {
              try { await exec(join(runtime.root, 'lib/backend/ynx-process-tree'), [String(pid)], { timeout: cleanupTimeoutMs }); }
              catch (error) { failures.push(new Error('Debug descendant cleanup could not be verified', { cause: error })); }
            }
            try { if (terminal && !terminalEnded) terminal.kill(); } catch (error) { failures.push(error); }
            if (childDone) {
              try { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); } catch (error) { failures.push(error); }
              const timeout = setTimeout(() => { try { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); } catch (error) { failures.push(error); } }, 1500);
              try { await Promise.race([childDone, new Promise((_, reject) => setTimeout(() => reject(Error('Debug adapter did not confirm exit')), 3000).unref())]); }
              catch (error) { failures.push(error); } finally { clearTimeout(timeout); }
            }
          } finally {
            sessions.delete(session);
            if (!failures.length) allocation.ports.forEach(p => leased.delete(p));
          }
          if (failures.length) { faulted = true; const error = new AggregateError(failures, 'Debug cleanup is unverified; endpoint leases retained and new sessions refused'); reportCleanup(error); throw error; }
        })(); return stopPromise;
      }
      const timer = setTimeout(() => { send({ kind: 'error', message: 'Local debug session reached its two-hour limit' }); socket.end(); stop().catch(reportCleanup); }, lifetimeMs);
      session = { id: randomUUID(), ports: allocation.ports, stop }; sessions.add(session);
      preparing--;
      try {
        await allocation.release();
        for (const proof of [...pathIdentities, ...(bootstrapProof ? [bootstrapProof] : [])]) await assertWorkspacePathIdentity(proof);
        if (socket.destroyed || stopped) throw Error('Debug session was cancelled before spawn');
        child = spawn('/usr/bin/sandbox-exec', ['-p', policy, data.command, ...data.flags, bootstrap, JSON.stringify({ debugpy: data.debugpy, ports: allocation.ports, args: data.args })], { env: data.env, cwd: data.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
        childDone = new Promise(ok => child.once('close', ok));
        child.once('error', fail);
        const decode = dapDecoder(message => {
          if (message.type === 'request' && message.command === 'runInTerminal') {
            if (reverse) throw Error('Duplicate terminal launch'); reverse = message;
          }
          send({ kind: 'dap', message });
        });
        child.stdout.on('data', chunk => { try { decode(chunk); } catch (error) { fail(error); } });
        child.stderr.on('data', chunk => send({ kind: 'stderr', data: chunk.toString() }));
        child.once('close', (code, signal) => { send({ kind: 'exit', code, signal }); socket.end(); stop().catch(reportCleanup); });
        session.receive = async message => {
          if (terminated) throw Error('Debug session has ended');
          if (message.op === 'dap') {
            const dap = message.message;
            if (!dap || typeof dap !== 'object') throw Error('Invalid debug protocol message');
            if (dap.type === 'request' && ['launch', 'attach'].includes(dap.command)) {
              if (launch || dap.command !== 'launch') throw Error('This supervisor admits one local launch');
              const args = dap.arguments || {};
              if (args.console === 'externalTerminal' || args.sudo || args.debugAdapterHost && !['127.0.0.1', 'localhost'].includes(args.debugAdapterHost)) throw Error('Only local internal/integrated Python launch is supported');
              if (args.cwd) await within(args.cwd);
              if (args.program) {
                const p = await realpath(resolve(args.cwd || data.cwd, args.program)); await canonical(p);
                if (!inside(context.workspace, p) && !inside(plugins, p)) throw Error('Python program is outside this project');
                // Resolve relative launch entries against their actual cwd, as
                // the normal VS Code provider does. Never rewrite launch.json.
                args.program = p;
              }
              environment(data.env, args.env); launch = args;
            }
            if (!child.stdin.write(encodeDap(dap)) && child.stdin.writableLength > MAX_FRAME) throw Error('Debug adapter input exceeded buffer bound');
          } else if (message.op === 'terminal') {
            if (!launch || !reverse || terminal || message.requestSeq !== reverse.seq || reverse.arguments?.kind !== 'integrated' || reverse.arguments?.argsCanBeInterpretedByShell) throw Error('Terminal request is not bound to this debug launch');
            const request = reverse.arguments, args = request.args;
            if (!Array.isArray(args) || args.length < 5 || args.length > 1024 || args.some(a => typeof a !== 'string' || a.includes('\0'))) throw Error('Invalid Python launcher argv');
            const command = await interpreter(args[0]);
            const at = args.indexOf(join(data.debugpy, 'launcher'));
            if (at < 1 || args.slice(1, at).some(a => !['-E', '-s', '-S', '-u', '-B', '-I'].includes(a)) || args[at + 1] !== String(allocation.ports[2]) || args[at + 2] !== '--') throw Error('Terminal command is not the pinned session launcher');
            const cwd = await within(request.cwd || launch.cwd || context.workspace);
            const terminalEnv = environment(data.env, request.env);
            for (const proof of [...pathIdentities, ...(bootstrapProof ? [bootstrapProof] : [])]) await assertWorkspacePathIdentity(proof);
            terminal = pty.spawn('/usr/bin/sandbox-exec', ['-p', policy, command, ...args.slice(1)], { name: 'xterm-256color', cols: 80, rows: 24, cwd, env: terminalEnv });
            terminal.onData(data => send({ kind: 'terminalData', data }));
            terminal.onExit(exit => { terminalEnded = true; send({ kind: 'terminalExit', ...exit }); });
            child.stdin.write(encodeDap({ type: 'response', seq: 0, request_seq: reverse.seq, command: 'runInTerminal', success: true, body: { processId: terminal.pid } }));
            send({ kind: 'terminalReady', pid: terminal.pid });
          } else if (message.op === 'input' && terminal) { if (typeof message.data !== 'string' || message.data.length > 65536) throw Error('Invalid terminal input'); terminal.write(message.data); }
          else if (message.op === 'resize' && terminal) { if (![message.columns, message.rows].every(n => Number.isInteger(n) && n > 0 && n <= 1000)) throw Error('Invalid terminal dimensions'); terminal.resize(message.columns, message.rows); }
          else if (message.op === 'stop') { socket.end(); await stop(); }
          else throw Error('Unknown debug session operation');
        };
        send({ kind: 'ready', sessionId: session.id, ports: allocation.ports });
      } catch (error) { await allocation.release().catch(() => {}); await stop(); throw error; }
    }
    let queue = Promise.resolve();
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8'); if (Buffer.byteLength(buffer) > MAX_FRAME) { fail(Error('Debug RPC exceeded size bound')); return; }
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        queue = queue.then(async () => { const message = JSON.parse(line); if (!session) { if (message.op !== 'start') throw Error('Debug handshake required'); await start(message); } else await session.receive(message); }).catch(fail);
      }
    });
    socket.on('error', () => {});
    socket.once('close', () => { clearTimeout(handshake); sockets.delete(socket); session?.stop().catch(reportCleanup); });
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(path, ok); }); await chmod(path, 0o600);
  let closing;
  return { path, credential, projectId: context.id, activeSessions: () => sessions.size,
    stop: () => closing ||= (async () => {
      stopped = true; sockets.forEach(s => s.destroy());
      const failures = (await Promise.allSettled([...sessions].map(s => s.stop()))).filter(result => result.status === 'rejected').map(result => result.reason);
      try { await new Promise((ok, fail) => server.close(error => error ? fail(error) : ok())); } catch (error) { failures.push(error); }
      try { await unlink(path); } catch (error) { if (error.code !== 'ENOENT') failures.push(error); }
      for (const error of cleanupErrors) if (!failures.includes(error)) failures.push(error);
      if (failures.length) throw new AggregateError(failures, 'Local debug supervisor stopped with unverified child cleanup');
    })() };
}
