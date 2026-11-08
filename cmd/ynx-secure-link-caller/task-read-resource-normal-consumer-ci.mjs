// Reproducible, Darwin-only new consumer control. Original SDK source comes
// from a separate exact checkout; testdata contains byte-exact supplier Hs.
// No Root fallback, SDK source patch, legacy suite, download or Go archive.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(here, '../..');
const declarations = path.join(here, 'testdata/task-read-normal-consumer');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = async file => {const b = await fs.readFile(file); return {path: file, bytes: b.length, sha256: sha(b)};};
const put = (name, value) => fs.writeFile(path.join(owned, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
async function privateRoot(name) {
  const requested = process.env[name]; assert.ok(requested && path.isAbsolute(requested), name + ' absolute root required');
  await fs.mkdir(requested, {recursive: true, mode: 0o700}); const actual = await fs.realpath(requested), st = await fs.lstat(requested);
  assert.equal(actual, requested); assert.ok(st.isDirectory() && !st.isSymbolicLink()); assert.equal(st.uid, process.geteuid()); assert.equal(st.mode & 0o077, 0); return actual;
}
assert.equal(process.platform, 'darwin'); assert.match(process.version, /^v24\./);
const owned = await fs.mkdtemp(path.join(await privateRoot('YNX_LINK_TASK_READ_NORMAL_EVIDENCE'), 'run-'));
const socketRoot = await privateRoot('YNX_LINK_TASK_READ_NORMAL_SOCKET_ROOT');
assert.ok(Buffer.byteLength(path.join(socketRoot, 'nc-XXXXXX/s')) < 104, 'real Unix socket pathname limit');
const sdkRoot = process.env.YNX_LINK_TASK_READ_NORMAL_SDK_SOURCE;
assert.ok(sdkRoot && path.isAbsolute(sdkRoot), 'explicit immutable SDK source checkout required');
const declaration = JSON.parse(await fs.readFile(path.join(declarations, 'ORIGINAL.json')));
const suppliers = new Map();
for (const original of declaration.supplierPins) {
  const actual = await pin(path.join(declarations, original.file)); assert.equal(actual.bytes, original.bytes); assert.equal(actual.sha256, original.sha256); suppliers.set(original.file, actual);
}
const authNative = JSON.parse(await fs.readFile(suppliers.get('AUTH-NATIVE-HANDOFF.json').path));
const sdkSource = name => path.join(sdkRoot, 'packages/wallet-auth/src', name);
const nativeSource = name => path.join(sdkRoot, 'packages/wallet-auth/native', name);
const authNativeSources = [];
for (const original of authNative.source) {const actual = await pin(nativeSource(path.basename(original.after.path))); assert.equal(actual.bytes, original.after.bytes); assert.equal(actual.sha256, original.after.sha256); authNativeSources.push(actual);}
const originalGoSource = await pin(path.join(repository, declaration.originalGoFixture.file));
assert.equal(originalGoSource.bytes, declaration.originalGoFixture.bytes); assert.equal(originalGoSource.sha256, declaration.originalGoFixture.sha256);
const baseFiles = ['native.c', 'task-read-resource-caller.mjs', 'task-read-resource-continuation.mjs', 'build.mjs',
  'task-read-resource-normal-consumer-ci.mjs', 'task-read-resource-normal-consumer.test.mjs', 'task-read-resource-normal-consumer.fixture.mm'];
// The fixture builds ordinary package sources, not any package *_test.go.
// Independently owned TLS tests are not inputs to this consumer executable.
const goFiles = (await fs.readdir(path.join(repository, 'internal/securelink'))).filter(f => f.startsWith('task_read_continuation') && f.endsWith('.go') && !f.endsWith('_test.go'));
assert.deepEqual(goFiles.sort(), ['task_read_continuation.go', 'task_read_continuation_unix.go', 'task_read_continuation_unsupported.go']);
const files = [...baseFiles.map(f => path.join(here, f)), originalGoSource.path, path.join(repository, 'go.mod'), path.join(repository, 'go.sum'),
  ...goFiles.map(f => path.join(repository, 'internal/securelink', f)), ...['local_caller.go', 'local_caller_unix.go', 'ipc_peer_darwin.go', 'ipc_peer_linux.go'].map(f => path.join(repository, 'internal/securelink', f)),
  path.join(declarations, 'ORIGINAL.json'), ...[...suppliers.values()].map(p => p.path), ...authNativeSources.map(p => p.path),
  sdkSource('desktop-grant-continuation-owner.mjs'), sdkSource('canonical.js'), sdkSource('desktop-grant-strong-continuation-transport-private.mjs')];
const before = await Promise.all(files.map(pin)); await put('SOURCE-BEFORE.json', before);
const env = {...process.env, GOTOOLCHAIN: 'local', GOWORK: 'off', GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB', CGO_ENABLED: '0'};
const commands = [];
async function run(name, command, args, timeout, extra = {}) {
  const result = spawnSync(command, args, {cwd: repository, env: {...env, ...extra}, encoding: 'utf8', timeout, maxBuffer: 8 << 20});
  const observation = {name, command, args, status: result.status, signal: result.signal, error: result.error ? {code: result.error.code, message: result.error.message} : null}; commands.push(observation);
  await fs.writeFile(path.join(owned, name + '.stdout'), result.stdout ?? '', {flag: 'wx', mode: 0o600}); await fs.writeFile(path.join(owned, name + '.stderr'), result.stderr ?? '', {flag: 'wx', mode: 0o600}); await put(name + '.json', observation);
  assert.equal(result.error, undefined, name + ' process failure'); assert.equal(result.status, 0, `${name} failed; ${owned}\n${result.stderr}\n${result.stdout}`); return result.stdout;
}
let first, counts, manifest;
try {
  const supplied = process.env.YNX_LINK_TASK_READ_NORMAL_SUPPLIED_MANIFEST;
  if (supplied) {
    assert.ok(path.isAbsolute(supplied)); manifest = JSON.parse(await fs.readFile(supplied));
    assert.equal(manifest.sdkSourceRoot, sdkRoot); assert.equal(manifest.socketRoot, socketRoot);
    // Exact source/receipt/binary pins are revalidated by the same test. This
    // reuses an existing fixture build, not its tests or past pass result.
  } else {
    assert.match(await run('go-version', 'go', ['version'], 30000), /^go version go1\.26\.10 darwin\/(?:amd64|arm64)\s*$/);
    await run('native-build', process.execPath, [path.join(here, 'build.mjs')], 120000);
    const executable = path.join(owned, 'PUBLIC-original-Go-continuation-peer');
    await run('original-go-fixture-build', 'go', ['build', '-mod=readonly', '-p', '1', '-o', executable, './cmd/ynx-secure-link-caller/go-task-read-continuation-fixture'], 180000);
    const binary = await pin(executable), receipt = path.join(owned, 'ORIGINAL-GO-RECEIPT.json'), sourceReceipt = path.join(owned, 'ORIGINAL-SOURCE-RECEIPT.json');
    await put('ORIGINAL-GO-RECEIPT.json', {PUBLIC: true, actualGoServer: true, binary: {bytes: binary.bytes, sha256: binary.sha256}, source: originalGoSource, commandResult: commands.at(-1), RootAdmission: false, SourceAdmission: false});
    await put('ORIGINAL-SOURCE-RECEIPT.json', [originalGoSource, await pin(path.join(here, 'build/caller.node'))].map(({path: file, bytes, sha256}) => ({file: path.relative(repository, file), bytes, sha256})));
    manifest = {schema: 'YNX-LINK-TASK-READ-NORMAL-CONSUMER-INPUTS/v1', socketRoot, sdkSourceRoot: sdkRoot,
      authNativeH: suppliers.get('AUTH-NATIVE-HANDOFF.json'), authNativeSources,
      authRecognizedH: suppliers.get('AUTH-RECOGNIZED-HANDOFF.json'), authRecognizedSourceFiles: suppliers.get('AUTH-RECOGNIZED-SOURCEFILES.json'),
      sdkH: suppliers.get('SDK-HANDOFF.json'), sdkSourceFiles: suppliers.get('SDK-SOURCEFILES.json'),
      authInventory: await pin(sdkSource('desktop-grant-continuation-owner.mjs')), sdkStrongAdapter: await pin(sdkSource('desktop-grant-strong-continuation-transport-private.mjs')),
      canonical: await pin(sdkSource('canonical.js')), carrier: await pin(path.join(here, 'task-read-resource-continuation.mjs')), physical: await pin(path.join(here, 'task-read-resource-caller.mjs')),
      callerNative: await pin(path.join(here, 'build/caller.node')), originalGo: binary, originalGoSource, originalGoReceipt: await pin(receipt), originalGoSourceReceipt: await pin(sourceReceipt)};
  }
  await put('INPUTS.json', manifest);
  const controls = path.join(owned, 'controls'); await fs.mkdir(controls, {mode: 0o700});
  const tap = await run('new-normal-consumer-six', process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', '--test-timeout=200000', path.join(here, 'task-read-resource-normal-consumer.test.mjs')], 240000,
    {YNX_LINK_TASK_READ_NORMAL_MANIFEST: path.join(owned, 'INPUTS.json'), YNX_LINK_TASK_READ_NORMAL_EVIDENCE: controls});
  counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {const values = [...tap.matchAll(new RegExp(`^# ${key} ([0-9]+)$`, 'gm'))]; assert.equal(values.length, 1); counts[key] = Number(values[0][1]);}
  assert.equal(counts.tests, 6); assert.equal(counts.pass, 6); for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(counts[key], 0);
} catch (error) {first = error;}
finally {
  const after = await Promise.all(files.map(pin)); await put('SOURCE-AFTER.json', after); try {assert.deepEqual(after, before);} catch (error) {first ??= error;}
  await put('RESULT.json', {schema: 'YNX-LINK-TASK-READ-ACTUAL-NAPI-SDK-CONSUMER/v1', commands, counts, sourceBeforeAfterSame: JSON.stringify(before) === JSON.stringify(after),
    firstCause: first ? {message: first.message, code: first.code} : null, Node: process.version, platform: process.platform,
    actualSDKStrongConsumer: true, actualAuthNAPIStageQualificationAndGetter: true, actualAuthRecognizedInventoryCode: true, actualKernelOriginalGo: true,
    PUBLICSourceHoldPublicLedgerAndCallerSeams: true, SDKFullResourceBridgeExecuted: false, P08StoreExecuted: false, wholeAuthAddonLinked: false, RootAdmission: false, SourceAdmission: false,
    GoArchiveBuilt: false, old24Executed: false, oldGo7Executed: false, oldAuth11Executed: false, deployed: false});
}
console.log(JSON.stringify({evidence: owned, passed: !first, counts})); if (first) throw first;
