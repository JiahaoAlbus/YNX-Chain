import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, lstat, realpath, readFile, writeFile, rename, mkdtemp } from 'node:fs/promises';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyComposedRuntime, validateRuntimeArtifact, sameRuntimeArtifact } from '../services/codeoss-service/src/composed-runtime.mjs';

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

export async function startLocalWorkbench({ payload, supportRoot, projectDirectory, node = process.execPath, lockHelper, port = 0, log = process.stderr, readinessTimeoutMs = 30000 }) {
  if (process.platform !== 'darwin') throw Error('Local workbench currently requires macOS.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Local workbench port must be an integer between 0 and 65535.');
  await regular(node);
  if (!exact(lockHelper)) throw Error('The bundled local profile lock helper is required.');
  await regular(lockHelper);
  const version = (await exec(node, ['--version'], { timeout: 5000 })).stdout.trim();
  if (!/^v26\./.test(version)) throw Error('The sealed workbench requires a bundled Node 26 runtime.');
  const runtime = await prepareLocalRuntime({ payload, supportRoot });
  if (runtime.distribution.requiredNodeVersion && runtime.distribution.requiredNodeVersion.replace(/^v/, '') !== version.slice(1)) throw Error('Bundled Node version does not match the workbench build.');
  const context = await localProjectContext({ supportRoot, projectDirectory });
  const reserve = createServer(); await new Promise((ok, fail) => { reserve.once('error', fail); reserve.listen(port, '127.0.0.1', ok); });
  port = reserve.address().port; await new Promise(ok => reserve.close(ok));
  const escape = value => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  const reads = ['/System', '/usr', '/bin', '/sbin', '/dev', '/Library/Developer/CommandLineTools', dirname(node), lockHelper, runtime.root, context.workspace, context.profile, context.temporary];
  const ancestors = new Set(); for (const path of reads) for (let p = dirname(path); p !== '/'; p = dirname(p)) ancestors.add(p);
  const policy = ['(version 1)', '(allow default)', '(deny network*)', '(deny file-read*)', '(deny file-write*)', '(allow file-read* (literal "/"))',
    ...reads.map(path => `(allow file-read* (subpath "${escape(path)}"))`),
    ...[...ancestors].map(path => `(allow file-read-metadata (literal "${escape(path)}"))`),
    ...[context.workspace, context.profile, context.temporary, '/dev'].map(path => `(allow file-write* (subpath "${escape(path)}"))`),
    `(allow network-bind (local ip "localhost:${port}"))`, `(allow network-inbound (local ip "localhost:${port}"))`].join('\n');
  const plugins = join(runtime.root, 'plugins');
  const child = spawn('/usr/bin/sandbox-exec', ['-p', policy, lockHelper, context.profile, node, join(runtime.root, 'lib/backend/main.js'), context.workspace, '--hostname', '127.0.0.1', '--port', String(port), '--plugins', `local-dir:${plugins}`], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: context.workspace,
    env: { PATH: `${dirname(node)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: '/bin/bash', TMPDIR: context.temporary, OPENSSL_CONF: '/dev/null',
      NODE_OPTIONS: '--no-experimental-global-navigator --max-old-space-size=1024', THEIA_APP_PROJECT_PATH: runtime.root, THEIA_CONFIG_DIR: context.profile, THEIA_DEFAULT_PLUGINS: `local-dir:${plugins}`,
      YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: context.workspace, YNX_LOCAL_PROJECT_ID: context.id, YNX_LOCAL_PROFILE: context.profile },
  });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  let ended = false, failure, exitCode; const exited = new Promise(resolve => { child.once('error', error => { failure = error; ended = true; resolve({ error }); }); child.once('close', (code, signal) => { ended = true; exitCode = code; resolve({ code, signal }); }); });
  let stopping;
  const stop = () => stopping ||= (async () => { let cleanupError; if (!ended) {
    // PTY children can own separate process groups. The sealed native helper
    // verifies OS UID, ancestry and process start time before signalling them.
    try { await exec(join(runtime.root, 'lib/backend/ynx-process-tree'), [String(child.pid)], { timeout: 5000 }); } catch (error) { cleanupError = error; }
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2500); try { await exited; } finally { clearTimeout(timer); } }
    // Also terminate any surviving descendants after backend exit.
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    if (cleanupError) throw Error('Local child cleanup could not be verified. Runtime state was retained.', { cause: cleanupError });
  })();
  const url = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + readinessTimeoutMs;
    while (Date.now() < deadline) {
      if (ended) throw failure || Error(exitCode === 73 ? 'This local project is already open in another YNX Developer window.' : 'Local workbench exited before becoming ready.');
      try { const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1000) }); if (response.ok) return { ...runtime, ...context, url, port, pid: child.pid, stop, exited }; } catch {}
      await new Promise(ok => setTimeout(ok, 150));
    }
    throw Error('Local workbench did not become ready. Project and profile were retained.');
  } catch (error) { await stop(); throw error; }
}
