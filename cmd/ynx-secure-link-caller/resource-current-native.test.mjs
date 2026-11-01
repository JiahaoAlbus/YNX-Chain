// New PUBLIC real-kernel controls only. No Go/Root/Source/old caller suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, chmod, writeFile, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const source = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(source, '../..');
const expected = [
  'same-fd-original-wire-and-immutable-profile',
  'kernel-peer-profile-refusals-not-simulated-pid-reuse',
  'actual-http-frame-reflection-resource-and-independent-bounds',
  'chunked-positive-and-truncated-owned-prefix',
  'actual-write-zero-dispatch-and-late-complete-revocation',
  'replaced-endpoint-idle-disconnect-terminal-no-redial',
  'inflight-retire-packet-debt-then-exact-cleanup',
  'release-callback-physical-close-barrier-and-reentry',
  'inflight-packet-release-refuses-until-read-publishes',
  'concurrent-retire-close-owned-descriptor-isolation',
  'retain-failure-partial-and-fork-local-rejection',
  'actual-same-pid-exec-changed-image-with-live-socket',
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('resource_current actual native Unix peer identity, immutable carrier and custody module', {timeout: 45000}, async t => {
  assert.ok(['darwin', 'linux'].includes(process.platform), 'real Darwin/Linux kernel required; no skip or simulated peer');
  const destination = process.env.YNX_LINK_RESOURCE_CURRENT_TEST_ARTIFACTS;
  assert.ok(destination && path.isAbsolute(destination), 'YNX_LINK_RESOURCE_CURRENT_TEST_ARTIFACTS must name an explicit absolute owned evidence root');
  await mkdir(destination, {recursive: true, mode: 0o700});
  const owned = await mkdtemp(path.join(await realpath(destination), 'r-'));
  await chmod(owned, 0o700);
  assert.ok(Buffer.byteLength(path.join(owned, 'c99/s')) < 104, `owned evidence root exceeds Unix socket path limit: ${owned}; no fallback`);
  let number = 0;
  async function run(name, command, args, timeout = 20000) {
    const result = spawnSync(command, args, {cwd: repository, encoding: 'utf8', timeout, maxBuffer: 2 << 20});
    const prefix = path.join(owned, `${String(++number).padStart(2, '0')}-${name}`);
    await writeFile(prefix + '.stdout', result.stdout ?? '', {flag: 'wx'});
    await writeFile(prefix + '.stderr', result.stderr ?? '', {flag: 'wx'});
    await writeFile(prefix + '.json', JSON.stringify({command, args, status: result.status, signal: result.signal,
      error: result.error ? {code: result.error.code, message: result.error.message} : null}, null, 2) + '\n', {flag: 'wx'});
    assert.equal(result.error, undefined, `${name} process failure; evidence ${prefix}: ${result.error?.message}`);
    assert.equal(result.status, 0, `${name} first cause; evidence ${prefix}:\n${result.stderr}\n${result.stdout}`);
    return result;
  }
  const inputs = [];
  for (const leaf of ['resource_current_client_v1.h', 'private_client_v1.h', 'resource-current-peer.hpp',
    'resource-current-peer.cpp', 'resource-current-json.hpp', 'resource-current-json.test.cpp', 'resource-current-client.cpp',
    'resource-current-native.test.cpp', 'resource-current-native.test.mjs']) {
    const bytes = await readFile(path.join(source, leaf));inputs.push({leaf, bytes: bytes.length, sha256: sha(bytes)});
  }
  await writeFile(path.join(owned, 'SOURCE-BEFORE.json'), JSON.stringify(inputs, null, 2) + '\n', {flag: 'wx'});
  let flags = [];
  if (process.platform === 'linux') {
    const result = await run('openssl-flags', 'pkg-config', ['--cflags', '--libs', 'openssl']);
    flags = result.stdout.trim().split(/\s+/).filter(Boolean);
    assert.ok(flags.every(flag => /^[-A-Za-z0-9_./+=,:]+$/.test(flag)), 'unexpected pkg-config flag token');
  } else flags = ['-lbsm'];
  const binary = path.join(owned, 'native-test');
  await run('compile', 'clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic', '-pthread',
    path.join(source, 'resource-current-client.cpp'), path.join(source, 'resource-current-peer.cpp'),
    path.join(source, 'resource-current-native.test.cpp'), ...flags, '-o', binary]);
  const result = await run('kernel-controls', binary, [owned], 25000);
  const rows = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.filter(row => row.control).map(row => row.control), expected);
  assert.ok(rows.filter(row => row.control).every(row => row.passed === true));
  assert.deepEqual(rows.at(-1), {summary: true, controls: expected.length, transportOnly: true,
    actualGoServer: false, RootAdmission: false, SourceAdmission: false});
  for (const pin of inputs) assert.equal(sha(await readFile(path.join(source, pin.leaf))), pin.sha256, `source changed during native controls: ${pin.leaf}`);
  const image = await readFile(binary);
  await writeFile(path.join(owned, 'RESULT.json'), JSON.stringify({inputs, binary: {path: binary, bytes: image.length, sha256: sha(image)},
    controls: rows, actualKernel: process.platform, GoServerVerified: false, actualAuthFenceVerified: false,
    RootAdmission: false, SourceAdmission: false, deployed: false}, null, 2) + '\n', {flag: 'wx'});
  t.diagnostic('Exact owned compiler/kernel evidence retained: ' + owned);
});

test('resource_current pure JSON closed DATA controls enter the original native CI command', {timeout: 15000}, async t => {
  const destination = process.env.YNX_LINK_RESOURCE_CURRENT_TEST_ARTIFACTS;
  assert.ok(destination && path.isAbsolute(destination), 'YNX_LINK_RESOURCE_CURRENT_TEST_ARTIFACTS must name an explicit absolute owned evidence root');
  await mkdir(destination, {recursive: true, mode: 0o700});
  const owned = await mkdtemp(path.join(await realpath(destination), 'p-'));
  await chmod(owned, 0o700);
  const inputs = [];
  for (const leaf of ['resource-current-json.hpp', 'resource-current-json.test.cpp', 'resource-current-native.test.mjs']) {
    const bytes = await readFile(path.join(source, leaf));inputs.push({leaf, bytes: bytes.length, sha256: sha(bytes)});
  }
  await writeFile(path.join(owned, 'SOURCE-BEFORE.json'), JSON.stringify(inputs, null, 2) + '\n', {flag: 'wx'});
  let number = 0;
  async function run(name, command, args) {
    const result = spawnSync(command, args, {cwd: repository, encoding: 'utf8', timeout: 10000, maxBuffer: 2 << 20});
    const prefix = path.join(owned, `${++number}-${name}`);
    await writeFile(prefix + '.stdout', result.stdout ?? '', {flag: 'wx'});
    await writeFile(prefix + '.stderr', result.stderr ?? '', {flag: 'wx'});
    await writeFile(prefix + '.json', JSON.stringify({command, args, status: result.status, signal: result.signal,
      error: result.error ? {code: result.error.code, message: result.error.message} : null}, null, 2) + '\n', {flag: 'wx'});
    assert.equal(result.error, undefined, `${name} process failure; evidence ${prefix}: ${result.error?.message}`);
    assert.equal(result.status, 0, `${name} first cause; evidence ${prefix}:\n${result.stderr}\n${result.stdout}`);
    return result;
  }
  const binary = path.join(owned, 'pure-json-test');
  await run('compile', 'clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic',
    path.join(source, 'resource-current-json.test.cpp'), '-o', binary]);
  const result = await run('pure-controls', binary, []);
  const controls = JSON.parse(result.stdout);
  assert.deepEqual(controls, {status: 'PASS', publicCodecControls: 167, networkOrCryptoExecuted: false, sourceAdmission: false});
  for (const pin of inputs) assert.equal(sha(await readFile(path.join(source, pin.leaf))), pin.sha256, `source changed during pure controls: ${pin.leaf}`);
  const image = await readFile(binary);
  await writeFile(path.join(owned, 'RESULT.json'), JSON.stringify({inputs, binary: {path: binary, bytes: image.length, sha256: sha(image)},
    controls, RootAdmission: false, SourceAdmission: false, actualKernelExecuted: false}, null, 2) + '\n', {flag: 'wx'});
  t.diagnostic('Exact owned pure JSON CI evidence retained: ' + owned);
});
