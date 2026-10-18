import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { createBuildTasks, createLaunchConfiguration, installedCompiler } = require('./build-tasks.cjs');
const { terminalLaunchConfiguration, createDebugBuildTarget } = require('./cpp-run.cjs');
const runtimeRequire = createRequire(new URL('../../../runtime/theia/package.json', import.meta.url));
const exec = promisify(execFile);
const appRuntime = process.env.YNX_QA_MACOS_APP_RUNTIME;
// Installed runtime proofs deliberately belong to that package's own module.
// Importing the checkout's module cannot attest a root:admin /Applications
// installation and must not be worked around by relaxing ancestor checks.
const packagedDesktop = appRuntime && join(dirname(appRuntime), 'code/apps/developer/desktop');
const { localWorkbenchSandboxPolicy, localWorkbenchPathIdentities, localWorkbenchEnvironment, inspectTrustedLocalClangd, isSupportedLocalNodeVersion } = appRuntime
  ? await import(pathToFileURL(join(packagedDesktop, 'local-workbench.mjs')).href)
  : await import('../../../desktop/local-workbench.mjs');
const { createLocalIpcSession } = appRuntime
  ? await import(pathToFileURL(join(packagedDesktop, 'local-workbench-ipc.mjs')).href)
  : await import('../../../desktop/local-workbench-ipc.mjs');

// Real DAP transport to the installed Apple LLDB under the product sandbox.
// This exercises the native debugger, not an App/UI acceptance substitute.
function connect(policy, cwd, env) {
  const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, '/Library/Developer/CommandLineTools/usr/bin/lldb-dap'], {
    cwd, env,
  });
  let sequence = 0, buffer = Buffer.alloc(0), stderr = '', output = '';
  const pending = new Map(), events = [], waiters = [];
  const closed = new Promise(resolve => child.once('close', (code, signal) => {
    for (const request of pending.values()) request.reject(Error(`LLDB closed ${code}/${signal}: ${stderr}`));
    pending.clear(); resolve({ code, signal });
  }));
  child.stderr.on('data', bytes => stderr += bytes);
  child.stdout.on('data', bytes => {
    buffer = Buffer.concat([buffer, bytes]);
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return;
      const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString())[1]);
      if (buffer.length < end + 4 + length) return;
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length)); buffer = buffer.subarray(end + 4 + length);
      if (message.type === 'response') { pending.get(message.request_seq)?.resolve(message); pending.delete(message.request_seq); }
      if (message.event === 'output') output += message.body.output;
      if (message.type === 'event') {
        const index = waiters.findIndex(item => item.name === message.event);
        if (index >= 0) waiters.splice(index, 1)[0].resolve(message); else events.push(message);
      }
    }
  });
  const timeout = (promise, label) => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('LLDB DAP timed out: ' + label + '; output=' + output + '; stderr=' + stderr)), 12000); timer.unref(); promise.finally(() => clearTimeout(timer)).catch(() => {}); })]);
  return {
    child, closed, output: () => output,
    request(command, args = {}) {
      const seq = ++sequence, bytes = Buffer.from(JSON.stringify({ seq, type: 'request', command, arguments: args }));
      const promise = new Promise((resolve, reject) => pending.set(seq, { resolve, reject }));
      child.stdin.write(`Content-Length: ${bytes.length}\r\n\r\n`); child.stdin.write(bytes); return timeout(promise, command);
    },
    event(name) {
      const index = events.findIndex(item => item.event === name); if (index >= 0) return Promise.resolve(events.splice(index, 1)[0]);
      return timeout(new Promise(resolve => waiters.push({ name, resolve })), 'event ' + name);
    },
  };
}
async function success(session, command, args) {
  const result = await session.request(command, args); assert.equal(result.success, true, JSON.stringify(result)); return result.body;
}
async function value(session, threadId) {
  const stack = await success(session, 'stackTrace', { threadId });
  const scopes = await success(session, 'scopes', { frameId: stack.stackFrames[0].id });
  const locals = scopes.scopes.find(item => /local/i.test(item.name)); assert.ok(locals);
  const result = await success(session, 'variables', { variablesReference: locals.variablesReference });
  return result.variables.find(item => item.name === 'value')?.value;
}

test('Apple LLDB generated debug target really pauses, exposes variables, steps, exits, stops and retries under the packaged local policy', { skip: process.platform !== 'darwin' || !appRuntime, timeout: 60000 }, async () => {
  const root = await mkdtemp(join(process.env.YNX_QA_PROJECT_PARENT || '/private/tmp', 'ynx-cpp-native-dap-'));
  for (const name of ['project', 'profile', 'tmp']) await mkdir(join(root, name), { mode: 0o700 });
  const context = { workspace: join(root, 'project'), profile: join(root, 'profile'), temporary: join(root, 'tmp'), id: randomUUID() };
  // Reuse the helper from this exact App, while its root is still our child.
  // Killing only the adapter first can reparent a detached debugserver.
  const cleanupHelper = join(context.temporary, 'ynx-process-tree');
  const helperBytes = (await exec('/usr/bin/tar', ['-xOf', join(dirname(appRuntime), 'composed-core/workbench.tar'), './lib/backend/ynx-process-tree'], { encoding: 'buffer', maxBuffer: 1024 * 1024 })).stdout;
  await writeFile(cleanupHelper, helperBytes, { flag: 'wx', mode: 0o700 });
  const ipc = await createLocalIpcSession(context); context.ipcTemporary = ipc.path;
  const node = join(appRuntime, 'node'), helper = join(appRuntime, 'workspace-path-identity');
  assert.ok(isSupportedLocalNodeVersion(process.version), 'Use an exact reviewed Node runtime.');
  assert.equal((await exec(node, ['--version'])).stdout.trim(), process.version);
  const runtime = { root }, lockHelper = join(appRuntime, 'ynx-local-workbench-lock');
  const pathIdentities = await localWorkbenchPathIdentities({ helper, node, lockHelper, runtime, context });
  const policy = localWorkbenchSandboxPolicy({ node, lockHelper, runtime, context, port: 58999, pathIdentities });
  assert.ok(policy.includes('(deny network*)'));
  const clangd = await inspectTrustedLocalClangd('/Library/Developer/CommandLineTools'); assert.ok(clangd);
  const env = localWorkbenchEnvironment({ node, lockHelper, runtime, context, clangd });
  assert.equal(env.DEVELOPER_DIR, '/Library/Developer/CommandLineTools'); assert.equal(env.SDKROOT, clangd.sysroot);
  const tool = await installedCompiler({ sysroot: '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', language: 'cpp' });
  const debugOutput = process.env.YNX_QA_CPP_SHORT_EXECUTABLE === '1' ? await createDebugBuildTarget(env, randomUUID()) : undefined;
  const source = join(context.workspace, 'main.cpp'), program = debugOutput?.binary || join(context.workspace, 'main');
  await writeFile(source, '#include <iostream>\nint main(int argc, char **argv) {\n  int value = 41;\n  value += 1;\n  std::cout << "Hello World " << value << std::endl;\n  int input = 0; if (argc > 1 && std::cin >> input) std::cout << "Input " << input << std::endl;\n  return 0;\n}\n');
  await exec('/usr/bin/sandbox-exec', ['-p', policy, tool.compiler, '-isysroot', tool.sdk, '-g', '-O0', source, '-o', program], { cwd: context.workspace, env });
  await debugOutput?.validate();
  const tasks = await createBuildTasks(context.workspace, tool);
  const generated = await createLaunchConfiguration(context.workspace, tasks.path, 'cpp', true);
  const config = { ...generated.configuration, program, cwd: context.workspace }; delete config.preLaunchTask;
  const sessions = [], holders = [];
  try {
    // Negative control: the previous generated terminal default fails before
    // configurationDone; its failure cannot be counted as debugger startup.
    const old = connect(policy, context.workspace, env); sessions.push(old);
    await success(old, 'initialize', { adapterID: 'lldb-dap', clientID: 'theia', pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true, supportsRunInTerminalRequest: true });
    const failed = await old.request('launch', { ...config, console: 'integratedTerminal' });
    assert.equal(failed.success, false); assert.match(failed.body.error.format, /unique file name for runInTerminal/);
    await old.request('disconnect', { terminateDebuggee: true }); await old.closed;
    for (const mode of ['finish', 'stop', 'retry', 'pty-finish', 'pty-stop', 'pty-retry']) {
      console.log(JSON.stringify({ nativeDapMode: mode, workspace: context.workspace }));
      let terminalOutput = '', holder;
      if (mode.startsWith('pty')) {
        const pty = runtimeRequire('node-pty');
        holder = pty.spawn('/usr/bin/sandbox-exec', ['-p', policy, '/usr/bin/tail', '-f', '/dev/null'], { cwd: context.workspace, env, cols: 80, rows: 24 });
        holders.push(holder); holder.onData(data => { terminalOutput += data; });
        assert.match(holder.ptsName, /^\/dev\/ttys[0-9]+$/);
        holder.write('7\n');
      }
      const session = connect(policy, context.workspace, env); sessions.push(session);
      await success(session, 'initialize', { adapterID: 'lldb-dap', clientID: 'theia', pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true, supportsRunInTerminalRequest: true });
      await success(session, 'launch', holder ? terminalLaunchConfiguration({ ...config, args: ['input'] }, holder.ptsName) : config); await session.event('initialized');
      const breakpoints = await success(session, 'setBreakpoints', { source: { path: source }, breakpoints: [{ line: 4 }] }); assert.equal(breakpoints.breakpoints.length, 1);
      await success(session, 'configurationDone'); const stopped = await session.event('stopped'); assert.equal(stopped.body.reason, 'breakpoint');
      assert.equal(await value(session, stopped.body.threadId), '41');
      if (!mode.endsWith('stop')) {
        await success(session, 'next', { threadId: stopped.body.threadId }); await session.event('stopped');
        assert.equal(await value(session, stopped.body.threadId), '42');
        await success(session, 'continue', { threadId: stopped.body.threadId });
        const exited = await session.event('exited'); assert.equal(exited.body.exitCode, 0);
        if (holder) { assert.match(terminalOutput, /Hello World 42/); assert.match(terminalOutput, /Input 7/); }
        else assert.match(session.output(), /Hello World 42/);
      }
      await success(session, 'disconnect', { terminateDebuggee: true }); const closed = await session.closed; assert.equal(closed.code, 0);
    }
    console.log(JSON.stringify({ root, actualNode: node, adapter: '/Library/Developer/CommandLineTools/usr/bin/lldb-dap', checks: ['previous integrated terminal rejected', 'real source breakpoint', 'value 41', 'step to 42', 'stdout and exit0', 'stop own debuggee', 'retry', 'product PTY launchCommands finish/stop/retry', 'PTY stdin 7 and output'], limitations: ['native App UI remains a separate required check'] }));
    assert.equal(JSON.parse(await readFile(generated.path)).configurations[0].console, 'internalConsole');
  } finally {
    for (const holder of holders) { try { holder.kill(); } catch {} }
    for (const session of sessions) if (session.child.exitCode === null && session.child.signalCode === null)
      await exec(cleanupHelper, [String(session.child.pid), '--force'], { timeout: 5000 });
    await Promise.all(sessions.map(session => session.closed)); await ipc.cleanup({ confirmedExited: true });
  }
});
