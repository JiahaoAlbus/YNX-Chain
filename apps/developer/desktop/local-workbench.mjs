import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { mkdir, lstat, realpath, readFile, writeFile, rename, mkdtemp, cp } from 'node:fs/promises';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLocalIpcSession, localIpcRoot } from './local-workbench-ipc.mjs';
import { createDebugSessionSupervisor } from './local-debug-session.mjs';
import { createJsDebugSessionSupervisor } from './local-js-debug-session.mjs';
import { assertAdmittedLocalGoToolchain } from './local-go-selection.mjs';
import { inspectWorkspacePathIdentity, assertWorkspacePathIdentity } from './workspace-path-identity.mjs';
import { verifyComposedRuntime, validateRuntimeArtifact, sameRuntimeArtifact, composedTreeDigest } from '../services/codeoss-service/src/composed-runtime.mjs';

const exec = promisify(execFile), UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const exact = path => typeof path === 'string' && isAbsolute(path) && resolve(path) === path && !path.includes('\0');
async function regular(path) { const s = await lstat(path); if (!s.isFile() || s.isSymbolicLink() || await realpath(path) !== path) throw Error('Local workbench input is not a canonical regular file.'); return s; }
async function privateDirectory(path) {
  if (!exact(path)) throw Error('Local workbench directory must be absolute and canonical.');
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || await realpath(path) !== path || s.uid !== process.getuid() || (s.mode & 0o077)) throw Error('Local workbench state directory is not private to this OS user.');
  return path;
}
async function hashFile(path) { const hash = createHash('sha256'); for await (const part of createReadStream(path)) hash.update(part); return hash.digest('hex'); }

// Never invoke /usr/bin/git: it is an xcode-select shim and can request an
// installation from inside the sandbox. Only already installed OS tools qualify.
const localGitRoots = ['/Library/Developer/CommandLineTools', '/Applications/Xcode.app/Contents/Developer'];
async function trustedSystemPath(path, directory = false) {
  if (!exact(path) || await realpath(path) !== path) return false;
  const stat = await lstat(path);
  if (stat.uid !== 0 || (stat.mode & 0o022) || stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || !(stat.mode & 0o111))) return false;
  for (let parent = dirname(path);; parent = dirname(parent)) {
    const entry = await lstat(parent);
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== 0 || (entry.mode & 0o022) || await realpath(parent) !== parent) return false;
    if (parent === '/') break;
  }
  return true;
}
export async function inspectTrustedLocalGit(root) {
    if (!localGitRoots.includes(root)) return null;
    const executable = join(root, 'usr/bin/git'), helpers = join(root, 'usr/libexec/git-core');
    try {
      if (!await trustedSystemPath(executable) || !await trustedSystemPath(helpers, true)) return null;
      const env = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
      const version = (await exec(executable, ['--version'], { env, timeout: 5000 })).stdout.trim();
      if (!/^git version \d+\.\d+(?:\.\d+)?(?:[\w .()-]*)$/.test(version)) return null;
      if ((await exec(executable, ['--exec-path'], { env, timeout: 5000 })).stdout.trim() !== helpers) return null;
      return { executable, directory: dirname(executable), helpers, version, readPaths: [dirname(executable), helpers] };
    } catch { /* Unsupported or unavailable OS tools remain unavailable. */ }
  return null;
}
export async function findTrustedLocalGit() {
  for (const root of localGitRoots) {
    const git = await inspectTrustedLocalGit(root);
    if (git) return git;
  }
  return null;
}
// This CLT directory is already readable under the local sandbox. Never use
// /usr/bin/clangd (an installation shim) or a project-selected executable.
export async function inspectTrustedLocalClangd(root) {
  if (root !== '/Library/Developer/CommandLineTools') return null;
  const executable = join(root, 'usr/bin/clangd'), sysroot = join(root, 'SDKs/MacOSX.sdk');
  try {
    if (!await trustedSystemPath(executable)) return null;
    const version = (await exec(executable, ['--version'], { env: { PATH: '/usr/bin:/bin' }, timeout: 5000, maxBuffer: 16384 })).stdout.trim();
    if (!/^Apple clangd version \d+\.\d+\.\d+[^\n]*\n/.test(version)) return null;
    // SDK aliases are OS-managed; validate their canonical target before use.
    const sdk = await realpath(sysroot);
    if (!sdk.startsWith(root + '/SDKs/') || !await trustedSystemPath(sdk, true)) return null;
    return { executable, sysroot: sdk, version };
  } catch { return null; }
}
export async function prepareLocalGitConfig(context) {
  await privateDirectory(context.profile);
  const path = join(context.profile, 'gitconfig');
  try { await writeFile(path, '', { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await regular(path);
  if (stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) throw Error('Local Git configuration is not a private regular file. Existing configuration was retained.');
  return path;
}
const goAdmissions = new WeakMap();
export async function admitLocalGoReadScope(toolchain, context) {
  await assertAdmittedLocalGoToolchain(toolchain, context);
  goAdmissions.set(toolchain, { id: context.id, workspace: context.workspace, profile: context.profile, temporary: context.temporary });
  return toolchain;
}
function verifiedGo(toolchain, context) {
  if (toolchain === undefined) return undefined;
  const binding = goAdmissions.get(toolchain);
  if (!binding || Object.entries(binding).some(([key, value]) => context[key] !== value)) throw Error('Go read scope requires this project’s verified native selection.');
  return toolchain;
}
export function localWorkbenchEnvironment({ node, runtime, context, plugins, git, gitConfig, clangd, debugSupervisor, jsDebugSupervisor, goToolchain }) {
  const go = verifiedGo(goToolchain, context);
  const temporary = context.ipcTemporary || context.temporary;
  // Finder launches do not supply a UTF-8 locale. Bash readline otherwise
  // interprets non-ASCII path bytes as editing commands before execution.
  return { PATH: `${go ? dirname(go.entry) + ':' : ''}${git ? git.directory + ':' : ''}${dirname(node)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: '/bin/bash', LANG: 'en_US.UTF-8', LC_CTYPE: 'en_US.UTF-8', BASH_SILENCE_DEPRECATION_WARNING: '1', TMPDIR: temporary, TMP: temporary, TEMP: temporary, XDG_RUNTIME_DIR: temporary, OPENSSL_CONF: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitConfig, ...(git ? { GIT_EXEC_PATH: git.helpers } : {}),
    NODE_OPTIONS: '--no-experimental-global-navigator --max-old-space-size=1024', THEIA_APP_PROJECT_PATH: runtime.root, THEIA_CONFIG_DIR: context.profile, THEIA_DEFAULT_PLUGINS: `local-dir:${plugins}`,
    YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: context.workspace, YNX_LOCAL_PROJECT_ID: context.id, YNX_LOCAL_PROFILE: context.profile,
    ...(debugSupervisor ? { YNX_DEBUG_SOCKET: debugSupervisor.path, YNX_DEBUG_CREDENTIAL: debugSupervisor.credential, YNX_DEBUG_PROJECT: context.id } : {}),
    ...(jsDebugSupervisor ? { YNX_JS_DEBUG_SOCKET: jsDebugSupervisor.path, YNX_JS_DEBUG_CREDENTIAL: jsDebugSupervisor.credential, YNX_JS_DEBUG_PROJECT: context.id, YNX_JS_DEBUG_NODE: node, YNX_JS_DEBUG_LAUNCHER: join(dirname(node), 'local-js-debug-launcher.sh') } : {}),
    ...(go ? { YNX_IDE_GO_ENTRY: go.entry, YNX_IDE_GO_ROOT: go.root, YNX_IDE_GO_VERSION: go.version, YNX_IDE_GO_SHA: go.sha } : {}),
    ...(clangd ? { YNX_IDE_CLANGD_ENTRY: clangd.executable, YNX_IDE_CPP_SYSROOT: clangd.sysroot } : {}) };
}
export function localWorkbenchSandboxPolicy({ node, lockHelper, runtime, context, port, git, goToolchain, pathIdentities = [] }) {
  const go = verifiedGo(goToolchain, context);
  const escape = value => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const ipc = context.ipcTemporary;
  if (ipc && (!ipc.startsWith(localIpcRoot() + '/') || !/^[a-f0-9]{8}-[A-Za-z0-9]{6}$/.test(ipc.slice(localIpcRoot().length + 1)) || Buffer.byteLength(ipc) > 48)) throw Error('Local IPC policy requires its owned short session directory.');
  const reads = ['/System', '/usr', '/bin', '/sbin', '/dev', '/Library/Developer/CommandLineTools', ...(git?.readPaths || []), dirname(node), lockHelper, runtime.root, context.workspace, context.profile, context.temporary, ...(go ? [go.root] : []), ...(ipc ? [ipc] : [])];
  const pathsFor = path => pathIdentities.find(proof => proof.canonical === path)?.paths || [path];
  const ancestors = new Set(); for (const path of reads) for (let p = dirname(path); p !== '/'; p = dirname(p)) ancestors.add(p);
  for (const proof of pathIdentities) if (reads.includes(proof.canonical)) for (const ancestor of proof.ancestors) ancestors.add(ancestor);
  return ['(version 1)', '(allow default)', '(deny network*)', '(deny process-exec (literal "/usr/bin/git"))', '(deny file-read*)', '(deny file-write*)', '(allow file-read* (literal "/"))',
    ...reads.flatMap(pathsFor).map(path => `(allow file-read* (subpath "${escape(path)}"))`),
    ...[...ancestors].map(path => `(allow file-read-metadata (literal "${escape(path)}"))`),
    ...[context.workspace, context.profile, context.temporary, '/dev', ...(ipc ? [ipc] : [])].flatMap(pathsFor).map(path => `(allow file-write* (subpath "${escape(path)}"))`),
    ...(ipc ? [`(allow network-bind (local unix-socket (subpath "${escape(ipc)}")))`, `(allow network-outbound (remote unix-socket (subpath "${escape(ipc)}")))`] : []),
    `(allow network-bind (local ip "localhost:${port}"))`, `(allow network-inbound (local ip "localhost:${port}"))`].join('\n');
}
export async function localWorkbenchPathIdentities({ helper, node, lockHelper, runtime, context, git, goToolchain }) {
  const go = verifiedGo(goToolchain, context);
  const paths = [...new Set(['/System', '/usr', '/bin', '/sbin', '/dev', '/Library/Developer/CommandLineTools', ...(git?.readPaths || []), dirname(node), lockHelper, runtime.root, context.workspace, context.profile, context.temporary, ...(go ? [go.root] : []), ...(context.ipcTemporary ? [context.ipcTemporary] : [])])];
  // Every alias is proved to be the same selected vnode, never an entire volume
  // substitution. The proof's ancestor access is metadata-only.
  const proofs = [];
  // /dev is the fixed OS pseudo-filesystem and needs no project-volume alias
  // expansion. Keep its pre-existing literal boundary without new permissions.
  for (const path of paths) if (path !== '/dev') proofs.push(await inspectWorkspacePathIdentity({ helper, path }));
  return proofs;
}

// Only producer-sealed distribution bytes select executable content. Failed
// extractions remain available for recovery; an existing cache is never replaced.
export async function prepareLocalRuntime({ payload, supportRoot }) {
  if (!exact(payload) || await realpath(payload) !== payload) throw Error('Invalid bundled workbench location.');
  for (const name of ['distribution.json', 'workbench.pin.json', 'workbench.tar']) await regular(join(payload, name));
  const distribution = JSON.parse(await readFile(join(payload, 'distribution.json'), 'utf8'));
  const pin = validateRuntimeArtifact(JSON.parse(await readFile(join(payload, 'workbench.pin.json'), 'utf8')));
  if (distribution.schemaVersion !== 1 || distribution.archive !== 'workbench.tar' || distribution.roundTripTreeVerified !== true ||
      distribution.localWorkspace?.enabled !== true || distribution.localWorkspace.identity !== 'OS-user local project only' || distribution.localWorkspace.canonicalAdmission !== false ||
      !sameRuntimeArtifact(distribution.runtimeArtifact, pin) || !/^[a-f0-9]{64}$/.test(distribution.archiveSha256 || '') || pin.architecture !== `darwin-${process.arch}`)
    throw Error('Bundled local workbench distribution is invalid.');
  if (await hashFile(join(payload, 'workbench.tar')) !== distribution.archiveSha256) throw Error('Bundled workbench archive changed.');
  await privateDirectory(supportRoot);
  const caches = await privateDirectory(join(supportRoot, 'workbench-runtimes')), root = join(caches, pin.treeSha256);
  let existing;
  try { existing = await lstat(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink() || await realpath(root) !== root || existing.uid !== process.getuid() || (existing.mode & 0o022)) throw Error('Local runtime cache changed ownership or location.');
    await verifyComposedRuntime(root, pin); return { root, pin, distribution };
  }
  const staging = await mkdtemp(join(caches, '.pending-'));
  // Reject absolute/traversing names and all links/device entries before tar
  // sees the destination. The archive hash and final tree must both match.
  const archive = join(payload, 'workbench.tar');
  const names = (await exec('/usr/bin/tar', ['-tf', archive], { maxBuffer: 32 * 1024 * 1024 })).stdout.split('\n').filter(Boolean);
  const details = (await exec('/usr/bin/tar', ['-tvf', archive], { maxBuffer: 64 * 1024 * 1024 })).stdout.split('\n').filter(Boolean);
  if (names.length > 100000 || names.some(name => name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) || details.some(line => !['-', 'd'].includes(line[0]))) throw Error('Bundled archive contains unsupported paths or entries.');
  await exec('/usr/bin/tar', ['-xpf', archive, '-C', staging], { env: { PATH: '/usr/bin:/bin', COPYFILE_DISABLE: '1' }, maxBuffer: 1024 * 1024 });
  await verifyComposedRuntime(staging, pin);
  // Another local launch may finish the same immutable version first.
  try { await rename(staging, root); } catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
  await verifyComposedRuntime(root, pin);
  return { root, pin, distribution };
}

export async function localProjectContext({ supportRoot, projectDirectory }) {
  await privateDirectory(supportRoot);
  const projects = await privateDirectory(join(supportRoot, 'local-projects'));
  if (!projectDirectory) {
    const home = await privateDirectory(join(projects, 'default'));
    projectDirectory = await privateDirectory(join(home, 'workspace'));
  }
  if (!exact(projectDirectory) || await realpath(projectDirectory) !== projectDirectory || !(await lstat(projectDirectory)).isDirectory()) throw Error('Select a canonical local project directory.');
  const key = createHash('sha256').update(projectDirectory).digest('hex');
  const state = await privateDirectory(join(projects, key)), profile = await privateDirectory(join(state, 'profile')), temporary = await privateDirectory(join(state, 'tmp'));
  const idFile = join(state, 'project-id');
  try { await writeFile(idFile, randomUUID() + '\n', { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await regular(idFile);
  const id = (await readFile(idFile, 'utf8')).trim(); if (!UUID.test(id)) throw Error('Local project identity is damaged. Existing files were retained.');
  const binding = { schemaVersion: 1, projectId: id, workspace: projectDirectory, profile };
  const bindingFile = join(profile, 'ynx-local-project.json');
  try {
    await regular(bindingFile);
    if (JSON.stringify(JSON.parse(await readFile(bindingFile, 'utf8'))) !== JSON.stringify(binding)) throw Error('Local project profile belongs to another workspace.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const pending = join(profile, `.binding-${randomUUID()}`);
    await writeFile(pending, JSON.stringify(binding) + '\n', { flag: 'wx', mode: 0o600 });
    const { link } = await import('node:fs/promises');
    try { await link(pending, bindingFile); } catch (failure) { if (failure.code !== 'EEXIST') throw failure; }
    await regular(bindingFile);
    if (JSON.stringify(JSON.parse(await readFile(bindingFile, 'utf8'))) !== JSON.stringify(binding)) throw Error('Local project profile changed during startup.');
  }
  return { workspace: projectDirectory, profile, temporary, id };
}

export async function prepareLocalPlugins({ runtime, context }) {
  // Extensions can keep runtime state beside their code (debugpy does this).
  // Fresh project-private copies permit that within the EXISTING temporary
  // write boundary; the shared sealed cache and network policy stay unchanged.
  if (context.temporary !== join(dirname(context.profile), 'tmp')) throw Error('Extension state is outside the project profile.');
  await privateDirectory(context.profile); await privateDirectory(context.temporary);
  const binding = JSON.parse(await readFile(join(context.profile, 'ynx-local-project.json'), 'utf8'));
  if (binding.schemaVersion !== 1 || binding.projectId !== context.id || binding.workspace !== context.workspace || binding.profile !== context.profile)
    throw Error('Extension state belongs to a different project.');
  await verifyComposedRuntime(runtime.root, runtime.pin);
  const source = join(runtime.root, 'plugins'), digest = await composedTreeDigest(source);
  const session = await mkdtemp(join(context.temporary, 'extensions-')), plugins = join(session, 'plugins');
  await cp(source, plugins, { recursive: true, errorOnExist: true, force: false, mode: constants.COPYFILE_FICLONE });
  if (await composedTreeDigest(plugins) !== digest || await composedTreeDigest(source) !== digest)
    throw Error('Extension copy changed before launch.');
  await writeFile(join(session, 'source.json'), JSON.stringify({ runtimeArtifact: runtime.pin, pluginTreeSha256: digest, projectId: context.id,
    scope: 'Fresh per-launch extension copy; source cache remains sealed. Runtime state is not reused as executable source.' }) + '\n', { flag: 'wx', mode: 0o600 });
  return plugins;
}

export function isSupportedLocalNodeVersion(version) { return version === 'v26.7.0' || version === 'v24.19.0'; }
export async function startLocalWorkbench({ payload, supportRoot, projectDirectory, node = process.execPath, lockHelper, goToolchain, port = 0, log = process.stderr, readinessTimeoutMs = 30000 }) {
  if (process.platform !== 'darwin') throw Error('Local workbench currently requires macOS.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Local workbench port must be an integer between 0 and 65535.');
  await regular(node);
  if (!exact(lockHelper)) throw Error('The bundled local profile lock helper is required.');
  await regular(lockHelper);
  const version = (await exec(node, ['--version'], { timeout: 5000 })).stdout.trim();
  if (!isSupportedLocalNodeVersion(version)) throw Error('The sealed macOS workbench requires an exact reviewed bundled Node runtime.');
  const runtime = await prepareLocalRuntime({ payload, supportRoot });
  if (runtime.distribution.requiredNodeVersion !== version) throw Error('Bundled Node version does not match the workbench build.');
  const context = await localProjectContext({ supportRoot, projectDirectory });
  if (goToolchain !== undefined) await admitLocalGoReadScope(goToolchain, context);
  const ipc = await createLocalIpcSession(context);
  context.ipcTemporary = ipc.path;
  let debugSupervisor, jsDebugSupervisor;
  try {
  const reserve = createServer(); await new Promise((ok, fail) => { reserve.once('error', fail); reserve.listen(port, '127.0.0.1', ok); });
  port = reserve.address().port; await new Promise(ok => reserve.close(ok));
  const git = await findTrustedLocalGit();
  const clangd = await inspectTrustedLocalClangd('/Library/Developer/CommandLineTools');
  if (!git) log.write('YNX_LOCAL_GIT_UNAVAILABLE: No supported trusted local Git installation is available.\n');
  const gitConfig = await prepareLocalGitConfig(context);
  const plugins = await prepareLocalPlugins({ runtime, context });
  const pathIdentityHelper = join(dirname(lockHelper), 'workspace-path-identity');
  const pathIdentities = await localWorkbenchPathIdentities({ helper: pathIdentityHelper, node, lockHelper, runtime, context, git, goToolchain });
  const policy = localWorkbenchSandboxPolicy({ node, lockHelper, runtime, context, port, git, goToolchain, pathIdentities });
  debugSupervisor = await createDebugSessionSupervisor({ context, plugins, runtime, basePolicy: policy,
    pathIdentities, pathIdentityHelper, warn: error => log.write(`YNX_LOCAL_DEBUG_CLEANUP_FAILED: ${error.message}\n`), env: localWorkbenchEnvironment({ node, runtime, context, plugins, git, gitConfig, clangd, goToolchain }) });
  jsDebugSupervisor = await createJsDebugSessionSupervisor({ context, plugins, runtime, basePolicy: policy, pathIdentities, warn: error => log.write(`YNX_LOCAL_JS_DEBUG_CLEANUP_FAILED: ${error.message}\n`) });
  for (const proof of pathIdentities) await assertWorkspacePathIdentity(proof);
  await ipc.beginLaunch();
  const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, lockHelper, context.profile, node, join(runtime.root, 'lib/backend/main.js'), context.workspace, '--hostname', '127.0.0.1', '--port', String(port), '--plugins', `local-dir:${plugins}`], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: context.workspace,
    env: localWorkbenchEnvironment({ node, runtime, context, plugins, git, gitConfig, clangd, debugSupervisor, jsDebugSupervisor, goToolchain }),
  });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  let ended = false, failure, exitCode; const exited = new Promise(resolve => { child.once('error', error => { failure = error; ended = true; resolve({ error }); }); child.once('close', (code, signal) => { ended = true; exitCode = code; resolve({ code, signal }); }); });
  let stopping;
  const stop = () => stopping ||= (async () => { let cleanupError; if (!ended) {
    // PTY children can own separate process groups. The sealed native helper
    // verifies OS UID, ancestry and process start time before signalling them.
    try { await exec(join(runtime.root, 'lib/backend/ynx-process-tree'), [String(child.pid), '--force'], { timeout: 5000 }); } catch (error) { cleanupError = error; }
    try { await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(Error('Local backend exit was not verified')), 5000).unref())]); }
    catch (error) { cleanupError ||= error; } }
    // The single native cleanup already owns TERM/escalation and identity
    // checks. Never signal a historical process-group number after exit.
    const debugResults = await Promise.allSettled([debugSupervisor.stop(), jsDebugSupervisor.stop()]);
    const debugErrors = debugResults.filter(result => result.status === 'rejected').map(result => result.reason);
    if (debugErrors.length) throw new AggregateError(debugErrors, 'Local debug session cleanup could not be verified.');
    if (cleanupError) throw Error('Local child cleanup could not be verified. Runtime state was retained.', { cause: cleanupError });
    if (!await ipc.cleanup({ confirmedExited: ended })) throw Error('Local IPC cleanup could not be verified. Session residue was retained.');
  })();
  try { if (child.pid) await ipc.attach(child.pid); } catch (error) { await stop(); throw error; }
  // Unexpected backend exit follows the same process/session cleanup as Stop.
  exited.then(() => stop().catch(error => log.write(`YNX_LOCAL_IPC_CLEANUP_FAILED: ${error.message}\n`)));
  const url = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + readinessTimeoutMs;
    while (Date.now() < deadline) {
      if (ended) {
        const error = failure || Error(exitCode === 73 ? 'This local project is already open in another YNX Developer window.' : 'Local workbench exited before becoming ready.');
        if (!failure && exitCode === 73) error.code = 'YNX_LOCAL_PROJECT_ALREADY_OPEN';
        throw error;
      }
      try { const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1000) }); if (response.ok) return { ...runtime, ...context, url, port, pid: child.pid, stop, exited }; } catch {}
      await new Promise(ok => setTimeout(ok, 150));
    }
    throw Error('Local workbench did not become ready. Project and profile were retained.');
  } catch (error) { await stop(); throw error; }
  } catch (error) {
    // Setup failures precede spawn, or the inner stop has already confirmed
    // exit. Unknown in-flight launch residue is deliberately retained.
    try { const results = await Promise.allSettled([debugSupervisor?.stop(), jsDebugSupervisor?.stop()]); const failures = results.filter(result => result.status === 'rejected').map(result => result.reason); if (failures.length) throw new AggregateError(failures, 'Local debug setup cleanup failed'); await ipc.cleanup(); } catch (cleanupError) { log.write(`YNX_LOCAL_IPC_CLEANUP_FAILED: ${cleanupError.message}\n`); }
    throw error;
  }
}
