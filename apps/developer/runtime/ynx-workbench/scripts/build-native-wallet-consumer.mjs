import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..'), developer = resolve(source, '../..');
const require = createRequire(join(developer, 'runtime/theia/package.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checkedPath = path => { if (typeof path !== 'string' || path.includes('\\') || path.includes('\0') || path !== relative(developer, resolve(developer, path)) || !['frontend/src/wallet/', 'vendor/wallet-auth/', 'vendor/wallet-auth-c5/', 'node_modules/@noble/curves/', 'node_modules/@noble/hashes/'].some(prefix => path.startsWith(prefix))) throw Error('Unexpected native Wallet build dependency: ' + path); return path; };
const noticeFile = join(source, 'NOTICE.native-wallet-consumer.txt');
const output = join(source, 'lib/native-wallet-sdk.generated.js'), pinFile = join(source, 'lib/native-wallet-sdk.generated.pin.json');
export async function buildNativeWalletConsumer({ verify = false } = {}) {
  if (verify) {
    const pin = JSON.parse(await readFile(pinFile));
    if (pin.schema !== 'ynx-native-wallet-consumer-build/v1' || pin.bundleFile !== 'lib/native-wallet-sdk.generated.js' || !Array.isArray(pin.inputs) || !pin.inputs.length || pin.inputs.length > 1000 || !Array.isArray(pin.licenseInputs) || pin.licenseInputs.length !== 4) throw Error('Invalid native Wallet consumer provenance pin.');
    for (const required of ['frontend/src/wallet/product-session-v2.ts', 'frontend/src/wallet/transport.ts', 'vendor/wallet-auth-c5/product-session-registry.json', 'vendor/wallet-auth-c5/SOURCE_CLOSURE.json']) if (!pin.inputs.some(input => input.path === required)) throw Error('Native Wallet source pin is incomplete.');
    if (hash(await readFile(noticeFile)) !== pin.noticeSha256) throw Error('Native Wallet full notices changed during build.');
    if (hash(await readFile(output)) !== pin.bundleSha256) throw Error('Native Wallet consumer bundle changed during build.');
    for (const input of [...pin.inputs, ...pin.licenseInputs]) if (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256) || hash(await readFile(join(developer, checkedPath(input.path)))) !== input.sha256) throw Error('Native Wallet consumer source changed during build: ' + input.path);
    return pin;
  }
  const esbuild = require('esbuild');
  const result = await esbuild.build({ stdin: { contents: 'export * from "./frontend/src/wallet/product-session-v2.ts"; export { subscribeDeveloperWalletCallbacks } from "./frontend/src/wallet/transport.ts";', resolveDir: developer, sourcefile: 'ynx-native-wallet-consumer-entry.ts', loader: 'ts' },
    absWorkingDir: developer, platform: 'browser', format: 'cjs', bundle: true, write: false, metafile: true, target: 'es2022', legalComments: 'inline', logLevel: 'silent' });
  const inputs = [];
  for (const name of Object.keys(result.metafile.inputs).sort()) {
    if (name === 'ynx-native-wallet-consumer-entry.ts') continue;
    const path = relative(developer, resolve(developer, name));
    checkedPath(path);
    inputs.push({ path, sha256: hash(await readFile(join(developer, path))) });
  }
  const closurePath = 'vendor/wallet-auth-c5/SOURCE_CLOSURE.json';
  inputs.push({ path: closurePath, sha256: hash(await readFile(join(developer, closurePath))) });
  const licenseInputs = [], noticeParts = ['YNX-owned accepted vendor Wallet SDK consumer. The SDK package declares UNLICENSED; Developer-owned consumption is authorized. This is not a public MIT grant for the SDK.'];
  for (const name of ['curves', 'hashes']) {
    const path = 'node_modules/@noble/' + name + '/LICENSE', metadataPath = 'node_modules/@noble/' + name + '/package.json';
    const metadataBytes = await readFile(join(developer, metadataPath)), metadata = JSON.parse(metadataBytes), bytes = await readFile(join(developer, path));
    inputs.push({ path: metadataPath, sha256: hash(metadataBytes) });
    licenseInputs.push({ path, sha256: hash(bytes), name: metadata.name, version: metadata.version, license: metadata.license });
    noticeParts.push(`${metadata.name} ${metadata.version} ${metadata.license} LICENSE SHA256 ${hash(bytes)}\n${bytes.toString('utf8')}`);
  }
  for (const sdkPath of ['vendor/wallet-auth/package.json', 'vendor/wallet-auth-c5/package.json']) {
  const sdkBytes = await readFile(join(developer, sdkPath)), sdk = JSON.parse(sdkBytes);
  if (sdk.license !== 'UNLICENSED') throw Error('Accepted SDK license declaration changed.');
  licenseInputs.push({ path: sdkPath, sha256: hash(sdkBytes), name: sdk.name, version: sdk.version, license: sdk.license });
  }
  const notices = noticeParts.join('\n\n') + '\n';
  await writeFile(noticeFile, notices);
  const bundle = result.outputFiles[0].contents;
  const pin = { schema: 'ynx-native-wallet-consumer-build/v1', source: 'Single original Developer TS factory and retained Wallet SDK; no origin, session or native transport substitution.', inputs, licenseInputs, noticeSha256: hash(Buffer.from(notices)), bundleFile: 'lib/native-wallet-sdk.generated.js', bundleSha256: hash(bundle) };
  await writeFile(output, bundle); await writeFile(pinFile, JSON.stringify(pin, null, 2) + '\n');
  return pin;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await buildNativeWalletConsumer({ verify: process.argv.includes('--verify') })));
