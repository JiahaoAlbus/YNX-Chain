import { readFile, writeFile, mkdir, readdir, cp, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composedTreeDigest, verifyComposedRuntime } from '../../../services/codeoss-service/src/composed-runtime.mjs';
import { bundleSolidityLanguageRuntime } from '../../../scripts/bundle-solidity-language-runtime.mjs';
import { bundleSolidityFormatRuntime } from '../../../scripts/bundle-solidity-format-runtime.mjs';
import { packageLanguagePack } from '../../../scripts/package-language-pack.mjs';
import { reviewedMacNodeVersion } from '../../../scripts/bundle-local-node-runtime.mjs';
import { inspectBinary, compareVersions } from '../../../scripts/verify-macos-compatibility.mjs';
import { claimBuildOutput, verifyBuildOutputIdentity } from '../../../scripts/build-output-root.mjs';
const application = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const developer = resolve(application, '../..');
const destination = process.argv[2], pluginsInput = process.argv[3];
const cppInput = process.argv[4];
// A valid old payload receipt does not prove that this build contains the
// current owned C/C++ fixes. Bind every owned source file to its staged bytes.
async function verifyCppOwnedSource(extension, receipt) {
  const source = join(developer, 'native/ynx-cpp');
  const before = await composedTreeDigest(source);
  if (receipt.ownedSourceTreeSha256 !== before) throw Error('C/C++ input is stale. Stage the current owned source before packaging.');
  async function compare(folder, staged) {
    for (const name of await readdir(folder)) {
      const input = join(folder, name), output = join(staged, name);
      const [a, b] = await Promise.all([lstat(input), lstat(output)]);
      if (a.isSymbolicLink() || b.isSymbolicLink()) throw Error('C/C++ owned source must be regular.');
      if (a.isDirectory() && b.isDirectory()) await compare(input, output);
      else if (a.isFile() && b.isFile()) {
        const [x, y] = await Promise.all([readFile(input), readFile(output)]);
        if (!x.equals(y)) throw Error('Staged C/C++ source differs from this build.');
      } else throw Error('Staged C/C++ source type differs from this build.');
    }
  }
  await compare(source, extension);
  if (await composedTreeDigest(source) !== before) throw Error('C/C++ source changed during packaging.');
}
const candidateRoot = join(developer, '.ynx-developer-candidates') + '/';
if (cppInput) {
  const cpp = await realpath(cppInput);
  if (!cpp.startsWith(candidateRoot) || cpp !== cppInput) throw Error('C/C++ input must be an exact owned candidate.');
  const receipt = JSON.parse(await readFile(join(cpp, 'receipt.json'), 'utf8'));
  await verifyCppOwnedSource(join(cpp, 'ynx.ynx-cpp'), receipt);
}
if (process.platform === 'darwin' && !reviewedMacNodeVersion(process.version)) throw Error('Use an exact reviewed macOS Node version for runtime provenance.');
if (!destination || resolve(destination) !== destination || !pluginsInput?.startsWith(candidateRoot))
  throw Error('Use new owned absolute candidate paths.');
const plugins = await realpath(pluginsInput);
if (!plugins.startsWith(candidateRoot)) throw Error('Plugin input escaped its owned candidate root.');
const buildReceipt = JSON.parse(await readFile(join(application, '.ynx-owned-build.json'), 'utf8'));
if (buildReceipt.workbenchTreeSha256 !== await composedTreeDigest(join(developer, 'runtime/ynx-workbench'))
  || buildReceipt.workbenchTreeSha256 !== await composedTreeDigest(join(application, 'node_modules/@ynx/developer-workbench'))
  || buildReceipt.compiledTreeSha256 !== await composedTreeDigest(join(application, 'lib'))
  || buildReceipt.packageSha256 !== createHash('sha256').update(await readFile(join(application, 'package.json'))).digest('hex')
  || buildReceipt.lockSha256 !== createHash('sha256').update(await readFile(join(application, 'package-lock.json'))).digest('hex')) {
  throw Error('Owned source/cache/build receipt differs. Run the owned offline build before packaging.');
}
if (process.platform === 'darwin') {
  const { verifyProcessHelper } = await import('./process-helper-build.mjs');
  await verifyProcessHelper();
}
const outputIdentity = await claimBuildOutput(destination); // never replace an existing candidate
async function assertRegularTree(root) {
  for (const name of await readdir(root)) {
    const path = join(root, name), stat = await lstat(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw Error(`Unsupported input: ${path}`);
    if (stat.isDirectory()) await assertRegularTree(path);
  }
}
await assertRegularTree(join(application, 'lib'));
await cp(join(application, 'lib'), join(destination, 'lib'), { recursive: true, errorOnExist: true, force: false });
if (process.platform === 'darwin') {
  const { verifyProcessHelper } = await import('./process-helper-build.mjs');
  await verifyProcessHelper({ output: join(destination, 'lib/backend/ynx-process-tree') });
}
for (const name of ['package.json', 'package-lock.json']) await cp(join(application, name), join(destination, name), { errorOnExist: true, force: false });
const helper = await readFile(join(developer, 'runtime/ynx-workbench/assets/workbench-activity.js'), 'utf8');
for (const name of ['index.html', 'secondary-window.html']) {
  const path = join(destination, 'lib/frontend', name);
  let html = await readFile(path, 'utf8');
  if (html.includes('__YNX_WORKBENCH_WINDOW_CAPABILITY_V1__') || !/<head>/.test(html)) throw Error('Unexpected framework HTML bootstrap.');
  html = html.replace(/<html lang="en">/, '<html>').replace('<head>', `<head><script data-ynx-workbench-activity="v1">${helper}</script>`);
  await writeFile(path, html);
}
const inputs = JSON.parse(await readFile(join(plugins, 'extension-inputs.json'), 'utf8'));
await mkdir(join(destination, 'plugins'), { mode: 0o700 });
for (const input of inputs) {
  const name = `${input.namespace}.${input.name}-${input.version}`;
  const archive = await readFile(join(plugins, `${name}.vsix`));
  if (createHash('sha256').update(archive).digest('hex') !== input.sha256) throw Error('Extension input archive changed.');
  await assertRegularTree(join(plugins, name));
  if (input.payloadTreeSha256 && await composedTreeDigest(join(plugins, name)) !== input.payloadTreeSha256) throw Error('Pinned extension payload changed.');
  await cp(join(plugins, name), join(destination, 'plugins', name), { recursive: true, errorOnExist: true, force: false });
}
const tools = join(developer, 'native/ynx-tools');
await assertRegularTree(tools);
await cp(tools, join(destination, 'plugins/ynx.ynx-tools'), { recursive: true, errorOnExist: true, force: false });
if (process.env.YNX_IDE_SOLC_INPUT) await bundleSolidityLanguageRuntime(process.env.YNX_IDE_SOLC_INPUT, join(destination, 'plugins/ynx.ynx-tools'));
if (process.env.YNX_IDE_SOLIDITY_FORMAT_INPUT === 'retained') await bundleSolidityFormatRuntime(join(destination, 'plugins/ynx.ynx-tools'));
const brand = join(developer, 'native/ynx-brand');
await assertRegularTree(brand);
await cp(brand, join(destination, 'plugins/ynx.ynx-developer-brand'), { recursive: true, errorOnExist: true, force: false });
const go = join(developer, 'native/ynx-go');
await assertRegularTree(go);
const goMetadata = JSON.parse(await readFile(join(go, 'package.json'), 'utf8'));
if (goMetadata.publisher !== 'ynx' || goMetadata.name !== 'ynx-go') throw Error('Unexpected owned Go extension identity.');
await cp(go, join(destination, 'plugins/ynx.ynx-go'), { recursive: true, errorOnExist: true, force: false });
let languagePackReceipt;
if (process.env.YNX_IDE_ZH_LANGUAGE_PACK_INPUT) {
  languagePackReceipt = await packageLanguagePack(process.env.YNX_IDE_ZH_LANGUAGE_PACK_INPUT,
    join(destination, 'plugins/ms-ceintl.vscode-language-pack-zh-hans'));
}
let cppReceipt;
if (cppInput) {
  const cpp = await realpath(cppInput);
  if (!cpp.startsWith(candidateRoot) || cpp !== cppInput) throw Error('C/C++ input must be an exact owned candidate.');
  cppReceipt = JSON.parse(await readFile(join(cpp, 'receipt.json'), 'utf8'));
  const extension = join(cpp, 'ynx.ynx-cpp');
  await assertRegularTree(extension);
  if (cppReceipt.schema !== 'ynx-cpp-offline-input/v1' || await composedTreeDigest(extension) !== cppReceipt.extensionTreeSha256) throw Error('C/C++ extension input changed.');
  await verifyCppOwnedSource(extension, cppReceipt);
  await cp(extension, join(destination, 'plugins/ynx.ynx-cpp'), { recursive: true, errorOnExist: true, force: false });
  await verifyCppOwnedSource(join(destination, 'plugins/ynx.ynx-cpp'), cppReceipt);
}
await writeFile(join(destination, 'plugins/extension-inputs.json'), JSON.stringify(inputs, null, 2));
// Keep component license declarations and available upstream legal notices.
// Missing notice files are recorded for release review, never silently waived.
const lock = JSON.parse(await readFile(join(application, 'package-lock.json'), 'utf8'));
const notices = [];
notices.push({ name: 'ynx.ynx-go', version: goMetadata.version, license: goMetadata.license,
  files: (await readdir(go)).filter(name => /^(licen[sc]e|notice|copying)(\.|$)/i.test(name)).map(name => `../plugins/ynx.ynx-go/${name}`) });
if (languagePackReceipt) notices.push({ name: languagePackReceipt.extensionId, version: languagePackReceipt.version,
  license: 'MIT', files: ['../plugins/ms-ceintl.vscode-language-pack-zh-hans/LICENSE.md'] });
await mkdir(join(destination, 'component-notices'), { mode: 0o700 });
for (const input of inputs) {
  const name = `${input.namespace}.${input.name}-${input.version}`, source = join(destination, 'plugins', name);
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  notices.push({ name: `${metadata.publisher}.${metadata.name}`, version: metadata.version, license: metadata.license,
    files: (await readdir(source)).filter(n => /^(licen[sc]e|notice|copying)(\.|$)/i.test(n)).map(n => `../plugins/${name}/${n}`) });
}
let index = 0;
for (const path of Object.keys(lock.packages).filter(path => path.startsWith('node_modules/'))) {
  const source = join(application, path);
  let metadata;
  try { metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    notices.push({ packagePath: path, ...lock.packages[path], installed: false });
    continue;
  }
  const names = (await readdir(source)).filter(name => /^(licen[sc]e|notice|copying)(\.|$)/i.test(name));
  const entry = { name: metadata.name, version: metadata.version, license: metadata.license, files: [] };
  for (const name of names) {
    const stat = await lstat(join(source, name));
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const target = `${index++}-${name}`;
    await cp(join(source, name), join(destination, 'component-notices', target), { errorOnExist: true, force: false });
    entry.files.push(target);
  }
  notices.push(entry);
}
await cp(join(developer, 'runtime/ynx-workbench/NOTICE'), join(destination, 'component-notices/YNX-VIEW-CONTAINER-NOTICE.txt'), { errorOnExist: true, force: false });
notices.push({ name: '@ynx/developer-workbench/view-container', license: 'EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0', files: ['YNX-VIEW-CONTAINER-NOTICE.txt'] });
if (cppReceipt) notices.push({ name: 'ynx.ynx-cpp', version: cppReceipt.version, license: 'MIT', components: cppReceipt.components,
  files: ['../plugins/ynx.ynx-cpp/NOTICE.txt', '../plugins/ynx.ynx-cpp/MICROSOFT-MIT-NOTICE.txt', '../plugins/ynx.ynx-cpp/ThirdPartyNotices.txt'] });
await writeFile(join(destination, 'component-notices/index.json'), JSON.stringify(notices, null, 2));
let macosCompatibility;
if (process.platform === 'darwin') {
  const binaries = [];
  async function inspectTree(folder) {
    for (const name of await readdir(folder)) {
      const path = join(folder, name), stat = await lstat(path);
      if (stat.isDirectory()) await inspectTree(path);
      else if (stat.isFile()) {
        const slices = inspectBinary(path);
        if (!slices) continue;
        for (const slice of slices) {
          if (!slice.minimumOS || !['1','macos'].includes(slice.platform)) throw Error('Core Mach-O is missing its macOS target.');
          compareVersions(slice.minimumOS, slice.minimumOS);
        }
        binaries.push({ path: path.slice(destination.length + 1), slices,
          sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
      }
    }
  }
  await inspectTree(destination);
  if (!binaries.length) throw Error('Core macOS native closure is missing.');
  const foreignArchitectureBinaries = binaries.filter(item => !item.slices.some(slice => slice.architecture === (process.arch === 'arm64' ? 'arm64' : 'x86_64'))).map(item => item.path);
  macosCompatibility = { architecture: process.arch, minimumOS: binaries.flatMap(item => item.slices.map(slice => slice.minimumOS)).sort(compareVersions).at(-1),
    nativeArchitectureComplete: foreignArchitectureBinaries.length === 0, foreignArchitectureBinaries, binaries };
}
const manifest = { kind: 'ynx-theia', version: '1.76.0', architecture: `${process.platform}-${process.arch}`,
  ...macosCompatibility ? { macosCompatibility } : {},
  nodeVersion: process.version, nodeOptions: ['--no-experimental-global-navigator', '--max-old-space-size=1024'],
  entry: 'lib/backend/main.js', frontend: 'lib/frontend/index.html',
  lockSha256: createHash('sha256').update(await readFile(join(destination, 'package-lock.json'))).digest('hex'),
  activitySourceSha256: createHash('sha256').update(helper).digest('hex'),
  ynxToolsVersion: JSON.parse(await readFile(join(tools, 'package.json'), 'utf8')).version,
  ynxBrandVersion: JSON.parse(await readFile(join(brand, 'package.json'), 'utf8')).version,
  ynxGoVersion: goMetadata.version,
  ...languagePackReceipt ? { languagePack: { extensionId: languagePackReceipt.extensionId, version: languagePackReceipt.version,
    languageId: languagePackReceipt.languageId, sourceSha256: languagePackReceipt.sourceSha256 } } : {},
  ...cppReceipt ? { ynxCppInput: cppReceipt } : {},
  acceptance: 'owned composed runtime candidate; formal Host, isolation and release admission remain separate',
  treeSha256: await composedTreeDigest(destination) };
const bytes = JSON.stringify(manifest, null, 2) + '\n';
await writeFile(join(destination, 'YNX-COMPOSED-RUNTIME.json'), bytes, { flag: 'wx' });
const pin = { kind: manifest.kind, version: manifest.version, architecture: manifest.architecture,
  lockSha256: manifest.lockSha256, treeSha256: manifest.treeSha256, manifestSha256: createHash('sha256').update(bytes).digest('hex') };
await verifyBuildOutputIdentity(outputIdentity);
await writeFile(`${destination}.pin.json`, JSON.stringify(pin, null, 2) + '\n', { flag: 'wx' });
await verifyComposedRuntime(destination, pin);
await verifyBuildOutputIdentity(outputIdentity);
console.log(JSON.stringify({ destination, pin, noticeDeclarations: notices.length }));
