import { createRequire } from 'node:module';
import { readFile, readdir, lstat, mkdir, copyFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { compilerReadiness } from './compiler-pin.mjs';

// Compose existing reviewed bytes only. Never install packages or execute their
// lifecycle scripts; preserve the original compiler package and its notices.
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [inputArg, outputArg] = process.argv.slice(2);
const input = await realpath(inputArg);
if (!compilerReadiness(input).available) throw Error('Use the exact reviewed offline compiler package.');
const output = resolve(outputArg);
const candidates = join(app, '.ynx-developer-candidates');
if (!output.startsWith(candidates + '/') || output === candidates) throw Error('Use a new owned candidate directory.');
await mkdir(output); // exclusive: retain earlier inputs and failed compositions
const modules = join(output, 'node_modules'); await mkdir(modules);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const packages = [], files = {}, selected = new Map();
async function copyTree(source, target, prefix) {
  await mkdir(target, { recursive: true });
  for (const name of (await readdir(source)).sort()) {
    if (name === 'node_modules') continue; // explicitly resolve the closure below
    const from = join(source, name), to = join(target, name), key = `${prefix}/${name}`, stat = await lstat(from);
    if (stat.isDirectory()) await copyTree(from, to, key);
    else if (stat.isFile()) { await copyFile(from, to); files[key] = sha(await readFile(to)); }
    else throw Error('Reviewed compiler packages cannot contain links or special files.');
  }
}
async function include(source) {
  const meta = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(meta.name)) throw Error('Invalid package name.');
  if (selected.has(meta.name)) {
    if (selected.get(meta.name) !== source) throw Error('Conflicting transitive package inputs.');
    return;
  }
  selected.set(meta.name, source);
  await copyTree(source, join(modules, meta.name), `node_modules/${meta.name}`);
  packages.push({ name: meta.name, version: meta.version, license: meta.license, original: source, dependencies: meta.dependencies || {} });
  const require = createRequire(join(source, 'package.json'));
  for (const name of Object.keys(meta.dependencies || {}).sort()) {
    const packagePath = await realpath(require.resolve(`${name}/package.json`));
    const dependencyRoot = dirname(packagePath);
    if (!dependencyRoot.startsWith(join(app, 'node_modules') + '/')) throw Error('A transitive package is outside the existing owned dependency input.');
    await include(dependencyRoot);
  }
}
await include(input);
// The existing workspace deliberately overrides legacy solc tmp to 0.2.7.
// Record the measured resolution rather than claiming original lock semantics.
const receipt = { schemaVersion: 1, compiler: compilerReadiness(join(modules, 'solc')), packages,
  files, manifestSha256: sha(JSON.stringify(Object.fromEntries(Object.entries(files).sort()))),
  overrides: { tmp: '0.2.7 (existing owned package.json solc override)' },
  downloaded: false, lifecycleScriptsExecuted: false, activation: 'Trusted operator input only; no identity, workspace or deployment grant.' };
if (!receipt.compiler.available || packages.find(p => p.name === 'tmp')?.version !== '0.2.7') throw Error('Compiler closure differs from reviewed local inputs.');
await writeFile(join(output, 'distribution.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, packages: packages.length, files: Object.keys(files).length, manifestSha256: receipt.manifestSha256 }));
