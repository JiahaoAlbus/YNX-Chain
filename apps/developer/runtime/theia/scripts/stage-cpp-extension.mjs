import { readFile, readdir, lstat, realpath, mkdir, cp, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composedTreeDigest } from '../../../services/codeoss-service/src/composed-runtime.mjs';
const developer = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const [destination, clientInput, syntaxInput, noticesInput] = process.argv.slice(2);
if (!destination?.startsWith(join(developer, '.ynx-developer-candidates') + '/') || resolve(destination) !== destination)
  throw Error('Use a new canonical owned candidate destination.');
const clients = await realpath(clientInput), syntax = await realpath(syntaxInput);
const versions = { 'vscode-languageclient': '9.0.1', minimatch: '5.1.7', semver: '7.5.4',
  'vscode-languageserver-protocol': '3.17.5', 'vscode-jsonrpc': '8.2.0', 'vscode-languageserver-types': '3.17.5',
  'brace-expansion': '2.0.2', 'balanced-match': '1.0.2', 'lru-cache': '6.0.0', yallist: '4.0.0' };
async function regularTree(root) {
  for (const name of await readdir(root)) {
    const stat = await lstat(join(root, name));
    if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw Error('Unsupported component entry.');
    if (stat.isDirectory()) await regularTree(join(root, name));
  }
}
const components = [];
for (const [name, version] of Object.entries(versions)) {
  const source = join(clients, name), metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (metadata.name !== name || metadata.version !== version || !['MIT', 'ISC'].includes(metadata.license)) throw Error('Unexpected cached component.');
  for (const dependency of Object.keys(metadata.dependencies || {})) if (!versions[dependency]) throw Error('Unreviewed transitive dependency.');
  const notices = (await readdir(source)).filter(name => /^(licen[sc]e|notice|copying)(\.|$)/i.test(name));
  if (!notices.length) throw Error('Component has no license notice.');
  await regularTree(source);
  components.push({ name, version, license: metadata.license, notices, sourceTreeSha256: await composedTreeDigest(source) });
}
const syntaxMetadata = JSON.parse(await readFile(join(syntax, 'package.json'), 'utf8'));
if (syntaxMetadata.name !== 'cpp' || syntaxMetadata.version !== '10.0.0' || syntaxMetadata.license !== 'MIT') throw Error('Unexpected local C/C++ syntax component.');
const legal = await readFile(noticesInput, 'utf8');
if (!legal.includes('jeff-hykin/better-cpp-syntax 1.27.1 - MIT') || !legal.includes('jeff-hykin/better-c-syntax') || !legal.includes('Copyright (c) 2019 Jeff Hykin')) throw Error('Missing upstream syntax notices.');
await regularTree(syntax);
const syntaxTreeSha256 = await composedTreeDigest(syntax);
await mkdir(destination, { mode: 0o700 });
const extension = join(destination, 'ynx.ynx-cpp');
await cp(join(developer, 'native/ynx-cpp'), extension, { recursive: true, errorOnExist: true, force: false });
await mkdir(join(extension, 'node_modules'), { mode: 0o700 });
for (const component of components) {
  const target = join(extension, 'node_modules', component.name);
  await cp(join(clients, component.name), target, { recursive: true, errorOnExist: true, force: false });
  if (await composedTreeDigest(target) !== component.sourceTreeSha256) throw Error('Cached dependency changed during staging.');
}
for (const name of ['syntaxes', 'language-configuration.json']) await cp(join(syntax, name), join(extension, name), { recursive: true, errorOnExist: true, force: false });
await cp(join(syntax, 'package.json'), join(extension, 'upstream-cpp-package.json'), { errorOnExist: true, force: false });
await writeFile(join(extension, 'ThirdPartyNotices.txt'), legal, { flag: 'wx' });
await cp(join(clients, 'vscode-languageclient/License.txt'), join(extension, 'MICROSOFT-MIT-NOTICE.txt'), { errorOnExist: true, force: false });
await writeFile(join(extension, 'NOTICE.txt'), 'YNX C/C++ uses local cached MIT/ISC language-client dependencies and MIT-declared VS Code C/C++ syntax. All original component notices and full installed syntax third-party notices are retained. No proprietary C/C++ extension or compiler binary is included.\n', { flag: 'wx' });
if (await composedTreeDigest(syntax) !== syntaxTreeSha256) throw Error('Cached syntax changed during staging.');
const receipt = { schema: 'ynx-cpp-offline-input/v1', version: '0.1.0', components,
  syntax: { version: syntaxMetadata.version, license: syntaxMetadata.license, sourceTreeSha256: syntaxTreeSha256 },
  extensionTreeSha256: await composedTreeDigest(extension),
  source: 'Existing local dependency and syntax bytes only; no package/network download or package lifecycle execution.',
  server: 'Operator provides an existing approved Clangd executable inside the admitted project execution domain; no automatic download.' };
await writeFile(join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt));
