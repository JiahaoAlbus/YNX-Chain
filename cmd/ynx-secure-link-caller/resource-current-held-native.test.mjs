// Independent held r2 controls. Frozen r1 12/167 and Go/archive are not run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, chmod, realpath, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const source = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(source, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = [
  'same-fd-four-operations-two-stage-packet-drain',
  'known-unavailable-with-and-without-reader-retains-attempt',
  'known-pending-needs-explicit-same-session-query',
  'native-revocation-blocks-current-keeps-original-cleanup',
  'inflight-current-retire-keeps-socket-and-original-response',
  'inflight-packet-writer-borrow-cannot-release-or-close',
  'remote-closed-plus-packet-drain-still-waits-native-release',
  'lost-half-timeout-close-ack-keeps-unknown-parent-no-redial',
  'same-session-independent-os-lifetime-and-operation-ack-refusals',
];
test('resource_current held native actual Unix lifetime, ACK and UNKNOWN custody module', {timeout: 70000}, async t => {
  assert.ok(['darwin', 'linux'].includes(process.platform), 'actual Darwin/Linux kernel required; no simulated peer or skip');
  const root = process.env.YNX_LINK_RESOURCE_CURRENT_TEST_ARTIFACTS;
  assert.ok(root && path.isAbsolute(root), 'explicit YNX_LINK_RESOURCE_CURRENT_TEST_ARTIFACTS required');
  await mkdir(root, {recursive: true, mode: 0o700});const owned = await mkdtemp(path.join(await realpath(root), 'h-'));await chmod(owned, 0o700);
  assert.ok(Buffer.byteLength(path.join(owned, 'c99/s')) < 104, 'owned evidence root exceeds Unix socket limit; no fallback');
  let sequence = 0;
  async function run(name, command, args, timeout = 20000) {
    const result = spawnSync(command, args, {cwd: repository, encoding: 'utf8', timeout, maxBuffer: 2 << 20});
    const prefix = path.join(owned, `${++sequence}-${name}`);
    await writeFile(prefix + '.stdout', result.stdout ?? '', {flag: 'wx'});await writeFile(prefix + '.stderr', result.stderr ?? '', {flag: 'wx'});
    await writeFile(prefix + '.json', JSON.stringify({command, args, status: result.status, signal: result.signal,
      error: result.error ? {code: result.error.code, message: result.error.message} : null}, null, 2) + '\n', {flag: 'wx'});
    assert.equal(result.error, undefined, `${name} process failure; evidence ${prefix}: ${result.error?.message}`);
    assert.equal(result.status, 0, `${name} first cause; evidence ${prefix}:\n${result.stderr}\n${result.stdout}`);return result;
  }
  const pins = [];
  for (const leaf of ['resource_current_client_v2.h', 'resource_current_client_v1.h', 'private_client_v1.h',
    'resource-current-held-client.cpp', 'resource-current-held-identity.hpp', 'resource-current-held-identity.cpp', 'resource-current-held-bound.hpp',
    'resource-current-peer.hpp', 'resource-current-peer.cpp', 'resource-current-json.hpp', 'resource-current-held-json.hpp', 'resource-current-held-json.test.cpp',
    'resource-current-held-native.test.cpp', 'resource-current-held-native.test.mjs']) {
    const bytes = await readFile(path.join(source, leaf));pins.push({leaf, bytes: bytes.length, sha256: hash(bytes)});
  }
  await writeFile(path.join(owned, 'SOURCE-BEFORE.json'), JSON.stringify(pins, null, 2) + '\n', {flag: 'wx'});
  let flags = ['-lbsm'];
  if (process.platform === 'linux') {
    const result = await run('openssl-flags', 'pkg-config', ['--cflags', '--libs', 'openssl']);flags = result.stdout.trim().split(/\s+/).filter(Boolean);
    assert.ok(flags.every(flag => /^[-A-Za-z0-9_./+=,:]+$/.test(flag)), 'unexpected pkg-config flag token');
  }
  const binary = path.join(owned, 'held-native-test');
  await run('compile', 'clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic', '-pthread',
    ...['resource-current-held-client.cpp', 'resource-current-held-identity.cpp', 'resource-current-peer.cpp',
      'resource-current-held-native.test.cpp'].map(leaf => path.join(source, leaf)), ...flags, '-o', binary], 40000);
  const result = await run('kernel-controls', binary, [owned], 25000);
  const rows = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.filter(row => row.control).map(row => row.control), expected);assert.ok(rows.filter(row => row.control).every(row => row.passed === true));
  assert.deepEqual(rows.at(-1), {summary: true, controls: expected.length, unknownParentsRetained: 9, actualGoServer: false,
    transportOnly: true, RootAdmission: false, SourceAdmission: false});
  for (const pin of pins) assert.equal(hash(await readFile(path.join(source, pin.leaf))), pin.sha256, `source changed during held module: ${pin.leaf}`);
  const image = await readFile(binary);
  await writeFile(path.join(owned, 'RESULT.json'), JSON.stringify({pins, binary: {path: binary, bytes: image.length, sha256: hash(image)},
    controls: rows, actualKernel: process.platform, actualGoServer: false, actualAuthFence: false, RootAdmission: false,
    SourceAdmission: false, deployed: false}, null, 2) + '\n', {flag: 'wx'});
  t.diagnostic('Exact held compiler/kernel evidence retained: ' + owned);
});

test('resource_current held pure JSON lifecycle controls enter the original native CI command', {timeout: 15000}, async t => {
  const root = process.env.YNX_LINK_RESOURCE_CURRENT_TEST_ARTIFACTS;
  assert.ok(root && path.isAbsolute(root), 'explicit YNX_LINK_RESOURCE_CURRENT_TEST_ARTIFACTS required');
  await mkdir(root, {recursive: true, mode: 0o700});const owned = await mkdtemp(path.join(await realpath(root), 'p-'));await chmod(owned, 0o700);
  const pins = [];
  for (const leaf of ['resource-current-json.hpp', 'resource-current-held-json.hpp', 'resource-current-held-json.test.cpp', 'resource-current-held-native.test.mjs']) {
    const bytes = await readFile(path.join(source, leaf));pins.push({leaf, bytes: bytes.length, sha256: hash(bytes)});
  }
  await writeFile(path.join(owned, 'SOURCE-BEFORE.json'), JSON.stringify(pins, null, 2) + '\n', {flag: 'wx'});
  let sequence = 0;
  async function run(name, command, args) {
    const result = spawnSync(command, args, {cwd: repository, encoding: 'utf8', timeout: 10000, maxBuffer: 2 << 20});
    const prefix = path.join(owned, `${++sequence}-${name}`);
    await writeFile(prefix + '.stdout', result.stdout ?? '', {flag: 'wx'});await writeFile(prefix + '.stderr', result.stderr ?? '', {flag: 'wx'});
    await writeFile(prefix + '.json', JSON.stringify({command, args, status: result.status, signal: result.signal,
      error: result.error ? {code: result.error.code, message: result.error.message} : null}, null, 2) + '\n', {flag: 'wx'});
    assert.equal(result.error, undefined, `${name} process failure; evidence ${prefix}: ${result.error?.message}`);
    assert.equal(result.status, 0, `${name} first cause; evidence ${prefix}:\n${result.stderr}\n${result.stdout}`);return result;
  }
  const binary = path.join(owned, 'held-pure-json-test');
  await run('compile', 'clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic', path.join(source, 'resource-current-held-json.test.cpp'), '-o', binary]);
  const result = await run('pure-held-controls', binary, []);const controls = JSON.parse(result.stdout);
  assert.deepEqual(controls, {status: 'PASS', publicHeldCodecControls: 160, r1SuiteRerun: false, kernelOrGoOrCryptoExecuted: false, sourceAdmission: false});
  for (const pin of pins) assert.equal(hash(await readFile(path.join(source, pin.leaf))), pin.sha256, `source changed during held pure controls: ${pin.leaf}`);
  const image = await readFile(binary);
  await writeFile(path.join(owned, 'RESULT.json'), JSON.stringify({pins, binary: {path: binary, bytes: image.length, sha256: hash(image)}, controls,
    actualKernelExecuted: false, actualGoServer: false, actualAuthFence: false, RootAdmission: false, SourceAdmission: false}, null, 2) + '\n', {flag: 'wx'});
  t.diagnostic('Exact held pure JSON CI evidence retained: ' + owned);
});

test('resource_current endpoint-bound original four stamps reject replacement before dispatch', {timeout: 30000}, async t => {
  assert.ok(['darwin', 'linux'].includes(process.platform), 'actual Darwin/Linux kernel required');
  const root = process.env.YNX_LINK_RESOURCE_CURRENT_TEST_ARTIFACTS;assert.ok(root && path.isAbsolute(root), 'explicit YNX_LINK_RESOURCE_CURRENT_TEST_ARTIFACTS required');
  await mkdir(root, {recursive: true, mode: 0o700});const owned = await mkdtemp(path.join(await realpath(root), 'b-'));await chmod(owned, 0o700);
  assert.ok(Buffer.byteLength(path.join(owned, 'c99/s')) < 104, 'owned evidence root exceeds Unix socket limit; no fallback');
  let sequence = 0;
  async function run(name, command, args, timeout = 15000) {
    const result = spawnSync(command, args, {cwd: repository, encoding: 'utf8', timeout, maxBuffer: 2 << 20});const prefix = path.join(owned, `${++sequence}-${name}`);
    await writeFile(prefix + '.stdout', result.stdout ?? '', {flag: 'wx'});await writeFile(prefix + '.stderr', result.stderr ?? '', {flag: 'wx'});
    await writeFile(prefix + '.json', JSON.stringify({command, args, status: result.status, signal: result.signal,
      error: result.error ? {code: result.error.code, message: result.error.message} : null}, null, 2) + '\n', {flag: 'wx'});
    assert.equal(result.error, undefined, `${name} process failure; evidence ${prefix}: ${result.error?.message}`);
    assert.equal(result.status, 0, `${name} first cause; evidence ${prefix}:\n${result.stderr}\n${result.stdout}`);return result;
  }
  const pins = [];
  for (const leaf of ['resource_current_client_v2.h', 'resource_current_client_v1.h', 'private_client_v1.h',
    'resource-current-held-client.cpp', 'resource-current-held-identity.hpp', 'resource-current-held-identity.cpp', 'resource-current-held-bound.hpp',
    'resource-current-peer.hpp', 'resource-current-peer.cpp', 'resource-current-json.hpp', 'resource-current-held-json.hpp',
    'resource-current-held-native.test.cpp', 'resource-current-held-native.test.mjs']) {
    const bytes = await readFile(path.join(source, leaf));pins.push({leaf, bytes: bytes.length, sha256: hash(bytes)});
  }
  await writeFile(path.join(owned, 'SOURCE-BEFORE.json'), JSON.stringify(pins, null, 2) + '\n', {flag: 'wx'});
  let flags = ['-lbsm'];
  if (process.platform === 'linux') { const result = await run('openssl-flags', 'pkg-config', ['--cflags', '--libs', 'openssl']);flags = result.stdout.trim().split(/\s+/).filter(Boolean);assert.ok(flags.every(flag => /^[-A-Za-z0-9_./+=,:]+$/.test(flag)), 'unexpected pkg-config flag token'); }
  const binary = path.join(owned, 'endpoint-bound-test');
  await run('compile', 'clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic', '-pthread',
    ...['resource-current-held-client.cpp', 'resource-current-held-identity.cpp', 'resource-current-peer.cpp', 'resource-current-held-native.test.cpp'].map(leaf => path.join(source, leaf)), ...flags, '-o', binary]);
  const result = await run('endpoint-controls', binary, [owned, '--endpoint-bound']);const rows = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows, [{control: 'original-endpoint-four-stamps-prewrite-and-same-pid-replacement', passed: true},
    {boundSummary: true, controls: 1, boundCases: 6, actualGoServer: false, transportOnly: true, RootAdmission: false, SourceAdmission: false}]);
  for (const pin of pins) assert.equal(hash(await readFile(path.join(source, pin.leaf))), pin.sha256, `source changed during endpoint controls: ${pin.leaf}`);
  const image = await readFile(binary);
  await writeFile(path.join(owned, 'RESULT.json'), JSON.stringify({pins, binary: {path: binary, bytes: image.length, sha256: hash(image)}, controls: rows,
    actualKernel: process.platform, observationLimits: 'These are pre/post syscall observations, not an atomic filesystem/connect/Source transaction.',
    actualGoServer: false, actualAuthReference: false, RootAdmission: false, SourceAdmission: false}, null, 2) + '\n', {flag: 'wx'});
  t.diagnostic('Exact endpoint-bound compiler/kernel evidence retained: ' + owned);
});

test('held PUBLIC same-source Go caller requires its test guard and original fixture pins', {timeout: 20000}, async t => {
  const root = process.env.YNX_LINK_RESOURCE_CURRENT_TEST_ARTIFACTS;
  assert.ok(root && path.isAbsolute(root));await mkdir(root, {recursive: true, mode: 0o700});
  const owned = await mkdtemp(path.join(await realpath(root), 'v-'));await chmod(owned, 0o700);
  let sequence = 0;
  async function run(label, command, args, status) {
    const result = spawnSync(command, args, {cwd: repository, encoding: 'utf8', timeout: 15000, maxBuffer: 2 << 20});
    const prefix = path.join(owned, `${++sequence}-${label}`);
    await writeFile(prefix + '.stdout', result.stdout ?? '', {flag: 'wx'});await writeFile(prefix + '.stderr', result.stderr ?? '', {flag: 'wx'});
    await writeFile(prefix + '.json', JSON.stringify({command, args, status: result.status, signal: result.signal,
      error: result.error?.code ?? null}, null, 2) + '\n', {flag: 'wx'});
    assert.equal(result.error, undefined, `${label}: ${result.error?.message}`);
    assert.equal(result.status, status, `${label}: ${result.stderr}\n${result.stdout}`);return result;
  }
  const caller = path.join(source, 'resource-current-held-go-fixture-call.cpp');
  const refused = await run('production-guard', 'clang++', ['-std=c++17', '-fsyntax-only', caller], 1);
  assert.ok(refused.stderr.includes('Compile this PUBLIC caller only with YNX_LINK_RESOURCE_CURRENT_HELD_TEST_CALLER'));
  let flags = ['-lbsm'];
  if (process.platform === 'linux') {
    const result = await run('openssl-flags', 'pkg-config', ['--cflags', '--libs', 'openssl'], 0);
    flags = result.stdout.trim().split(/\s+/).filter(Boolean);assert.ok(flags.every(flag => /^[-A-Za-z0-9_./+=,:]+$/.test(flag)));
  }
  const binary = path.join(owned, 'public-held-go-caller');
  await run('test-only-compile', 'clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic', '-pthread',
    '-DYNX_LINK_RESOURCE_CURRENT_HELD_TEST_CALLER', ...['resource-current-held-client.cpp', 'resource-current-held-identity.cpp',
      'resource-current-peer.cpp', 'resource-current-held-go-fixture-call.cpp'].map(leaf => path.join(source, leaf)), ...flags, '-o', binary], 0);
  await run('missing-fixture-pins', binary, [], 2);
  const bytes = await readFile(caller), image = await readFile(binary);
  await writeFile(path.join(owned, 'RESULT.json'), JSON.stringify({caller: {path: caller, bytes: bytes.length, sha256: hash(bytes)},
    binary: {path: binary, bytes: image.length, sha256: hash(image)}, productionCompileRefused: true,
    unpinnedExecutionRefused: true, actualGoExecuted: false, RootAdmission: false, SourceAdmission: false}, null, 2) + '\n', {flag: 'wx'});
  t.diagnostic('Exact held guarded caller evidence retained: ' + owned);
});
