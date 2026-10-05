import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, normalize } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const proofs = new WeakSet();
const exact = path => typeof path === 'string' && isAbsolute(path) && normalize(path) === path && !/[\0\r\n]/.test(path);
const identity = s => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), mode: Number(s.mode) });
const vnodeStat = path => lstat(path, { bigint: true });
const same = (a, b) => ['dev', 'ino', 'uid', 'mode'].every(key => a[key] === b[key]);
async function snapshots(path) {
  const entries = [];
  for (let p = path; ; p = dirname(p)) {
    const stat = await vnodeStat(p);
    if (stat.isSymbolicLink() || (p !== path && !stat.isDirectory())) throw Error('Workspace path contains a symbolic link or invalid ancestor.');
    // A different OS user must not be able to replace a path component. Sticky
    // system temporary directories preserve owner-only unlink semantics.
    if (p !== path && (Number(stat.mode) & 0o022) && !(stat.uid === 0n && (Number(stat.mode) & 0o1000))) throw Error('Workspace path has an unsafe writable ancestor.');
    entries.push({ path: p, ...identity(stat) });
    if (p === '/') break;
  }
  return entries;
}
/** Evidence for a selected root only; no authorization, service grant or sandbox. */
export async function inspectWorkspacePathIdentity({ helper, path }) {
  if (process.platform !== 'darwin') throw Error('Native vnode path identity requires macOS.');
  if (!exact(path) || await realpath(path) !== path || !exact(helper) || await realpath(helper) !== helper) throw Error('Path identity requires canonical absolute inputs.');
  const h = await lstat(helper); if (!h.isFile() || h.isSymbolicLink() || !(h.mode & 0o111)) throw Error('Native path identity helper is unavailable.');
  const before = await snapshots(path);
  const { stdout } = await exec(helper, [path], { timeout: 5000, maxBuffer: 16384 });
  const evidence = JSON.parse(stdout);
  if (!/^(?:[a-f0-9]{2}){1,4095}$/.test(evidence.kernelPathHex || '')) throw Error('Invalid native path evidence.');
  const alias = Buffer.from(evidence.kernelPathHex, 'hex').toString('utf8');
  if (Buffer.from(alias, 'utf8').toString('hex') !== evidence.kernelPathHex || !exact(alias) || !same(before[0], evidence)) throw Error('Workspace vnode changed during path inspection.');
  const aliasEntries = await snapshots(alias);
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
  if (await realpath(proof.canonical) !== proof.canonical) throw Error('Selected workspace location changed.');
  for (const entry of proof.snapshots) {
    const current = await vnodeStat(entry.path);
    if (current.isSymbolicLink() || !same(identity(current), entry)) throw Error('Workspace path or ancestor was replaced.');
  }
  return proof;
}
