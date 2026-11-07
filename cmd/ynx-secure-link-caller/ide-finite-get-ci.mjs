// Original LINK CI owner hook. Generated PUBLIC test keys stay in the private
// test directory; only the bounded result, command logs and native controls
// are copied into the existing job's evidence artifact.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmod, lstat, mkdir, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(source, '../..');
async function ownedRoot(variable) {
  const root = process.env[variable];
  assert.ok(root && path.isAbsolute(root) && path.resolve(root) === root, `${variable} must be an explicit normalized absolute path`);
  await mkdir(root, {recursive: true, mode: 0o700});
  const info = await lstat(root);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && !(info.mode & 0o022), `${variable} must be an owned, unshared directory`);
  assert.equal(await realpath(root), root, `${variable} must not traverse a symlink`);
  await chmod(root, 0o700);
  return root;
}
const privateRoot = await ownedRoot('YNX_LINK_IDE_FINITE_GET_TEST_ARTIFACTS');
const evidence = await ownedRoot('YNX_LINK_IDE_FINITE_GET_CI_EVIDENCE');
assert.ok(!evidence.startsWith(privateRoot + path.sep) && evidence !== privateRoot && !privateRoot.startsWith(evidence + path.sep), 'private keys and published evidence require disjoint roots');
assert.deepEqual(await readdir(privateRoot), [], 'one original attempt requires a fresh job-private directory');
const result = spawnSync(process.execPath, ['--test', path.join(source, 'ide-finite-get-transport.test.mjs')], {
  cwd: repository, env: process.env, encoding: 'utf8', timeout: 180000, maxBuffer: 4 << 20,
});
const files = [];
async function recordFile(name, bytes) {
  assert.ok(bytes.length <= (32 << 20), `bounded evidence required: ${name}`);
  await writeFile(path.join(evidence, name), bytes, {flag: 'wx', mode: 0o600});
  files.push({name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
}
await recordFile('finite7.tap', Buffer.from(result.stdout ?? ''));
await recordFile('finite7.stderr', Buffer.from(result.stderr ?? ''));
let abiResult;
const roots = [privateRoot];
if (!result.error && result.status === 0) {
  const dependencyRoot = path.join(source, 'ide-finite-get-auth-test-deps');
  const originals = JSON.parse(await readFile(path.join(dependencyRoot, 'ORIGINALS.json'), 'utf8'));
  assert.deepEqual(originals.sources.map(item => item.path).sort(), [
    'ide_finite_get_auth_mother.cpp', 'ide_finite_get_auth_mother_internal.hpp', 'ide_finite_get_auth_mother_v1.h',
  ]);
  const authSources = [];
  for (const original of originals.sources) {
    const file = path.join(dependencyRoot, original.path), bytes = await readFile(file);
    assert.equal(bytes.length, original.bytes, 'original Auth physical dependency length');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), original.sha256, 'original Auth physical dependency digest');
    authSources.push({path: file, bytes: original.bytes, sha256: original.sha256});
  }
  const inputs = Buffer.from(JSON.stringify({version: 1, authSources}, null, 2) + '\n');
  await recordFile('ABI-INPUTS.json', inputs);
  const abiRoot = privateRoot + '-abi';
  process.env.YNX_LINK_IDE_FINITE_GET_ABI_TEST_ARTIFACTS = abiRoot;
  roots.push(await ownedRoot('YNX_LINK_IDE_FINITE_GET_ABI_TEST_ARTIFACTS'));
  assert.deepEqual(await readdir(abiRoot), [], 'one original ABI attempt requires a fresh private directory');
  abiResult = spawnSync(process.execPath, ['--test', path.join(source, 'ide-finite-get-abi.test.mjs')], {
    cwd: repository, env: {...process.env, YNX_LINK_IDE_FINITE_GET_ABI_INPUTS: path.join(evidence, 'ABI-INPUTS.json'),
      YNX_LINK_IDE_FINITE_GET_ABI_INPUTS_BYTES: String(inputs.length),
      YNX_LINK_IDE_FINITE_GET_ABI_INPUTS_SHA256: createHash('sha256').update(inputs).digest('hex')},
    encoding: 'utf8', timeout: 180000, maxBuffer: 4 << 20,
  });
  await recordFile('finite7-abi.tap', Buffer.from(abiResult.stdout ?? ''));
  await recordFile('finite7-abi.stderr', Buffer.from(abiResult.stderr ?? ''));
}
for (const root of roots) for (const entry of await readdir(root, {withFileTypes: true})) {
  assert.ok(entry.isDirectory() && /^(fg|abi)-[A-Za-z0-9]+$/.test(entry.name), 'unexpected private control directory');
  const directory = path.join(root, entry.name);
  for (const leaf of await readdir(directory)) {
    if (!/^([A-Za-z0-9][A-Za-z0-9_.-]{0,150}\.(json|stdout|stderr|o|cpp)|finite7-native-controls|finite7-wire-controls|finite7-abi-controls)$/.test(leaf)) continue;
    const file = path.join(directory, leaf), info = await lstat(file);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() && info.size <= (32 << 20), 'only bounded owned regular control outputs may be published');
    await recordFile(entry.name + '-' + leaf, await readFile(file));
  }
}
const manifest = {
  schema: 'YNX-LINK-FINITE7-ORIGINAL-CI-PUBLIC-CONTROLS/v1',
  status: result.status === 0 && abiResult ? abiResult.status : result.status,
  signal: result.signal || abiResult?.signal || null,
  transportStatus: result.status,
  processError: result.error ? {code: result.error.code, message: result.error.message} : null,
  command: [process.execPath, '--test', path.join(source, 'ide-finite-get-transport.test.mjs')],
  abi: abiResult ? {status: abiResult.status, signal: abiResult.signal,
    processError: abiResult.error ? {code: abiResult.error.code, message: abiResult.error.message} : null,
    command: [process.execPath, '--test', path.join(source, 'ide-finite-get-abi.test.mjs')]} : null,
  files, privateKeysPublished: false, actualAuthFence: false, RootAdmission: false,
  SourceAdmission: false, installed: false,
};
await writeFile(path.join(evidence, 'CI-RESULT.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
assert.equal(result.error, undefined, 'original finite7 process error retained in CI-RESULT.json');
assert.equal(result.status, 0, 'original finite7 failure retained with command logs and PUBLIC result');
if (abiResult) {
  process.stdout.write(abiResult.stdout ?? '');process.stderr.write(abiResult.stderr ?? '');
  assert.equal(abiResult.error, undefined, 'original finite7 ABI process error retained');
  assert.equal(abiResult.status, 0, 'original finite7 ABI failure retained with command logs');
}
