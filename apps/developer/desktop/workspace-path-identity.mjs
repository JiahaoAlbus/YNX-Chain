import { lstat, realpath, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, normalize, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const proofs = new WeakSet();
const installedProofs = new WeakMap();
const exact = path => typeof path === 'string' && isAbsolute(path) && normalize(path) === path && !/[\0\r\n]/.test(path);
const identity = s => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), mode: Number(s.mode) });
const vnodeStat = path => lstat(path, { bigint: true });
const same = (a, b) => ['dev', 'ino', 'uid', 'mode'].every(key => a[key] === b[key]);
async function snapshots(path, installationParent) {
  const entries = [];
  for (let p = path; ; p = dirname(p)) {
    const stat = await vnodeStat(p);
    if (stat.isSymbolicLink() || (p !== path && !stat.isDirectory())) throw Error('Workspace path contains a symbolic link or invalid ancestor.');
    // A different OS user must not be able to replace a path component. Sticky
    // system temporary directories preserve owner-only unlink semantics.
    if (p !== path && (Number(stat.mode) & 0o022) && !(stat.uid === 0n && (Number(stat.mode) & 0o1000)) &&
        !(installationParent && stat.uid === 0n && stat.gid === 80n && (Number(stat.mode) & 0o7777) === 0o775 && same(identity(stat), installationParent))) throw Error('Workspace path has an unsafe writable ancestor.');
    entries.push({ path: p, ...identity(stat), gid: Number(stat.gid) });
    if (p === '/') break;
  }
  return entries;
}
/** Evidence for a selected root only; no authorization, service grant or sandbox. */
export async function inspectWorkspacePathIdentity({ helper, path }) {
  return inspectPathIdentity({ helper, path });
}

// Only this running package may identify its read-only executable inputs.
// Callers cannot supply an installation root or relax project/data checks.
export async function inspectBundledRuntimePathIdentity({ helper, path }) {
  const modulePath = fileURLToPath(import.meta.url);
  const suffix = '/Contents/Resources/code/apps/developer/desktop/workspace-path-identity.mjs';
  if (!modulePath.endsWith(suffix)) return inspectWorkspacePathIdentity({ helper, path });
  const app = modulePath.slice(0, -suffix.length), resources = join(app, 'Contents/Resources');
  const runtime = join(resources, 'runtime');
  if (path !== runtime && path !== join(runtime, 'ynx-local-workbench-lock') && path !== join(dirname(modulePath), 'local-debugpy-bootstrap.py'))
    throw Error('Bundled path proof is restricted to read-only runtime inputs.');
  if (helper !== join(runtime, 'workspace-path-identity') || await realpath(app) !== app)
    throw Error('Bundled path proof requires its own canonical package.');
  // Standard /Applications is root:admin 0775. This exception applies only
  // to the installed, signed package above, never a selected workspace.
  if (dirname(app) !== '/Applications') return inspectWorkspacePathIdentity({ helper, path });
  const parent = await vnodeStat('/Applications');
  if (parent.isSymbolicLink() || !parent.isDirectory() || parent.uid !== 0n || parent.gid !== 80n || (Number(parent.mode) & 0o7777) !== 0o775)
    return inspectWorkspacePathIdentity({ helper, path });
  const packageStat = await vnodeStat(app);
  if (!packageStat.isDirectory() || packageStat.isSymbolicLink() || ![0n, BigInt(process.getuid())].includes(packageStat.uid) || (Number(packageStat.mode) & 0o022))
    throw Error('Installed package ownership or mode is unsafe.');
  const inputStat = await vnodeStat(path);
  if (inputStat.isSymbolicLink() || (Number(inputStat.mode) & 0o022) || ![0n, packageStat.uid].includes(inputStat.uid))
    throw Error('Installed runtime input ownership or mode is unsafe.');
  const provenance = JSON.parse(await readFile(join(resources, 'build-provenance.json'), 'utf8'));
  if (provenance.productId !== 'ynx-developer-v1' || provenance.sourceDirty !== false || provenance.platform !== `macos-${process.arch}`)
    throw Error('Installed package provenance is invalid.');
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 30000, maxBuffer: 16384 });
  const proof = await inspectPathIdentity({ helper, path, installationParent: identity(parent) });
  if (!same(identity(await vnodeStat(app)), identity(packageStat))) throw Error('Installed package changed during verification.');
  installedProofs.set(proof, app);
  return proof;
}

async function inspectPathIdentity({ helper, path, installationParent }) {
  if (process.platform !== 'darwin') throw Error('Native vnode path identity requires macOS.');
  if (!exact(path) || await realpath(path) !== path || !exact(helper) || await realpath(helper) !== helper) throw Error('Path identity requires canonical absolute inputs.');
  const h = await lstat(helper); if (!h.isFile() || h.isSymbolicLink() || !(h.mode & 0o111)) throw Error('Native path identity helper is unavailable.');
  const before = await snapshots(path, installationParent);
  const { stdout } = await exec(helper, [path], { timeout: 5000, maxBuffer: 16384 });
  const evidence = JSON.parse(stdout);
  if (!/^(?:[a-f0-9]{2}){1,4095}$/.test(evidence.kernelPathHex || '')) throw Error('Invalid native path evidence.');
  const alias = Buffer.from(evidence.kernelPathHex, 'hex').toString('utf8');
  if (Buffer.from(alias, 'utf8').toString('hex') !== evidence.kernelPathHex || !exact(alias) || !same(before[0], evidence)) throw Error('Workspace vnode changed during path inspection.');
  const aliasEntries = await snapshots(alias, installationParent);
  if (!same(aliasEntries[0], before[0])) throw Error('Kernel path does not identify the selected vnode.');
  const paths = Object.freeze([...new Set([path, alias])]);
  const ancestors = Object.freeze([...new Set([...before, ...aliasEntries].map(item => item.path).filter(p => !paths.includes(p)))]);
  const proof = Object.freeze({ schema: 'ynx-workspace-path-identity/v1', canonical: path, paths, ancestors,
    identity: Object.freeze(identity(await vnodeStat(path))), snapshots: Object.freeze([...before, ...aliasEntries].map(Object.freeze)) });
  proofs.add(proof); await assertWorkspacePathIdentity(proof); return proof;
}
/** Must be called immediately before launch, and before reuse of these aliases. */
export async function assertWorkspacePathIdentity(proof) {
  if (!proofs.has(proof)) throw Error('Untrusted workspace path evidence.');
  const app = installedProofs.get(proof);
  if (app) await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 30000, maxBuffer: 16384 });
  if (await realpath(proof.canonical) !== proof.canonical) throw Error('Selected workspace location changed.');
  for (const entry of proof.snapshots) {
    const current = await vnodeStat(entry.path);
    if (current.isSymbolicLink() || (!same(identity(current), entry) || Number(current.gid) !== entry.gid)) throw Error('Workspace path or ancestor was replaced.');
  }
  return proof;
}
