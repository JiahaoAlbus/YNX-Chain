import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, lstat, rename, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const runtime = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultSource = resolve(runtime, '../ynx-workbench/native/process-tree.c');
const defaultOutput = join(runtime, 'lib/backend/ynx-process-tree');
const compiler = '/Library/Developer/CommandLineTools/usr/bin/clang';
const sdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';
async function toolchainIdentity() {
  const version = spawnSync(compiler, ['--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  return { compiler: { path: compiler, sha256: hash(await readFile(compiler)), version: version.stdout.trim() }, sdk: { path: await realpath(sdk), settingsSha256: hash(await readFile(join(sdk, 'SDKSettings.json'))) } };
}
const hash = value => createHash('sha256').update(value).digest('hex');
async function regular(path) { const stat = await lstat(path); assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Native helper inputs must be regular files.'); }
export async function verifyProcessHelper({ source = defaultSource, output = defaultOutput } = {}) {
  await regular(source); await regular(output); await regular(`${output}.receipt.json`);
  const receipt = JSON.parse(await readFile(`${output}.receipt.json`, 'utf8'));
  assert.equal(receipt.sourceSha256, hash(await readFile(source)), 'Native process helper source is stale. Rebuild before packaging.');
  assert.equal(receipt.sha256, hash(await readFile(output)), 'Native process helper binary differs from its receipt.');
  assert.equal(receipt.platform, process.platform); assert.equal(receipt.arch, process.arch);
  assert.equal(receipt.minimumOS, '13.5');
  const identity = await toolchainIdentity();
  assert.deepEqual(receipt.compiler, identity.compiler, 'Native helper compiler provenance differs.');
  assert.deepEqual(receipt.sdk, identity.sdk, 'Native helper SDK provenance differs.');
  return receipt;
}
export async function buildProcessHelper({ source = defaultSource, output = defaultOutput } = {}) {
  assert.equal(process.platform, 'darwin'); await regular(source);
  const identity = await toolchainIdentity();
  const sourceHash = hash(await readFile(source)), temporary = `${output}.${process.pid}.building`;
  await mkdir(dirname(output), { recursive: true });
  try {
    const result = spawnSync(compiler, ['-std=c17', '-Wall', '-Wextra', '-Werror', '-isysroot', sdk, '-mmacosx-version-min=13.5', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', source, '-o', temporary], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const target = spawnSync('/usr/bin/otool', ['-l', temporary], { encoding: 'utf8' });
    assert.equal(target.status, 0, target.stderr); assert.equal(target.stdout.match(/\bminos ([\d.]+)/)?.[1], '13.5');
    assert.equal(hash(await readFile(source)), sourceHash, 'Native helper source changed while compiling.');
    const receipt = { ...identity, source, sourceSha256: sourceHash, platform: process.platform, arch: process.arch, minimumOS: '13.5', sha256: hash(await readFile(temporary)), elevatedPrivileges: false };
    await rename(temporary, output);
    await writeFile(`${output}.receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
    return await verifyProcessHelper({ source, output });
  } finally { await rm(temporary, { force: true }); }
}
