import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CORE19_C2_BINDING} from './combined-supply-profile.mjs';
import {validateObserverHandoff, parseOriginalProducerArgs, verifyFileInventory, verifyGeneratedCoreHeader,
  makeIncrementalGoPlan, extractOriginalSDK, validateContinuationMode, continuationReceiptState, createOwnedSuffixOutput, verifyNewGoEnvironment} from './retained-suffix.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
const row = (name, bytes) => ({repositoryPath: name, bytes: bytes.length, sha256: sha(bytes), gitBlob: blob(bytes)});
function observer() {
  return {schema: 'YNX-ORIGINAL-A-SINGLE49-OBSERVER-RACE-FIRSTCAUSE/v1',
    state: 'NORMAL_PRODUCER_INTERRUPTED_BY_OWN_OBSERVER_GO_TMP_ENOENT_NOT_PRODUCT_FAILURE', normalProducerActualExit: -15,
    normalReceiptAbsent: true, buildCommandLogAbsent: true, archiveQualificationNotClaimed: true, inputPOSTAllExact: true,
    terminal: {remainingOwned: [], mutexReleased: true},
    partialArchive: {path: '/PUBLIC/original/libynx_artifact_release.a', bytes: 16453296, sha256: '53f239db88d8ad479a006ce9166e1321c039a70a7ea13a3f09c7fbf507a12400'},
    partialHeader: {path: '/PUBLIC/original/libynx_artifact_release.h', bytes: 6925, sha256: 'a9946c9466b66a0e4ca5214cfbaa54f9b7ca2f143ed92f2d5d1746a71879efbd'}};
}
function argv() {
  const b = CORE19_C2_BINDING;
  return ['node', '/PUBLIC/repo/cmd/ynx-secure-link-private-client/build-combined.mjs',
    '--core-handoff', '/PUBLIC/bundle/SOURCE.json', '--core-sha256', b.inputs.source.sha256,
    '--auth-headers', '/PUBLIC/auth/HEADERS.json', '--auth-headers-sha256', b.inputs.authHeaders.sha256,
    '--native-undefined', '/PUBLIC/auth/UNDEFINED.json', '--native-undefined-sha256', b.inputs.nativeUndefined.sha256,
    '--link-commit', b.linkCommit, '--macos-deployment-target', '13.0', '--out', '/PUBLIC/original'];
}
function originalEnvironment() {
  return {GOVERSION: 'go1.26.10', GOOS: 'darwin', GOARCH: 'arm64', CGO_ENABLED: '1', GOWORK: 'off', GOFLAGS: '',
    GOCACHE: '/PUBLIC/original/go-cache', GOMODCACHE: '/PUBLIC/modcache', CC: '/PUBLIC/clang', CXX: '/PUBLIC/clang++',
    CGO_CFLAGS: '-I/PUBLIC/original/include -mmacosx-version-min=13.0 -isysroot /PUBLIC/SDK', CGO_CPPFLAGS: '',
    CGO_CXXFLAGS: '-O2 -g -mmacosx-version-min=13.0 -isysroot /PUBLIC/SDK', CGO_LDFLAGS: '-O2 -g -mmacosx-version-min=13.0 -isysroot /PUBLIC/SDK'};
}
const incremental = () => ({originalOutput: '/PUBLIC/original', output: '/PUBLIC/new-suffix', originalEnv: originalEnvironment(),
  sdk: '/PUBLIC/SDK', preEnv: {PATH: '/PUBLIC/bin:/usr/bin', PKG_CONFIG_PATH: '/PUBLIC/normal/openssl/pkgconfig', PKG_CONFIG_LIBDIR: '/PUBLIC/normal/openssl/pkgconfig'}});
function temporary(t) {
  const base = process.env.YNX_LINK_RETAINED_SUFFIX_TEST_ARTIFACTS ?? os.tmpdir();
  fs.mkdirSync(base, {recursive: true});
  const root = fs.realpathSync(fs.mkdtempSync(path.join(base, 'suffix-control-')));
  t.after(() => fs.rmSync(root, {recursive: true}));
  return root;
}

// Public metadata only; no retained archive, compiler, nm, Go or real source H.
test('retained suffix preserves interrupted producer and never interprets it as Go exit0', () => {
  const h = observer(), before = structuredClone(h);
  assert.equal(validateObserverHandoff(h), '/PUBLIC/original'); assert.deepEqual(h, before);
  for (const mutate of [
    h => {h.normalProducerActualExit = 0;}, h => {h.normalReceiptAbsent = false;}, h => {h.buildCommandLogAbsent = false;},
    h => {h.archiveQualificationNotClaimed = false;}, h => {h.inputPOSTAllExact = false;},
    h => h.terminal.remainingOwned.push({pid: 123}), h => {h.terminal.mutexReleased = false;},
  ]) {const bad = observer(); mutate(bad); assert.throws(() => validateObserverHandoff(bad));}
});

test('retained suffix refuses substituted archive header hash size or mixed original output', () => {
  for (const mutate of [
    h => {h.partialArchive.bytes++;}, h => {h.partialArchive.sha256 = 'f'.repeat(64);},
    h => {h.partialHeader.bytes++;}, h => {h.partialHeader.sha256 = 'f'.repeat(64);},
    h => {h.partialHeader.path = '/PUBLIC/other/libynx_artifact_release.h';},
    h => {h.partialArchive.path = '/PUBLIC/original/replacement.a';},
  ]) {const bad = observer(); mutate(bad); assert.throws(() => validateObserverHandoff(bad));}
});

test('retained suffix reads only the original9 immutable producer pairs', () => {
  const args = argv(), result = parseOriginalProducerArgs(args);
  assert.equal(result['--link-commit'], CORE19_C2_BINDING.linkCommit);
  assert.equal(result['--out'], '/PUBLIC/original');
  for (const mutate of [
    a => a.pop(), a => a.push('--extra', 'x'), a => {a[4] = '--core-handoff';},
    a => {a[5] = 'f'.repeat(64);}, a => {a[9] = 'f'.repeat(64);}, a => {a[13] = 'f'.repeat(64);},
    a => {a[15] = '8df4139adb14c68d93e0a55a56851399d46059ac';}, a => {a[17] = '27.2';},
    a => {a[3] = 'relative/SOURCE.json';}, a => {a[1] = '/PUBLIC/other-recipe.mjs';},
  ]) {const bad = argv(); mutate(bad); assert.throws(() => parseOriginalProducerArgs(bad));}
});

test('retained suffix inventory verifies exact original bytes including zero-byte file', t => {
  const root = temporary(t), bytes = Buffer.from('PUBLIC original\n');
  fs.mkdirSync(path.join(root, 'pkg')); fs.writeFileSync(path.join(root, 'pkg/a.go'), bytes); fs.writeFileSync(path.join(root, 'empty'), '');
  const expected = [row('pkg/a.go', bytes), row('empty', Buffer.alloc(0))];
  const before = fs.statSync(path.join(root, 'pkg/a.go'));
  const got = verifyFileInventory(root, expected, {checkGitBlob: true});
  assert.deepEqual(got.map(row => row.repositoryPath), ['empty', 'pkg/a.go']);
  assert.equal(fs.statSync(path.join(root, 'pkg/a.go')).mtimeMs, before.mtimeMs);
  assert.equal(fs.readFileSync(path.join(root, 'pkg/a.go')).equals(bytes), true);
});

test('retained suffix inventory rejects missing extra changed hash Git or duplicate path', t => {
  const root = temporary(t), bytes = Buffer.from('PUBLIC stable'); fs.writeFileSync(path.join(root, 'a'), bytes);
  const expected = row('a', bytes);
  for (const rows of [[], [expected, expected], [{...expected, bytes: expected.bytes + 1}],
    [{...expected, sha256: 'f'.repeat(64)}], [{...expected, gitBlob: 'f'.repeat(40)}]])
    assert.throws(() => verifyFileInventory(root, rows, {checkGitBlob: true}));
  fs.writeFileSync(path.join(root, 'extra'), 'PUBLIC'); assert.throws(() => verifyFileInventory(root, [expected]));
  fs.unlinkSync(path.join(root, 'extra')); fs.unlinkSync(path.join(root, 'a')); assert.throws(() => verifyFileInventory(root, [expected]));
});

test('retained suffix inventory refuses traversal empty segments and symlink leaves or directories', t => {
  const root = temporary(t), bytes = Buffer.from('PUBLIC'); fs.writeFileSync(path.join(root, 'a'), bytes);
  for (const name of ['../a', '/a', 'x/../a', 'x//a', './a', 'x\\a', 'a\0b']) assert.throws(() => verifyFileInventory(root, [row(name, bytes)]));
  fs.symlinkSync('a', path.join(root, 'b')); assert.throws(() => verifyFileInventory(root, [row('a', bytes), row('b', bytes)]));
  fs.unlinkSync(path.join(root, 'b')); fs.mkdirSync(path.join(root, 'real')); fs.symlinkSync('real', path.join(root, 'linked'));
  assert.throws(() => verifyFileInventory(root, [row('a', bytes)]));
});

test('retained suffix generated header requires all original Core declarations once', () => {
  const names = ['YNXOriginalV1', 'YNXResourceV1'], text = names.map(name => 'extern int32_t ' + name + '(void);').join('\n');
  assert.equal(verifyGeneratedCoreHeader(text, names).coreDeclarations, 2);
  assert.throws(() => verifyGeneratedCoreHeader(text, [...names, 'YNXMissingV1']));
  assert.throws(() => verifyGeneratedCoreHeader(text + '\n' + text.split('\n')[0], names));
  assert.throws(() => verifyGeneratedCoreHeader(text + '\nextern int32_t YNXUnlistedV1(void);', names));
});

test('retained suffix incremental plan is one nonexecuted same-source same-cache command with real x/work logs', () => {
  const input = incremental(), before = structuredClone(input), plan = makeIncrementalGoPlan(input);
  assert.deepEqual(input, before);
  assert.equal(plan.command, 'go'); assert.equal(plan.cwd, '/PUBLIC/original/source'); assert.equal(plan.env.GOCACHE, '/PUBLIC/original/go-cache');
  assert.equal(plan.args.filter(word => word === 'build').length, 1);
  for (const word of ['-x', '-work', '-mod=readonly', '-trimpath', '-buildmode=c-archive']) assert.ok(plan.args.includes(word));
  for (const word of ['-a', 'clean', '-test', '-race']) assert.equal(plan.args.includes(word), false);
  assert.equal(plan.args[plan.args.indexOf('-o') + 1], '/PUBLIC/new-suffix/incremental-archive/libynx_artifact_release.a');
  assert.equal(plan.env.GOTMPDIR.startsWith('/PUBLIC/new-suffix/'), true);
  assert.equal(plan.env.GOMAXPROCS, '2'); assert.equal(plan.env.GOMEMLIMIT, '1536MiB');
  assert.equal(plan.captureRealExitRequired, true); assert.equal(plan.cacheHitAssumed, false); assert.equal(plan.recompilationAssumed, false);
  assert.equal(plan.retainedArtifactsSourceAndHeadersMayBeWritten, false); assert.equal(plan.originalGoCacheMayBeWritten, true);
});

test('retained suffix incremental plan refuses altered cache toolchain flags SSL selection and output overlap', () => {
  for (const mutate of [
    x => {x.originalEnv.GOCACHE = '/PUBLIC/cold-cache';}, x => {x.originalEnv.GOVERSION = 'go1.26.11';},
    x => {x.originalEnv.CGO_CFLAGS += ' -DFAKE';}, x => {x.originalEnv.CGO_LDFLAGS = '-mmacosx-version-min=27.2';},
    x => {x.originalEnv.GOFLAGS = '-a';}, x => {x.originalEnv.GOARCH = 'amd64';},
    x => {x.preEnv.PKG_CONFIG_LIBDIR = '/PUBLIC/other';}, x => {x.output = '/PUBLIC/original/suffix';},
    x => {x.output = '/PUBLIC';}, x => {x.output = x.originalOutput;},
    x => {x.output = '/PUBLIC/other/../original/suffix';}, x => {x.originalOutput = '/PUBLIC/other/../original'; x.output = '/PUBLIC/original/suffix';},
  ]) {const bad = incremental(); mutate(bad); assert.throws(() => makeIncrementalGoPlan(bad));}
});


test('retained suffix SDK capture accepts actual parsed or quoted original flags without guessing SDK', () => {
  assert.equal(extractOriginalSDK(originalEnvironment().CGO_CFLAGS), '/PUBLIC/SDK');
  assert.equal(extractOriginalSDK('"-I/PUBLIC/include" "-mmacosx-version-min=13.0" "-isysroot" "/PUBLIC/SDK"'), '/PUBLIC/SDK');
  for (const text of ['', '-isysroot relative', '-isysroot /PUBLIC/SDK -DFAKE']) assert.throws(() => extractOriginalSDK(text));
  const input = incremental(); input.originalEnv.CGO_CFLAGS = '"-I/PUBLIC/original/include" "-mmacosx-version-min=13.0" "-isysroot" "/PUBLIC/SDK"';
  assert.equal(makeIncrementalGoPlan(input).env.GOCACHE, '/PUBLIC/original/go-cache');
});

test('retained suffix never executes continuation without an explicit bounded new Go budget', () => {
  validateContinuationMode(false, undefined); validateContinuationMode(true, 1); validateContinuationMode(true, 300000);
  for (const [enabled, ms] of [[false, 1], [true, undefined], [true, 0], [true, -1], [true, 300001], [true, 1.5], ['true', 1]])
    assert.throws(() => validateContinuationMode(enabled, ms));
});

test('retained suffix normal continuation state needs actual new exit0 and all new gates, not original presence', () => {
  const actual = {exit: 0, signal: null, error: null};
  assert.equal(continuationReceiptState(actual, true), 'COMBINED_CORE_LINK_ARCHIVE_VERIFIED_NOT_DEPLOYED');
  for (const [result, gates] of [[undefined, true], [{...actual, exit: null}, true], [{...actual, exit: -15}, true],
    [{...actual, exit: 1}, true], [{...actual, signal: 'SIGTERM'}, true], [{...actual, error: {code: 'ETIMEDOUT'}}, true], [actual, false]])
    assert.equal(continuationReceiptState(result, gates), 'FAILED_OUTPUT_RETAINED');
});


test('retained suffix refuses symlink output parent before any old-root mutation and never overwrites output', t => {
  const root = temporary(t), old = path.join(root, 'old'); fs.mkdirSync(old); fs.writeFileSync(path.join(old, 'KEEP'), 'PUBLIC old record');
  const alias = path.join(root, 'alias'); fs.symlinkSync(old, alias);
  const before = fs.readdirSync(old);
  assert.throws(() => createOwnedSuffixOutput(path.join(alias, 'new-output'), [old]));
  assert.deepEqual(fs.readdirSync(old), before); assert.equal(fs.existsSync(path.join(old, 'new-output')), false);
  const fresh = path.join(root, 'fresh'); createOwnedSuffixOutput(fresh, [old]); fs.writeFileSync(path.join(fresh, 'KEEP'), 'PUBLIC suffix');
  assert.throws(() => createOwnedSuffixOutput(fresh, [old])); assert.equal(fs.readFileSync(path.join(fresh, 'KEEP'), 'utf8'), 'PUBLIC suffix');
  assert.throws(() => createOwnedSuffixOutput(path.join(old, 'new-output'), [old])); assert.deepEqual(fs.readdirSync(old), before);
});

test('retained suffix checks new actual Go environment and prevents automatic toolchain succession', () => {
  const input = incremental(), plan = makeIncrementalGoPlan(input);
  assert.equal(plan.env.GOTOOLCHAIN, 'local');
  const probe = {...input.originalEnv, GOTOOLCHAIN: 'local'};
  assert.equal(verifyNewGoEnvironment(probe, input.originalEnv, plan).actualGoProbeMatchedOriginal, true);
  for (const key of ['GOVERSION', 'GOOS', 'GOARCH', 'CC', 'CXX', 'CGO_ENABLED', 'GOWORK', 'GOFLAGS', 'GOCACHE', 'GOMODCACHE',
    'CGO_CFLAGS', 'CGO_CPPFLAGS', 'CGO_CXXFLAGS', 'CGO_LDFLAGS', 'GOTOOLCHAIN']) {
    assert.throws(() => verifyNewGoEnvironment({...probe, [key]: 'PUBLIC altered'}, input.originalEnv, plan));
  }
  const parsed = {...probe, ...Object.fromEntries(['CGO_CFLAGS', 'CGO_CPPFLAGS', 'CGO_CXXFLAGS', 'CGO_LDFLAGS'].map(key => [key, plan.env[key]]))};
  assert.equal(verifyNewGoEnvironment(parsed, input.originalEnv, plan).originalGOTOOLCHAINClaimed, false);
});
