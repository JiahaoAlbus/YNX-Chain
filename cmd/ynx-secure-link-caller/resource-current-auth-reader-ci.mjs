// Build the original P09 PUBLIC Go fixture and its owned-process broker from
// one immutable checkout, then exercise the actual Auth Reader and LINK body.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
const sourceCommit = 'a2c482534959cc3a63733835d86464853376ea2f';
const sourceTree = '07fc560f539fcfc5f5c793ce904565eb610106ad';
const leaves = [
  ['apps/network/localipc/resource_current_link_fixture_test.go', '1ee45dcf7fda9f5f5e30aa0823b6098bcf737ebdb99cb0676a07ecba79de1468'],
  ['apps/network/localipc/testdata/resource_current_link_driver.mm', '3d28acd498d360c1dd64cabee22f34b5277e5afeb2d98825b5455dabd65d2b87'],
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function pin(file) {
  const bytes = await readFile(file);
  return {path: file, bytes: bytes.length, sha256: sha(bytes)};
}
async function put(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
}
function absolute(name) {
  const value = process.env[name];
  assert.ok(value && path.isAbsolute(value), `explicit absolute ${name} required`);
  return value;
}

assert.equal(process.platform, 'darwin', 'original suspended-spawn broker requires Darwin; no substitute or skip');
const checkout = await realpath(absolute('YNX_LINK_P09_FIXTURE_SOURCE'));
const artifacts = absolute('YNX_LINK_AUTH_READER_TEST_ARTIFACTS');
await mkdir(artifacts, {recursive: true, mode: 0o700});
const owned = await mkdtemp(path.join(await realpath(artifacts), 'ci-'));
let sequence = 0;
async function run(label, command, args, cwd, timeout = 20000, env = process.env) {
  const result = spawnSync(command, args, {cwd, env, encoding: 'utf8', timeout, maxBuffer: 4 << 20});
  const prefix = path.join(owned, `${++sequence}-${label}`);
  await writeFile(prefix + '.stdout', result.stdout ?? '', {flag: 'wx', mode: 0o600});
  await writeFile(prefix + '.stderr', result.stderr ?? '', {flag: 'wx', mode: 0o600});
  const observation = {command, args, cwd, status: result.status, signal: result.signal,
    error: result.error ? {code: result.error.code, message: result.error.message} : null};
  await put(prefix + '.json', observation);
  assert.equal(result.error, undefined, `${label} process failure; original evidence ${prefix}`);
  assert.equal(result.status, 0, `${label} failed; original evidence ${prefix}\n${result.stderr}\n${result.stdout?.slice(-16000)}`);
  return {...observation, stdout: result.stdout};
}

assert.equal((await run('source-head', 'git', ['rev-parse', 'HEAD'], checkout)).stdout.trim(), sourceCommit);
assert.equal((await run('source-tree', 'git', ['rev-parse', 'HEAD^{tree}'], checkout)).stdout.trim(), sourceTree);
assert.equal((await run('source-clean', 'git', ['status', '--porcelain', '--untracked-files=all'], checkout)).stdout, '');
const sourceLeaves = [];
for (const [leaf, expected] of leaves) {
  const file = path.join(checkout, leaf), observed = await pin(file);
  assert.equal(observed.sha256, expected, `original fixed P09 leaf differs: ${leaf}`);
  sourceLeaves.push(observed);
}

const supplyRoot = path.join(here, 'testdata/auth-reader-r2');
const supply = JSON.parse(await readFile(path.join(supplyRoot, 'PROVENANCE.json'), 'utf8'));
const authH = await pin(path.join(supplyRoot, 'HANDOFF.json'));
const authHeader = await pin(path.join(supplyRoot, 'NetworkPublisherReaderV2.hpp'));
const authBaseH = await pin(path.join(supplyRoot, 'BASE-HANDOFF.json'));
const authCAS = await pin(path.join(supplyRoot, 'CAS.json'));
assert.deepEqual({bytes: authH.bytes, sha256: authH.sha256}, supply.authH);
assert.deepEqual({bytes: authHeader.bytes, sha256: authHeader.sha256}, supply.authHeader);
assert.deepEqual({bytes: authBaseH.bytes, sha256: authBaseH.sha256}, supply.authBaseH);
assert.deepEqual({bytes: authCAS.bytes, sha256: authCAS.sha256}, supply.cas);

// Actual executable paths are part of the original process observation. Keep
// the source-qualified image directory separate from the short socket root so
// the legitimate maximum-identity response also crosses Go's chunking boundary
// on a hosted runner. No response fields or serialization are changed.
const images = path.join(owned, 'source-images', 'p09', sourceCommit);
await mkdir(images, {recursive: true, mode: 0o700});
const go = path.join(images, 'original-go-resource-server');
const scratchParent = absolute('YNX_LINK_AUTH_READER_BUILD_SCRATCH');
await mkdir(scratchParent, {recursive: true, mode: 0o700});
const scratch = await mkdtemp(path.join(await realpath(scratchParent), 'g-'));
const goEnv = {...process.env, CGO_ENABLED: '1', GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB', GOWORK: 'off',
  GOTOOLCHAIN: 'local', GOCACHE: path.join(scratch, 'cache'), GOTMPDIR: path.join(scratch, 'tmp')};
await mkdir(goEnv.GOCACHE, {mode: 0o700});await mkdir(goEnv.GOTMPDIR, {mode: 0o700});
assert.match((await run('go-version', 'go', ['version'], checkout)).stdout, /^go version go1\.26\.10 darwin\/(?:arm64|amd64)\s*$/);
const goBuild = await run('original-go-build', 'go', ['test', '-c', '-mod=readonly', '-p', '1', '-o', go, './apps/network/localipc'], checkout, 180000, goEnv);
const driver = path.join(owned, 'original-go-link-driver-r2');
const driverBuild = await run('original-driver-build', 'clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror',
  '-Wno-deprecated-declarations', '-fobjc-arc', '-framework', 'Foundation', path.join(checkout, leaves[1][0]), '-o', driver], checkout);
assert.equal((await run('source-after', 'git', ['status', '--porcelain', '--untracked-files=all'], checkout)).stdout, '');
const producerReceipts = [];
for (const [role, binary, commandResult] of [['original-go', go, goBuild], ['original-driver', driver, driverBuild]]) {
  const file = path.join(owned, `${role}-PRODUCER.json`);
  const {stdout, ...command} = commandResult;
  await put(file, {schema: 'YNX-LINK-AUTH-READER-CI-PRODUCER/v1', role, sourceCommit, sourceTree, sourceLeaves,
    commandResult: command, binary: await pin(binary), PUBLIC: true, RootAdmission: false, SourceAdmission: false});
  producerReceipts.push(await pin(file));
}
const manifest = path.join(owned, 'INPUTS.json');
await put(manifest, {version: 1, authH, authBaseH, authHeader, driver: await pin(driver), go: await pin(go), producerReceipts,
  cases: [{mode: 'normal', control: 'current'}, {mode: 'chunked', control: 'current'}, {mode: 'normal', control: 'prewrite-denial'}]});
const inputs = await pin(manifest);
const goRoot = path.join(owned, 'g');await mkdir(goRoot, {mode: 0o700});
// The test owns its compiler and three bounded original brokers. Do not kill
// Node earlier than their own deadlines and discard its child cleanup/results.
// Its 540s suite budget encloses 45s compile + 3*150s brokers and evidence.
await run('actual-auth-reader-go', process.execPath, ['--test', path.join(here, 'resource-current-auth-reader-go.test.mjs')], repository, 0,
  {...process.env, GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB', YNX_LINK_AUTH_READER_INPUTS: manifest, YNX_LINK_AUTH_READER_INPUTS_BYTES: String(inputs.bytes),
    YNX_LINK_AUTH_READER_INPUTS_SHA256: inputs.sha256, YNX_LINK_AUTH_READER_GO_ROOT: goRoot});
await put(path.join(owned, 'RESULT.json'), {version: 1, sourceCommit, sourceTree, inputs, producerReceipts,
  actualAuthReaderAndLINKAndOriginalGo: true, RootAdmission: false, SourceAdmission: false, installedNative: false});
process.stdout.write(`Original Auth Reader/Go source, compiler, process and first-cause evidence: ${owned}\n`);
