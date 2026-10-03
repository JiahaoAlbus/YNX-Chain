import { mkdir, readdir, lstat, readFile, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

// Package a previously built exact-source output. No build, deploy, credentials
// or production routing is inferred from this static carrier.
const [input, destination, sourceCommit, sourceTree] = process.argv.slice(2);
if (!input || !destination || !/^[a-f0-9]{40}$/.test(sourceCommit ?? '') || !/^[a-f0-9]{40}$/.test(sourceTree ?? '')) throw new Error('EXACT_SOURCE_AND_OUTPUT_REQUIRED');
const root = resolve(input), target = resolve(destination);
try { await lstat(target); throw new Error('CARRIER_DESTINATION_ALREADY_EXISTS'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const rows = [];
async function walk(directory, prefix = '') {
  for (const name of (await readdir(directory)).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const file = join(directory, name), stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error('CARRIER_SYMLINK_REJECTED');
    if (stat.isDirectory()) await walk(file, relative);
    else if (stat.isFile()) {
      const bytes = await readFile(file);
      rows.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    } else throw new Error('CARRIER_SPECIAL_FILE_REJECTED');
  }
}
await walk(root);
for (const required of ['index.html', 'app.js', 'wallet-provider.js', 'assets/ynx-wallet.svg', 'assets/metamask.svg', 'private-session-ui.js', 'matrix-session-ui.js', 'matrix/login-callback.html', 'matrix/login-callback-entry.mjs']) {
  if (!rows.some(row => row.path === required)) throw new Error(`CARRIER_REQUIRED_FILE_MISSING:${required}`);
}
await mkdir(join(target, '.vercel/output'), { recursive: true });
await cp(root, join(target, '.vercel/output/static'), { recursive: true, errorOnExist: true, force: false });
await writeFile(join(target, '.vercel/output/config.json'), '{"version":3}\n', { flag: 'wx' });
const manifest = {
  schemaVersion: 'ynx-social-static-candidate/v1', sourceCommit, sourceTree,
  buildCommand: 'node web/build.mjs', sourceOutputDirectory: 'web/dist',
  carrierOutputDirectory: '.vercel/output', files: rows,
  deployable: false, activationApproved: false, hostExecutionApproved: false,
  executor: null, lease: null, currentDeployment: null, rollbackDeployment: null,
  protectedCallbackRouting: 'REQUIRES_EXACT_RELEASE_OWNER_COMPOSITION',
  dependencyBuildProvenance: 'NOT_VERIFIED',
  notes: 'Static bytes only. Minimal output API config is not production callback routing/security policy or a deployment lease.'
};
await writeFile(join(target, 'candidate-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ sourceCommit, sourceTree, files: rows.length, staticBytes: rows.reduce((n, row) => n + row.bytes, 0), deployable: false }));
