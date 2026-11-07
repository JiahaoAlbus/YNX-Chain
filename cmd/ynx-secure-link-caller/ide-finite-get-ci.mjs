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
let finishResult;
let aiResult;
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
  if (!abiResult.error && abiResult.status === 0) {
    const finishRoot = privateRoot + '-finish';
    process.env.YNX_LINK_IDE_FINITE_GET_FINISH_TEST_ARTIFACTS = finishRoot;
    roots.push(await ownedRoot('YNX_LINK_IDE_FINITE_GET_FINISH_TEST_ARTIFACTS'));
    assert.deepEqual(await readdir(finishRoot), [], 'one original finish attempt requires a fresh private directory');
    const finishEnv = {...process.env, YNX_LINK_IDE_FINITE_GET_ABI_INPUTS: path.join(evidence, 'ABI-INPUTS.json'),
      YNX_LINK_IDE_FINITE_GET_ABI_INPUTS_BYTES: String(inputs.length),
      YNX_LINK_IDE_FINITE_GET_ABI_INPUTS_SHA256: createHash('sha256').update(inputs).digest('hex')};
    delete finishEnv.YNX_LINK_IDE_FINITE_GET_FINISH_CONTROL;
    finishResult = spawnSync(process.execPath, ['--test', path.join(source, 'ide-finite-get-finish.test.mjs')], {
      cwd: repository, env: finishEnv,
      encoding: 'utf8', timeout: 180000, maxBuffer: 4 << 20,
    });
    await recordFile('finite7-finish.tap', Buffer.from(finishResult.stdout ?? ''));
    await recordFile('finite7-finish.stderr', Buffer.from(finishResult.stderr ?? ''));
  }
  if (finishResult && !finishResult.error && finishResult.status === 0) {
    const aiRoot = privateRoot + '-ai';
    process.env.YNX_LINK_AI_MOBILE_V6_TEST_ARTIFACTS = aiRoot;
    roots.push(await ownedRoot('YNX_LINK_AI_MOBILE_V6_TEST_ARTIFACTS'));
    assert.deepEqual(await readdir(aiRoot), [], 'one original AI attempt requires a fresh private directory');
    const aiEnv = {...process.env};
    delete aiEnv.YNX_LINK_AI_MOBILE_V6_PURE_RECEIPT;
    delete aiEnv.YNX_LINK_AI_MOBILE_V6_PURE_RECEIPT_BYTES;
    delete aiEnv.YNX_LINK_AI_MOBILE_V6_PURE_RECEIPT_SHA256;
    aiResult = spawnSync(process.execPath, ['--test', path.join(source, 'ai-mobile-v6-transport.test.mjs')], {
      cwd: repository, env: aiEnv, encoding: 'utf8', timeout: 180000, maxBuffer: 4 << 20,
    });
    await recordFile('ai-mobile-v6.tap', Buffer.from(aiResult.stdout ?? ''));
    await recordFile('ai-mobile-v6.stderr', Buffer.from(aiResult.stderr ?? ''));
  }
}
for (const root of roots) for (const entry of await readdir(root, {withFileTypes: true})) {
  assert.ok(entry.isDirectory() && /^(fg|abi|ai|finish)-[A-Za-z0-9]+$/.test(entry.name), 'unexpected private control directory');
  const directory = path.join(root, entry.name);
  for (const leaf of await readdir(directory)) {
    if (!/^([A-Za-z0-9][A-Za-z0-9_.-]{0,150}\.(json|stdout|stderr|o|cpp)|finite7-native-controls|finite7-wire-controls|finite7-abi-controls|finite7-finish-controls|ai-mobile-v6-native-controls|ai-mobile-v6-wire-controls)$/.test(leaf)) continue;
    const file = path.join(directory, leaf), info = await lstat(file);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() && info.size <= (32 << 20), 'only bounded owned regular control outputs may be published');
    await recordFile(entry.name + '-' + leaf, await readFile(file));
  }
}
const manifest = {
  schema: 'YNX-LINK-FINITE7-ORIGINAL-CI-PUBLIC-CONTROLS/v1',
  status: result.status !== 0 ? result.status : abiResult && abiResult.status !== 0 ? abiResult.status : finishResult && finishResult.status !== 0 ? finishResult.status : aiResult ? aiResult.status : 0,
  signal: result.signal || abiResult?.signal || finishResult?.signal || aiResult?.signal || null,
  transportStatus: result.status,
  processError: result.error ? {code: result.error.code, message: result.error.message} : null,
  command: [process.execPath, '--test', path.join(source, 'ide-finite-get-transport.test.mjs')],
  abi: abiResult ? {status: abiResult.status, signal: abiResult.signal,
    processError: abiResult.error ? {code: abiResult.error.code, message: abiResult.error.message} : null,
    command: [process.execPath, '--test', path.join(source, 'ide-finite-get-abi.test.mjs')]} : null,
  finish: finishResult ? {status: finishResult.status, signal: finishResult.signal,
    processError: finishResult.error ? {code: finishResult.error.code, message: finishResult.error.message} : null,
    command: [process.execPath, '--test', path.join(source, 'ide-finite-get-finish.test.mjs')]} : null,
  ai: aiResult ? {status: aiResult.status, signal: aiResult.signal,
    processError: aiResult.error ? {code: aiResult.error.code, message: aiResult.error.message} : null,
    command: [process.execPath, '--test', path.join(source, 'ai-mobile-v6-transport.test.mjs')]} : null,
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
if (finishResult) {
  process.stdout.write(finishResult.stdout ?? '');process.stderr.write(finishResult.stderr ?? '');
  assert.equal(finishResult.error, undefined, 'original finite7 finish process error retained');
  assert.equal(finishResult.status, 0, 'original finite7 finish failure retained with command logs');
}
if (aiResult) {
  process.stdout.write(aiResult.stdout ?? '');process.stderr.write(aiResult.stderr ?? '');
  assert.equal(aiResult.error, undefined, 'original AI mobile V6 process error retained');
  assert.equal(aiResult.status, 0, 'original AI mobile V6 failure retained with command logs');
}
