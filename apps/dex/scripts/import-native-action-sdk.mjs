// Generated vendor assets only; the implementation remains Wallet-owner source.
import { readFileSync, lstatSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
if (!source || process.argv.length !== 3) throw Error('Usage: node import-native-action-sdk.mjs <frozen-artifact-directory>');
const destination = fileURLToPath(new URL('../src/vendor/', import.meta.url));
const entries = [
  ['application-actions-browser.mjs', 'application-actions-browser.mjs', 110477, '627d7c57e15bfc3a92c77fb58d11c2bdb0e54f8f20c5989d51091163b71f5d0f'],
  ['application-actions-browser.mjs.manifest.json', 'native-action-manifest.json', 4760, 'c3104b9ce935ba734fa706a60568c6154423e03ccbe0ac79a13ef170bdb1c5d1'],
  ['product-session-registry.json', 'native-action-registry.json', 7546, '85c6995eddfbc175efaac01dbad31a4f5ef8878aab91613da2d689ef79921ab3'],
];
const prepared = entries.map(([input, output, bytes, sha]) => {
  const path = resolve(source, input), target = resolve(destination, output);
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw Error('SDK input must be a regular file');
  const body = readFileSync(path);
  if (body.length !== bytes || createHash('sha256').update(body).digest('hex') !== sha) throw Error('SDK input identity mismatch');
  if (existsSync(target)) throw Error('SDK output already exists; do not overwrite');
  return { target, body };
});
const manifest = JSON.parse(prepared[1].body);
if (manifest.sourceCommit !== 'ff5b7d49dd515d31d567c352dd049ac7b79d4139' || manifest.sourceTree !== '92bc40205167e80edcf10a31ff83db0fab592d08' || manifest.imports.length || manifest.inputs.length !== 23) throw Error('SDK source closure mismatch');
for (const { target, body } of prepared) writeFileSync(target, body, { flag: 'wx' });
console.log('Three fixed Wallet action SDK artifacts imported byte-exact; no account key or network used.');
