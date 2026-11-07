// Original CI entry for the new PRIVATE TaskGrant transport owner. The real
// kernel peer carries PUBLIC test DATA; it grants no Auth/Root/Source rights.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
const destination = process.env.YNX_LINK_TASK_GRANT_CI_EVIDENCE;
assert.ok(destination && path.isAbsolute(destination), 'explicit absolute TaskGrant CI evidence root required');
await mkdir(destination, {recursive: true, mode: 0o700});
const owned = await mkdtemp(path.join(await realpath(destination), 'c-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const put = (leaf, value) => writeFile(path.join(owned, leaf), JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
const leaves = [
  'task-grant-transport.mjs', 'task-grant-transport-private.mjs',
  'task-grant-transport.test.mjs', 'task-grant-transport-ci.mjs',
  'inbound-caller.mjs', 'native.c', 'build.mjs', 'check.sh',
];
const pin = async file => {
  const bytes = await readFile(file);
  return {file: path.relative(repository, file), bytes: bytes.length, sha256: sha(bytes)};
};
const inputs = await Promise.all(leaves.map(leaf => pin(path.join(here, leaf))));
inputs.push(await pin(path.join(repository, '.github/workflows/chain-core.yml')));
for (const leaf of ['go.mod', 'go.sum', 'internal/securelink/authority_ingress_unix.go',
  'internal/securelink/task_grant_transport_unix.go', 'internal/securelink/task_grant_transport_unsupported.go',
  'internal/securelink/task_grant_transport_unix_test.go',
  'internal/securelink/task_grant_transport_openssl_test.go']) inputs.push(await pin(path.join(repository, leaf)));
await put('SOURCE-BEFORE.json', inputs);
const commands = [];
let first;
function run(label, args, env = process.env, timeout = 120000, command = process.execPath) {
  const observed = spawnSync(command, args, {
    cwd: repository, env, encoding: 'utf8', timeout, maxBuffer: 4 << 20,
  });
  const result = {label, command, args, status: observed.status,
    signal: observed.signal, error: observed.error ? {code: observed.error.code, message: observed.error.message} : null};
  commands.push(result);
  return {result, stdout: observed.stdout ?? '', stderr: observed.stderr ?? ''};
}
async function checked(label, args, env, timeout, command) {
  const out = run(label, args, env, timeout, command);
  await writeFile(path.join(owned, label + '.stdout'), out.stdout, {flag: 'wx', mode: 0o600});
  await writeFile(path.join(owned, label + '.stderr'), out.stderr, {flag: 'wx', mode: 0o600});
  await put(label + '.json', out.result);
  assert.equal(out.result.error, null, `${label} process failure; evidence ${owned}`);
  assert.equal(out.result.status, 0, `${label} failed; evidence ${owned}\n${out.stderr}\n${out.stdout}`);
  return out;
}
let counts, binary, goControls;
try {
  const goVersion = await checked('go-version', ['version'], {...process.env, GOTOOLCHAIN: 'local'}, 30000, 'go');
  assert.match(goVersion.stdout, /^go version go1\.26\.10 (?:darwin|linux)\/(?:arm64|amd64)\s*$/,
    'same local Go 1.26.10 executable required; do not infer it from automatic toolchain selection');
  const go = await checked('go-closed-registration', ['test', '-mod=readonly', '-p', '1', '-count=1', '-timeout=60s',
    '-v', '-run', '^TestDesktopTaskGrant', './internal/securelink'],
  {...process.env, CGO_ENABLED: '0', GOWORK: 'off', GOTOOLCHAIN: 'local', GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB'},
  0, 'go');
  goControls = [...go.stdout.matchAll(/^--- PASS: (TestDesktopTaskGrant\S*)/gm)].map(row => row[1]);
  assert.deepEqual([...goControls].sort(), ['TestDesktopTaskGrantIPCIngressClosedRegistration',
    'TestDesktopTaskGrantIPCIngressRejectsRouteExpansion'], 'both original closed-registration Go controls must actually execute');
  assert.doesNotMatch(go.stdout, /^\s*--- (?:FAIL|SKIP):/m, 'no failed or skipped TaskGrant Go controls');
  await checked('native-build', [path.join(here, 'build.mjs')]);
  binary = await pin(path.join(here, 'build/caller.node'));
  const controls = path.join(owned, 'controls');
  const out = await checked('kernel-controls', ['--test', '--test-reporter=tap', '--test-concurrency=1',
    '--test-timeout=30000', path.join(here, 'task-grant-transport.test.mjs')],
  // The test owns bounded peers and cleanup. Its own per-test deadlines must
  // run to completion; an outer kill would discard those process observations.
  {...process.env, YNX_LINK_TASK_GRANT_TEST_ARTIFACTS: controls}, 0);
  const count = name => {
    const matches = [...out.stdout.matchAll(new RegExp(`^# ${name} ([0-9]+)$`, 'gm'))];
    assert.equal(matches.length, 1, `one actual TAP ${name} summary required`);
    return Number(matches[0][1]);
  };
  counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(k => [k, count(k)]));
  assert.ok(counts.tests > 0 && counts.pass === counts.tests, 'all new transport controls must actually execute');
  for (const k of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(counts[k], 0, `no ${k} transport controls`);
} catch (error) {
  first = error;
} finally {
  const after = await Promise.all(inputs.map(row => pin(path.join(repository, row.file))));
  await put('SOURCE-AFTER.json', after);
  try { assert.deepEqual(after, inputs, 'source changed during TaskGrant transport controls'); }
  catch (error) { first ??= error; }
  await put('RESULT.json', {schema: 'YNX-LINK-TASK-GRANT-TRANSPORT-CI/v1',
    state: first ? 'FAILED_OR_UNKNOWN' : 'PRIVATE_TRANSPORT_KERNEL_CONTROLS_PASSED',
    platform: process.platform, arch: process.arch, node: process.version,
    inputs, commands, binary, counts, goControls,
    firstCause: first ? {name: first.name, code: first.code, message: first.message} : null,
    PUBLIC: true, actualKernel: true, actualTLS: false, normalAuthBackendWired: false,
    resourceEffectBridgeWired: false, RootAdmission: false, SourceAdmission: false,
    installed: false, deployed: false});
}
console.log(JSON.stringify({evidence: owned, passed: !first, counts}));
if (first) throw first;
