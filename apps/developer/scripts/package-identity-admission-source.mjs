import { readFile, lstat, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const developer = dirname(dirname(fileURLToPath(import.meta.url)));
const owned = join(developer, 'vendor/identity-admission');
// Source custody only. This public pin grants no root, role, session or service.
export const SUPPLIER_MANIFEST_SHA256 = '5afb7749381449a406be8fadf25f91ad4be8d54102334c68b5796c1c86070d0a';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const entry = 'scripts/ynx-ide-service-admission-supplier.mjs';
const nullSelection = 'scripts/original-ide-service-admission-native-selection.mjs';
const bare = ['@noble/curves/nist.js', '@noble/curves/secp256k1.js', '@noble/hashes/sha2.js', '@noble/hashes/sha3.js', '@noble/hashes/utils.js'];

export async function verifyIdentityAdmissionSource(root = owned) {
  for (const path of [root, join(root, 'scripts'), join(root, 'src')]) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Regular admission source directories required.');
  }
  for (const name of ['SUPPLIER_MANIFEST.json', 'receipt.json']) {
    const stat = await lstat(join(root, name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Regular admission source metadata required.');
  }
  const top = (await readdir(root)).sort();
  if (top.join('\n') !== ['SUPPLIER_MANIFEST.json', 'receipt.json', 'scripts', 'src'].join('\n')) throw Error('Unexpected admission source metadata.');
  const raw = await readFile(join(root, 'SUPPLIER_MANIFEST.json'));
  if (sha256(raw) !== SUPPLIER_MANIFEST_SHA256) throw Error('Admission source manifest differs from reviewed supplier.');
  const manifest = JSON.parse(raw), receipt = JSON.parse(await readFile(join(root, 'receipt.json')));
  if (receipt.schemaVersion !== 1 || receipt.sourceManifestSha256 !== SUPPLIER_MANIFEST_SHA256
    || receipt.sourceVersion !== manifest.version || receipt.sourceContentRoot !== manifest.contentRoot
    || receipt.sourceOnly !== true || receipt.runtimeTested !== false || receipt.selection !== 'not-configured'
    || !Array.isArray(receipt.files) || receipt.files.length !== 36) throw Error('Invalid admission source receipt.');
  const pins = new Map(manifest.files.map(pin => [pin.path, pin]));
  const paths = receipt.files.map(pin => pin.path);
  if (new Set(paths).size !== 36 || paths.some(path => !/^(scripts|src)\/[^/]+\.(mjs|js)$/.test(path))) throw Error('Invalid admission source paths.');
  for (const file of receipt.files) {
    const pin = pins.get('source/packages/wallet-auth/' + file.path);
    const stat = await lstat(join(root, file.path)), bytes = await readFile(join(root, file.path));
    if (!pin || !stat.isFile() || stat.isSymbolicLink() || file.bytes !== pin.bytes || file.sha256 !== pin.sha256
      || bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256
      || file.nullPath !== [entry, nullSelection].includes(file.path)) throw Error('Admission source leaf differs from reviewed supplier.');
  }
  const retained = (await Promise.all(['scripts', 'src'].map(async folder => (await readdir(join(root, folder))).map(name => folder + '/' + name)))).flat();
  if (retained.length !== 36 || retained.some(path => !paths.includes(path))) throw Error('Unexpected admission source leaf.');
  // Parse/bundle without executing any supplier, protected or crypto module.
  const graph = await build({ entryPoints: [join(root, entry)], absWorkingDir: root, bundle: true, write: false,
    platform: 'node', format: 'esm', packages: 'external', metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(graph.metafile.inputs);
  if (inputs.length !== 36 || inputs.some(path => !paths.includes(path))) throw Error('Admission source import closure differs.');
  return receipt;
}

export async function copyIdentityAdmissionSource(destination) {
  if (resolve(destination) !== destination || !destination.endsWith('/vendor/identity-admission')) throw Error('Exact packaged admission source path required.');
  const receipt = await verifyIdentityAdmissionSource();
  // Existing reviewed dependency bytes are packaged with Developer. Resolve
  // metadata only; do not import the crypto/runtime graph to qualify copying.
  const require = createRequire(join(owned, entry));
  for (const specifier of bare) {
    const path = require.resolve(specifier);
    if (!path.startsWith(join(developer, 'node_modules/@noble') + '/')) throw Error('Admission dependency escaped Developer.');
  }
  for (const name of ['curves', 'hashes']) {
    const metadata = JSON.parse(await readFile(join(developer, 'node_modules/@noble', name, 'package.json')));
    if (metadata.version !== '2.2.0' || metadata.license !== 'MIT') throw Error('Reviewed admission dependency version/license required.');
  }
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination); // Never replace an existing candidate.
  for (const file of [...receipt.files, { path: 'SUPPLIER_MANIFEST.json' }, { path: 'receipt.json' }]) {
    const target = join(destination, file.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(owned, file.path), target, 1);
  }
  await verifyIdentityAdmissionSource(destination);
  return { sourceLeaves: 36, manifestSha256: SUPPLIER_MANIFEST_SHA256, sharedModulesExecuted: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await copyIdentityAdmissionSource(process.argv[2])));
}
