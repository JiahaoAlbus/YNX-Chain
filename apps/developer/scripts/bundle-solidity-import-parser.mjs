import { cp, mkdir, readFile, writeFile, realpath, readdir, lstat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertBuildOutputDirectory } from './build-output-root.mjs';
const developer = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const IMPORT_PARSER_CLOSURE = '4a71ce3d18805d970782045516bea34a305545cf9d535a5bfc99106aa2440ccb';
const packages = [
  { name: '@nomicfoundation/slang', version: '1.0.0', license: 'MIT' },
  { name: '@bytecodealliance/preview2-shim', version: '0.17.2', license: '(Apache-2.0 WITH LLVM-exception)' },
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function tree(root, prefix = 'node_modules') {
  const files = {};
  async function visit(directory, key) {
    for (const name of (await readdir(directory)).sort()) {
      const file = join(directory, name), stat = await lstat(file), next = key + '/' + name;
      if (stat.isDirectory()) await visit(file, next);
      else if (stat.isFile()) files[next] = sha(await readFile(file));
      else throw Error('Import parser inputs must be regular files.');
    }
  }
  await visit(root, prefix);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
export async function bundleSolidityImportParser(compilerArg) {
  const compiler = await realpath(compilerArg);
  if (compiler !== compilerArg) throw Error('Use the canonical compiler output directory.');
  await assertBuildOutputDirectory(compiler);
  const parser = join(compiler, 'parser'); await mkdir(parser); await mkdir(join(parser, 'node_modules'));
  for (const expected of packages) {
    const source = await realpath(join(developer, 'node_modules', expected.name));
    if (!source.startsWith(join(developer, 'node_modules') + '/')) throw Error('Use retained owned import parser inputs.');
    const metadata = JSON.parse(await readFile(join(source, 'package.json')));
    if (metadata.name !== expected.name || metadata.version !== expected.version || metadata.license !== expected.license) throw Error('The retained import parser package changed.');
    const dependencies = metadata.dependencies || {};
    if (JSON.stringify(dependencies) !== JSON.stringify(expected.name === '@nomicfoundation/slang' ? { '@bytecodealliance/preview2-shim': '0.17.2' } : {})) throw Error('The import parser dependency closure changed.');
    const destination = join(parser, 'node_modules', expected.name); await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
  const files = await tree(join(parser, 'node_modules')), closureSha256 = sha(JSON.stringify(files));
  if (closureSha256 !== IMPORT_PARSER_CLOSURE) throw Error('The copied import parser differs from its pinned retained closure.');
  const record = { protocol: 'ynx-solidity-import-parser/v1', packages, files, closureSha256, copiedClosureVerified: true, scope: 'Local structural import recovery only; no configuration execution, download or canonical identity.' };
  await writeFile(join(parser, 'distribution.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  return record;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await bundleSolidityImportParser(process.argv[2])));
