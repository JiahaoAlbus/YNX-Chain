import { mkdtemp, mkdir, writeFile, realpath, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { verifyComposedRuntime } from '../../../services/codeoss-service/src/composed-runtime.mjs';

// A real, OS-contained single-session test of this runtime. This is deliberately
// not the public/multi-owner admission path and never selects a user profile.
if (process.platform !== 'darwin') throw Error('The isolated QA launcher currently requires macOS.');
const application = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const candidates = resolve(application, '../../.ynx-developer-candidates') + '/';
const root = process.argv[4] ? await realpath(process.argv[4]) : application;
if (root !== application) {
  if (!root.startsWith(candidates)) throw Error('Only an owned composed runtime candidate is allowed.');
  await verifyComposedRuntime(root, JSON.parse(await readFile(`${root}.pin.json`, 'utf8')));
}
const pluginInput = process.argv[2];
if (!pluginInput || !pluginInput.startsWith('/')) throw Error('Provide the owned staged extension directory.');
const plugins = await realpath(pluginInput);
if (!plugins.startsWith(candidates)) throw Error('Only owned candidate plugin inputs are allowed.');
const dapInput = process.argv[3];
const dapRoot = dapInput ? await realpath(dapInput) : undefined;
if (dapRoot && !dapRoot.startsWith(candidates)) throw Error('Only owned debugger candidate inputs are allowed.');
if (dapRoot && JSON.parse(await readFile(join(dapRoot, 'receipt.json'), 'utf8')).sha256 !== '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968') throw Error('Unexpected debugger artifact pin.');
// Keep debugger Unix socket names below macOS's sockaddr_un path limit.
const resumeInput = process.argv[5];
const upgrade = process.argv[6] === '--upgrade-owned-candidate';
if (process.argv[6] && !upgrade || upgrade && !resumeInput) throw Error('Use the explicit upgrade flag only with an existing owned QA receipt.');
let previous;
if (resumeInput) {
  const resumePath = await realpath(resumeInput);
  if (!/^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+\/runtime\.json$/.test(resumePath)) throw Error('Resume only an existing owned QA receipt.');
  previous = JSON.parse(await readFile(resumePath, 'utf8'));
  if (previous.qa !== dirname(resumePath) || previous.dapRoot !== dapRoot) throw Error('Resume inputs must match the original runtime.');
  if (upgrade) {
    const previousRoot = await realpath(previous.root);
    if (!previousRoot.startsWith(candidates) || previousRoot !== previous.root || previous.plugins !== join(previousRoot, 'plugins') || plugins !== join(root, 'plugins') || root === application) throw Error('Upgrade only between exact owned reviewed candidates and their full built-in inputs.');
    await verifyComposedRuntime(previousRoot, JSON.parse(await readFile(`${previousRoot}.pin.json`, 'utf8')));
  } else if (previous.root !== root || previous.plugins !== plugins) throw Error('Resume inputs must match the original runtime.');
  if (!Number.isSafeInteger(previous.pid) || previous.pid <= 1) throw Error('Invalid previous runtime PID.');
  try { process.kill(previous.pid, 0); throw Error('Stop the exact previous runtime before resuming.'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
const qa = previous ? await realpath(previous.qa) : await realpath(await mkdtemp('/private/tmp/ynx-theia-extension-qa-'));
const workspace = join(qa, 'project'), profile = join(qa, 'profile'), temporary = join(qa, 'tmp');
if (previous) {
  for (const [key, path] of Object.entries({ workspace, profile, temporary })) if (previous[key] !== path || await realpath(path) !== path) throw Error('Resume paths must be the original canonical QA directories.');
}
if (!previous) {
for (const path of [workspace, profile, temporary]) await mkdir(path, { mode: 0o700 });
await writeFile(join(workspace, 'main.js'), 'import { wallet } from "./wallet-model.js";\nwallet.\n', { mode: 0o600 });
await writeFile(join(workspace, 'wallet-model.js'), 'export const wallet = { address: "ynx-public-test", balance: 42 };\n', { mode: 0o600 });
await writeFile(join(workspace, 'debug.js'), 'const marker = "YNX debugger reference";\nconsole.log(marker);\nrequire("node:fs").writeFileSync("debug-proof.txt", marker);\n', { mode: 0o600 });
await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'ynx-public-runtime-reference', private: true }), { mode: 0o600 });
}
const reservations = [];
for (let index = 0; index < (dapRoot ? 3 : 1); index++) {
  const reserve = createServer();
  const resumePort = previous ? [previous.port, previous.adapterPort, previous.inspectorPort][index] : 0;
  if (!Number.isInteger(resumePort) || resumePort < 0 || resumePort > 65535 || previous && resumePort === 0) throw Error('Invalid reserved QA port.');
  await new Promise((ok, fail) => { reserve.once('error', fail); reserve.listen(resumePort, '127.0.0.1', ok); });
  reservations.push(reserve);
}
const [port, adapterPort, inspectorPort] = reservations.map(server => server.address().port);
await Promise.all(reservations.map(server => new Promise(ok => server.close(ok))));
const node = await realpath(process.execPath);
if (dapRoot && !previous) {
  await mkdir(join(workspace, '.vscode'), { mode: 0o700 });
  await writeFile(join(workspace, '.vscode/launch.json'), JSON.stringify({ version: '0.2.0', configurations: [{
    name: 'YNX JavaScript reference', type: 'pwa-node', request: 'launch', program: '${workspaceFolder}/debug.js', cwd: '${workspaceFolder}',
    runtimeExecutable: node, runtimeArgs: [`--inspect-brk=127.0.0.1:${inspectorPort}`], attachSimplePort: inspectorPort,
    autoAttachChildProcesses: false, stopOnEntry: false, console: 'internalConsole', debugServer: adapterPort,
  }] }, null, 2), { mode: 0o600 });
}
const escape = value => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
const reads = ['/System', '/usr', '/bin', '/sbin', '/dev', '/opt/homebrew', '/Library/Developer/CommandLineTools', root, plugins, qa, ...dapRoot ? [dapRoot] : []];
const ancestors = new Set();
// Canonical discovery of an already allowed tool (e.g. clang++ -> clang)
// needs metadata on its parents. Permit only those exact directories, never
// their contents or unrelated project/profile trees.
for (const path of reads) for (let p = dirname(path); p !== '/'; p = dirname(p)) ancestors.add(p);
const profileText = ['(version 1)', '(allow default)', '(deny network*)', '(deny file-read*)', '(deny file-write*)',
  // macOS dyld enumerates the volume root before loading Node. Permit only
  // that directory, not a recursive read of the volume or another profile.
  '(allow file-read* (literal "/"))',
  ...reads.map(path => `(allow file-read* (subpath "${escape(path)}"))`),
  ...[...ancestors].map(path => `(allow file-read-metadata (literal "${escape(path)}"))`),
  ...[workspace, profile, temporary, '/dev'].map(path => `(allow file-write* (subpath "${escape(path)}"))`),
  ...[port, ...dapRoot ? [adapterPort, inspectorPort] : []].flatMap(value => [
    `(allow network-bind (local ip "localhost:${value}"))`, `(allow network-inbound (local ip "localhost:${value}"))`]),
  ...dapRoot ? [adapterPort, inspectorPort].map(value => `(allow network-outbound (remote ip "localhost:${value}"))`) : [],
  ...dapRoot ? [
    `(allow network-bind (local unix-socket (subpath "${escape(temporary)}")))`,
    `(allow network-inbound (local unix-socket (subpath "${escape(temporary)}")))`,
    `(allow network-outbound (remote unix-socket (subpath "${escape(temporary)}")))`,
  ] : [],
].join('\n');
await writeFile(join(qa, 'sandbox.sb'), profileText, { mode: 0o600 });
if (previous) await writeFile(join(qa, `runtime-before-${previous.pid}.json`), JSON.stringify(previous, null, 2), { flag: 'wx', mode: 0o600 });
const child = spawn('/usr/bin/sandbox-exec', ['-p', profileText, node, join(root, 'lib/backend/main.js'), workspace,
  '--hostname', '127.0.0.1', '--port', String(port), '--plugins', `local-dir:${plugins}`], {
  cwd: workspace, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: `${dirname(node)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: '/bin/bash', TMPDIR: temporary,
    THEIA_CONFIG_DIR: profile, THEIA_APP_PROJECT_PATH: root, YNX_CORE_WORKSPACE: workspace, NODE_OPTIONS: '--no-experimental-global-navigator --max-old-space-size=1024', THEIA_DEFAULT_PLUGINS: `local-dir:${plugins}`,
    // Existing approved local compiler tools, not another authority binding or
    // a download. Formal runtimes obtain these paths from their operator.
    YNX_IDE_CLANGD_ENTRY: '/Library/Developer/CommandLineTools/usr/bin/clangd',
    YNX_IDE_CPP_SYSROOT: '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',
    ...dapRoot ? { YNX_IDE_DAP_ENTRY: join(dapRoot, 'js-debug/src/dapDebugServer.js'), YNX_IDE_DAP_PORT: String(adapterPort) } : {} },
});
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
const receipt = { qa, workspace, profile, temporary, root, plugins, port, dapRoot, adapterPort, inspectorPort, url: `http://127.0.0.1:${port}`, pid: child.pid,
  ...previous ? { previousPid: previous.pid, resumedAt: new Date().toISOString(), ...upgrade ? { previousRoot: previous.root, upgradedOwnedCandidate: true } : {} } : {},
  nodeOptions: '--no-experimental-global-navigator --max-old-space-size=1024',
  isolation: 'macOS sandbox-exec, deny reads/writes outside explicit runtime/system/project roots, network limited to this listener',
  acceptance: 'single-session controlled QA, not public or multi-owner production admission' };
await writeFile(join(qa, 'runtime.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
console.log(`YNX_THEIA_QA ${JSON.stringify(receipt)}`);
let killTimer;
function stop() {
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  if (!killTimer && child.exitCode === null && child.signalCode === null) killTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }, 2000);
}
process.once('SIGINT', stop); process.once('SIGTERM', stop);
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', (code, signal) => { clearTimeout(killTimer); console.log(`YNX_THEIA_QA_EXIT ${JSON.stringify({ code, signal })}`); stop(); process.exitCode = code ?? (signal === 'SIGTERM' ? 0 : 1); });
