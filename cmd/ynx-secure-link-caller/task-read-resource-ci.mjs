// Finite P08 resource transport controls only. The fixture has no genuine
// Source, reservation, Store, receipt authority or business admission.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(here, '../..');
const destination = process.env.YNX_LINK_TASK_READ_RESOURCE_CI_EVIDENCE;
assert.ok(destination && path.isAbsolute(destination), 'explicit absolute resource transport evidence root required');
await mkdir(destination, {recursive: true, mode: 0o700});
const owned = await mkdtemp(path.join(await realpath(destination), 'c-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = async file => {const bytes = await readFile(path.join(repository, file)); return {file, bytes: bytes.length, sha256: sha(bytes)};};
const put = (name, value) => writeFile(path.join(owned, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
const inputs = ['.github/workflows/chain-core.yml', 'go.mod', 'go.sum',
  'internal/securelink/local_caller.go', 'internal/securelink/local_caller_unix.go',
  'internal/securelink/ipc_peer_darwin.go', 'internal/securelink/ipc_peer_linux.go',
  ...['build.mjs', 'native.c', 'social-directory-transport-native.inc.c', 'check.sh', 'task-read-resource-caller.mjs',
    'task-read-resource-caller.test.mjs', 'task-read-resource-ci.mjs',
    'task-read-resource-client-original.mjs', 'task-read-resource-client-original.test.mjs',
    'go-task-read-resource-fixture/main.go', 'testdata/task-read-resource/ORIGINAL.json',
    'testdata/task-read-resource-original/ORIGINAL.json'].map(name => 'cmd/ynx-secure-link-caller/' + name)];
const before = await Promise.all(inputs.map(pin));
await put('SOURCE-BEFORE.json', before);
const commands = [];
async function run(name, command, args, env, timeout = 0) {
  const result = spawnSync(command, args, {cwd: repository, env, timeout, encoding: 'utf8', maxBuffer: 8 << 20});
  const observation = {name, command, args, status: result.status, signal: result.signal,
    error: result.error ? {code: result.error.code, message: result.error.message} : null};
  commands.push(observation);
  await writeFile(path.join(owned, name + '.stdout'), result.stdout ?? '', {flag: 'wx', mode: 0o600});
  await writeFile(path.join(owned, name + '.stderr'), result.stderr ?? '', {flag: 'wx', mode: 0o600});
  await put(name + '.json', observation);
  assert.equal(observation.error, null, `${name} process failure; evidence ${owned}`);
  assert.equal(observation.status, 0, `${name} first cause; evidence ${owned}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
let first, counts, native;
try {
  const env = {...process.env, GOTOOLCHAIN: 'local', GOWORK: 'off', GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB'};
  assert.match(await run('go-version', 'go', ['version'], env, 30000), /^go version go1\.26\.10 (?:darwin|linux)\/(?:amd64|arm64)\s*$/);
  await run('native-build', process.execPath, [path.join(here, 'build.mjs')], process.env, 120000);
  native = await pin('cmd/ynx-secure-link-caller/build/caller.node');
  // Fixture-owned deadlines must complete with actual child cleanup; an
  // outer kill must not erase dispatch or response-loan progress.
  const tap = await run('resource-controls', process.execPath, ['--test', '--test-reporter=tap',
    '--test-concurrency=1', '--test-timeout=30000', path.join(here, 'task-read-resource-caller.test.mjs'),
    path.join(here, 'task-read-resource-client-original.test.mjs')],
  {...env, YNX_LINK_TASK_READ_RESOURCE_TEST_ARTIFACTS: path.join(owned, 'controls')});
  counts = {};
  for (const name of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const rows = [...tap.matchAll(new RegExp(`^# ${name} ([0-9]+)$`, 'gm'))];
    assert.equal(rows.length, 1, `one real TAP ${name} summary required`);
    counts[name] = Number(rows[0][1]);
  }
  assert.equal(counts.tests, 16, 'all ten transport and six original client controls must execute');
  assert.equal(counts.pass, counts.tests);
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(counts[name], 0);
} catch (error) {first = error;}
finally {
  const after = await Promise.all(inputs.map(pin));
  await put('SOURCE-AFTER.json', after);
  try {assert.deepEqual(after, before, 'resource transport source changed during controls');}
  catch (error) {first ??= error;}
  await put('RESULT.json', {schema: 'YNX-LINK-TASK-READ-RESOURCE-CI/v1',
    state: first ? 'FAILED_OR_UNKNOWN' : 'FINITE_THREE_ROUTE_KERNEL_TRANSPORT_CONTROLS_PASSED',
    platform: process.platform, arch: process.arch, node: process.version,
    inputs: before, commands, native, counts,
    firstCause: first ? {name: first.name, code: first.code, message: first.message} : null,
    PUBLIC: true, actualKernel: true, actualTLS: false, actualP08StoreExecuted: false,
    actualAuthReservationVerified: false, RootAdmission: false, SourceAdmission: false,
    installed: false, deployed: false});
}
console.log(JSON.stringify({evidence: owned, passed: !first, counts}));
if (first) throw first;
