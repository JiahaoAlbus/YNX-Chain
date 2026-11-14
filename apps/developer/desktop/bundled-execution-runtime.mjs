import { lstat, realpath, readdir, readFile, mkdir, mkdtemp, copyFile, chmod, rename, statfs } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectWorkspacePathIdentity, inspectBundledRuntimePathIdentity, assertWorkspacePathIdentity } from './workspace-path-identity.mjs';

const exec = promisify(execFile);
// Each full verification owns one child. Cancellation/timeout never becomes
// success, including late exit 0; completion waits for the original close.
export function verifyBundledSignature(app, { signal, phase = 'before-copy', report = () => {}, spawnChild = spawn, deadlineMs = 90000, killGraceMs = 2000 } = {}) {
  if (!['before-copy', 'after-copy'].includes(phase)) return Promise.reject(Error('Invalid signature phase'));
  if (signal?.aborted) return Promise.reject(Object.assign(Error('Package verification cancelled.'), { code: 'YNX_SIGNATURE_CANCELLED' }));
  return new Promise((resolve, reject) => {
    let child, failure, timer, escalation, heartbeat, stderr = '', closed = false;
    const started = performance.now();
    const emit = state => { try { report({ phase, state, elapsedMs: Math.round(performance.now() - started), code: failure?.code || null }); } catch {} };
    const fail = (code, message) => {
      if (failure || closed) return;
      failure = Object.assign(Error(message), { code, phase });
      child.kill('SIGTERM');
      escalation = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, killGraceMs);
    };
    const abort = () => fail('YNX_SIGNATURE_CANCELLED', 'Package verification cancelled.');
    try { child = spawnChild('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (error) { reject(error); return; }
    emit('started'); heartbeat = setInterval(() => emit('progress'), 1000);
    child.stderr?.on('data', chunk => { if (stderr.length < 16384) stderr += String(chunk).slice(0, 16384 - stderr.length); });
    child.once('error', error => { failure ||= error; });
    child.once('close', (code, terminationSignal) => {
      closed = true; clearTimeout(timer); clearTimeout(escalation); clearInterval(heartbeat); signal?.removeEventListener('abort', abort);
      if (!failure && (code !== 0 || terminationSignal)) failure = Object.assign(Error('Full package signature verification failed.'), { code: 'YNX_SIGNATURE_INVALID', phase, exitCode: code, signal: terminationSignal, stderr });
      emit(failure ? 'failed' : 'verified');
      if (failure) reject(failure); else resolve();
    });
    timer = setTimeout(() => fail('YNX_SIGNATURE_TIMEOUT', 'Full package signature verification exceeded its bounded phase budget.'), deadlineMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
const digest = value => createHash('sha256').update(value).digest('hex');
async function hash(path) {
  const h = createHash('sha256');
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest('hex');
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077) || await realpath(path) !== path)
    throw Error('Execution cache must be private and canonical.');
}
// QA profiles isolate project state, credentials and settings. Immutable,
// reverified runtime bytes need not be extracted once per candidate UUID.
// Only the normal QA namespace uses this store; explicit/custom profiles keep
// their original cache location. Never migrate or remove an existing cache.
export async function runtimeCacheSupportRoot(supportRoot, { home = homedir() } = {}) {
  const profiles = join(home, 'Library/Application Support/YNXDeveloper-QA');
  const candidate = typeof supportRoot === 'string' && supportRoot.startsWith(profiles + '/') ? supportRoot.slice(profiles.length + 1) : '';
  if (!/^[a-f0-9]{40}-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(candidate)) return supportRoot;
  if (resolve(supportRoot) !== supportRoot || resolve(home) !== home) throw Error('Runtime cache roots must be canonical.');
  const parent = dirname(profiles);
  for (let p = parent; ; p = dirname(p)) {
    const s = await lstat(p);
    if (!s.isDirectory() || s.isSymbolicLink() || ![0, process.getuid()].includes(s.uid) ||
        ((s.mode & 0o022) && !(s.uid === 0 && (s.mode & 0o1000))))
      throw Error('Shared runtime cache has an unsafe ancestor.');
    if (p === '/') break;
  }
  await privateDirectory(profiles);
  await privateDirectory(supportRoot);
  const shared = join(parent, 'YNXDeveloper-RuntimeCache');
  await privateDirectory(shared);
  return shared;
}
const executionFiles = ['local-js-debug-launcher.mjs', 'local-js-debug-launcher.sh', 'node', 'workspace-path-identity', 'ynx-js-node', 'ynx-local-workbench-lock'];
async function inventory(root, source = false) {
  const rows = [];
  async function visit(relative) {
    const path = join(root, relative), s = await lstat(path);
    if (s.isSymbolicLink() || s.uid !== process.getuid() && s.uid !== 0 || (s.mode & 0o022))
      throw Error('Bundled execution input has unsafe ownership or mode.');
    if (s.isDirectory()) {
      rows.push({ path: relative, type: 'directory' });
      const names = (await readdir(path)).sort();
      // npm/notices stay in the sealed App and are not subordinate runtime
      // executables. In particular do not follow npm's normal .bin symlinks.
      const selected = source ? names.filter(n => !['distribution.json', 'npm', 'notices'].includes(n)) : names;
      if (JSON.stringify(selected) !== JSON.stringify(executionFiles)) throw Error('Unexpected bundled execution input closure.');
      for (const name of selected) await visit(name);
    } else if (s.isFile()) {
      rows.push({ path: relative, type: 'file', bytes: s.size, executable: !!(s.mode & 0o111), sha256: await hash(path) });
    } else throw Error('Unsupported bundled execution input.');
  }
  await visit('');
  return rows;
}

// Data/project proofs remain strict. Only this running package's sealed inputs
// can be copied into an owner-private executable cache when installation
// ancestry is writable (for example a removable-volume mount point).
export async function prepareBundledExecutionRuntime({ node, lockHelper, supportRoot, reserveAllocation, signal, onVerification }) {
  const own = fileURLToPath(import.meta.url), suffix = '/Contents/Resources/code/apps/developer/desktop/bundled-execution-runtime.mjs';
  if (process.platform !== 'darwin' || !own.endsWith(suffix)) return { node, lockHelper };
  const app = own.slice(0, -suffix.length), resources = join(app, 'Contents/Resources'), runtime = join(resources, 'runtime');
  const helper = join(runtime, 'workspace-path-identity');
  if (node !== join(runtime, 'node') || lockHelper !== join(runtime, 'ynx-local-workbench-lock') || await realpath(app) !== app)
    throw Error('Execution staging requires this canonical package and its exact runtime inputs.');
  const packageStat = await lstat(app);
  if (!packageStat.isDirectory() || packageStat.isSymbolicLink() || ![0, process.getuid()].includes(packageStat.uid) || (packageStat.mode & 0o022))
    throw Error('Package ownership or mode is unsafe.');
  for (const path of [runtime, ...executionFiles.map(name => join(runtime, name))]) {
    const s = await lstat(path);
    if (s.isSymbolicLink() || ![0, packageStat.uid].includes(s.uid) || (s.mode & 0o022) || (path === runtime ? !s.isDirectory() : !s.isFile()))
      throw Error('Bundled execution input has unsafe ownership or mode.');
  }
  try {
    await inspectWorkspacePathIdentity({ helper, path: runtime });
    return { node, lockHelper };
  } catch (error) {
    if (error.code !== 'YNX_PATH_UNSAFE_ANCESTOR') throw error;
  }
  if (dirname(app) === '/Applications') {
    await inspectBundledRuntimePathIdentity({ helper, path: runtime });
    return { node, lockHelper };
  }
  const verify = phase => verifyBundledSignature(app, { signal, phase, report: onVerification });
  await verify('before-copy');
  const provenance = JSON.parse(await readFile(join(resources, 'build-provenance.json'), 'utf8'));
  if (provenance.productId !== 'ynx-developer-v1' || provenance.sourceDirty !== false || provenance.platform !== `macos-${process.arch}`)
    throw Error('Package execution provenance is invalid.');
  const bootstrapSource = join(dirname(own), 'local-debugpy-bootstrap.py'), bootstrapStat = await lstat(bootstrapSource);
  if (!bootstrapStat.isFile() || bootstrapStat.isSymbolicLink() || (bootstrapStat.mode & 0o022) || ![0, packageStat.uid].includes(bootstrapStat.uid))
    throw Error('Bundled Python bootstrap is unsafe.');
  const rows = await inventory(runtime, true), bootstrapHash = await hash(bootstrapSource);
  const key = digest(JSON.stringify({ rows, bootstrapHash }));
  await privateDirectory(supportRoot);
  // Check the destination ancestry without executing the bundled helper through
  // an untrusted path. The real native proof follows once its copy is sealed.
  for (let p = supportRoot; ; p = dirname(p)) {
    const s = await lstat(p);
    if (!s.isDirectory() || s.isSymbolicLink() || ((s.mode & 0o022) && !(s.uid === 0 && (s.mode & 0o1000))))
      throw Error('Execution cache has an unsafe writable ancestor.');
    if (p === '/') break;
  }
  const parent = join(supportRoot, 'bundled-execution'); await privateDirectory(parent);
  const destination = join(parent, key);
  async function check(root) {
    await privateDirectory(root);
    if (JSON.stringify(await inventory(join(root, 'runtime'))) !== JSON.stringify(rows) || await hash(join(root, 'local-debugpy-bootstrap.py')) !== bootstrapHash)
      throw Error('Cached execution inputs changed.');
    const b = await lstat(join(root, 'local-debugpy-bootstrap.py'));
    if (!b.isFile() || b.isSymbolicLink() || b.uid !== process.getuid() || (b.mode & 0o022)) throw Error('Cached Python bootstrap is unsafe.');
  }
  let existing = false;
  try { await lstat(destination); existing = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!existing) {
    const bytes = rows.reduce((sum, r) => sum + (r.bytes || 0), bootstrapStat.size), space = await statfs(parent, { bigint: true });
    if (reserveAllocation) await reserveAllocation(bytes, rows.length + 2);
    if (space.bavail * space.bsize < BigInt(bytes) + 2n * 1024n ** 3n + 64n * 1024n ** 2n)
      throw Object.assign(Error('Insufficient space for private execution inputs and the 2 GiB reserve.'), { code: 'YNX_EXECUTION_CACHE_SPACE' });
    const staging = await mkdtemp(join(parent, '.pending-'));
    for (const row of rows) {
      const target = join(staging, 'runtime', row.path);
      if (row.type === 'directory') await mkdir(target, { mode: 0o700 });
      else { await copyFile(join(runtime, row.path), target, constants.COPYFILE_EXCL); await chmod(target, row.executable ? 0o700 : 0o600); }
    }
    await copyFile(bootstrapSource, join(staging, 'local-debugpy-bootstrap.py'), constants.COPYFILE_EXCL);
    await chmod(join(staging, 'local-debugpy-bootstrap.py'), 0o600);
    await check(staging);
    if (JSON.stringify(await inventory(runtime, true)) !== JSON.stringify(rows) || await hash(bootstrapSource) !== bootstrapHash)
      throw Error('Package execution inputs changed during staging.');
    await verify('after-copy');
    const current = await lstat(app);
    if (current.dev !== packageStat.dev || current.ino !== packageStat.ino || current.uid !== packageStat.uid || current.mode !== packageStat.mode)
      throw Error('Package changed during execution staging.');
    // Never replace an existing cache, including another launch's winner.
    try { await lstat(destination); throw Error('Execution cache appeared during staging; retry after reconciliation.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    signal?.throwIfAborted();
    await rename(staging, destination);
  }
  signal?.throwIfAborted();
  await check(destination);
  const stagedRuntime = join(destination, 'runtime'), stagedHelper = join(stagedRuntime, 'workspace-path-identity');
  const proof = await inspectWorkspacePathIdentity({ helper: stagedHelper, path: stagedRuntime });
  await assertWorkspacePathIdentity(proof);
  return { node: join(stagedRuntime, 'node'), lockHelper: join(stagedRuntime, 'ynx-local-workbench-lock'), bootstrap: join(destination, 'local-debugpy-bootstrap.py') };
}
