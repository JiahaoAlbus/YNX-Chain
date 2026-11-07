// Original CI for the local-only Social L/C adapter. PUBLIC fixtures prove
// transport custody, never Host credentials, nonce authority or Source grants.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(here, '../..');
const destination = process.env.YNX_LINK_SOCIAL_DIRECTORY_CI_EVIDENCE;
assert.ok(destination && path.isAbsolute(destination), 'explicit absolute Social transport evidence root required');
await mkdir(destination, {recursive: true, mode: 0o700});
const owned = await mkdtemp(path.join(await realpath(destination), 'c-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const put = (name, value) => writeFile(path.join(owned, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
const goDirectory = path.join(repository, 'internal/securelink');
const socialGo = (await readdir(goDirectory)).filter(name => /^social_directory_.*\.go$/.test(name)).sort();
assert.ok(socialGo.some(name => name.endsWith('_test.go')), 'actual Social Go controls required');
const inputs = [
  '.github/workflows/chain-core.yml', 'go.mod', 'go.sum',
  ...socialGo.map(name => 'internal/securelink/' + name),
  ...['build.mjs', 'native.c', 'inbound-caller.mjs', 'check.sh',
    'social-directory-transport.mjs', 'social-directory-transport-private.mjs',
    'social-directory-transport-native.inc.c', 'social-directory-transport.test.mjs',
    'social-directory-public-peer.go.txt', 'social-directory-transport-ci.mjs',
    'testdata/social-directory-lc-r2/codec.mjs', 'testdata/social-directory-lc-r2/IDL.json',
    'testdata/social-directory-lc-r2/ORIGINAL.json'].map(name => 'cmd/ynx-secure-link-caller/' + name),
];
async function pin(file) {
  const bytes = await readFile(path.join(repository, file));
  return {file, bytes: bytes.length, sha256: sha(bytes)};
}
const before = await Promise.all(inputs.map(pin));
await put('SOURCE-BEFORE.json', before);
const commands = [];
async function run(name, command, args, env, timeout = 0) {
  const observed = spawnSync(command, args, {cwd: repository, env, timeout, encoding: 'utf8', maxBuffer: 8 << 20});
  const result = {name, command, args, status: observed.status, signal: observed.signal,
    error: observed.error ? {code: observed.error.code, message: observed.error.message} : null};
  commands.push(result);
  await writeFile(path.join(owned, name + '.stdout'), observed.stdout ?? '', {flag: 'wx', mode: 0o600});
  await writeFile(path.join(owned, name + '.stderr'), observed.stderr ?? '', {flag: 'wx', mode: 0o600});
  await put(name + '.json', result);
  assert.equal(result.error, null, `${name} process failure; evidence ${owned}`);
  assert.equal(result.status, 0, `${name} first cause; evidence ${owned}\n${observed.stderr}\n${observed.stdout}`);
  return observed.stdout;
}
let first, counts, goControls, native;
try {
  const goEnv = {...process.env, CGO_ENABLED: '0', GOTOOLCHAIN: 'local', GOWORK: 'off',
    GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB'};
  assert.match(await run('go-version', 'go', ['version'], goEnv, 30000),
    /^go version go1\.26\.10 (?:darwin|linux)\/(?:amd64|arm64)\s*$/);
  await run('native-build', process.execPath, [path.join(here, 'build.mjs')], process.env, 120000);
  native = await pin('cmd/ynx-secure-link-caller/build/caller.node');
  const go = await run('go-controls', 'go', ['test', '-mod=readonly', '-p', '1', '-count=1', '-timeout=90s',
    '-v', '-run', '^TestSocialDirectory', './internal/securelink'], goEnv);
  goControls = [...go.matchAll(/^--- PASS: (TestSocialDirectory\S*)/gm)].map(row => row[1]);
  assert.ok(goControls.length > 0, 'actual Social Go controls must execute');
  assert.doesNotMatch(go, /^\s*--- (?:FAIL|SKIP):/m, 'no failed or skipped Social Go controls');
  // The test owns bounded peers and their cleanup; do not kill it externally
  // and lose actual child exit or outstanding response-loan debt.
  const tap = await run('kernel-controls', process.execPath, ['--test', '--test-reporter=tap',
    '--test-concurrency=1', '--test-timeout=30000', path.join(here, 'social-directory-transport.test.mjs')],
  {...process.env, YNX_LINK_SOCIAL_DIRECTORY_TEST_ARTIFACTS: path.join(owned, 'controls')});
  counts = {};
  for (const name of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...tap.matchAll(new RegExp(`^# ${name} ([0-9]+)$`, 'gm'))];
    assert.equal(matches.length, 1, `one real TAP ${name} summary required`);
    counts[name] = Number(matches[0][1]);
  }
  assert.ok(counts.tests > 0 && counts.pass === counts.tests);
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(counts[name], 0);
} catch (error) { first = error; }
finally {
  const after = await Promise.all(inputs.map(pin));
  await put('SOURCE-AFTER.json', after);
  try {assert.deepEqual(after, before, 'Social source changed during controls');}
  catch (error) {first ??= error;}
  await put('RESULT.json', {schema: 'YNX-LINK-SOCIAL-DIRECTORY-TRANSPORT-CI/v1',
    state: first ? 'FAILED_OR_UNKNOWN' : 'LOCAL_OSPEER_TRANSPORT_CONTROLS_PASSED',
    platform: process.platform, arch: process.arch, node: process.version,
    inputs: before, commands, native, counts, goControls,
    firstCause: first ? {name: first.name, code: first.code, message: first.message} : null,
    PUBLIC: true, transportKind: 'localOSpeer', actualKernel: true, actualTLS: false,
    actualAuthHostExecuted: false, nonceLedgerExecuted: false, Source13SQLiteExecuted: false,
    normalMainSourceFactoryWired: false, RootAdmission: false, SourceAdmission: false,
    installed: false, deployed: false});
}
console.log(JSON.stringify({evidence: owned, passed: !first, counts, goControls}));
if (first) throw first;
