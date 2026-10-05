import assert from 'node:assert/strict';
import { cp, readdir, lstat, realpath, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composedTreeDigest } from '../../../services/codeoss-service/src/composed-runtime.mjs';
const runtime = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(runtime, '../ynx-workbench');
const cached = join(runtime, 'node_modules/@ynx/developer-workbench');
for (const path of [source, cached]) assert.equal(await realpath(path), path, 'Use canonical owned source and generated cache.');
async function regular(path) {
  for (const name of await readdir(path)) {
    const child = join(path, name), stat = await lstat(child);
    assert.ok(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()), 'Only regular owned package files.');
    if (stat.isDirectory()) await regular(child);
  }
}
await regular(source); await regular(cached);
// npm caches file dependencies as copies. Refresh only this generated YNX
// package; never run an installer, lifecycle hook or external fetch.
const seal = process.argv[2] === '--seal-build';
const { buildNativeWalletConsumer } = await import('../../ynx-workbench/scripts/build-native-wallet-consumer.mjs');
await buildNativeWalletConsumer({ verify: seal });
assert.ok(!process.argv[2] || seal);
if (!seal) await cp(source, cached, { recursive: true, force: true });
const digest = await composedTreeDigest(source);
assert.equal(await composedTreeDigest(cached), digest, 'Stale extra cache files must be reviewed before building.');
console.log('Owned workbench source/cache SHA256 ' + digest);
if (seal) {
  await cp(join(source, 'lib/plugin-vscode-init-adapter.js'), join(runtime, 'lib/backend/ynx-plugin-vscode-init.js'));
  const hashFile = async name => createHash('sha256').update(await readFile(join(runtime, name))).digest('hex');
  await regular(join(runtime, 'lib'));
  await writeFile(join(runtime, '.ynx-owned-build.json'), JSON.stringify({
    workbenchTreeSha256: digest, compiledTreeSha256: await composedTreeDigest(join(runtime, 'lib')),
    packageSha256: await hashFile('package.json'), lockSha256: await hashFile('package-lock.json'),
  }, null, 2) + '\n', { mode: 0o600 });
}
