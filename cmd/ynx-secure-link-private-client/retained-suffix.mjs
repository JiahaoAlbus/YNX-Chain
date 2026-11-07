// Read-only postbuild recovery for one owner-reviewed interrupted producer.
// Default inspection never invokes Go. Explicit Root/A --continue runs one
// same-source/cache Go build; retained artifacts and original UNKNOWN stay intact.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CORE19_C2_BINDING, selectCoreSupplyProfile, normalizeCoreSupply, verifyCoreSupplyBytes,
  verifyCore19C2Recipe, verifyCore19C2NeutralSymbols, verifyCoreCommandDependencyClosure,
  verifyCombinedSupplyResult} from './combined-supply-profile.mjs';
import {checkCombinedArchive} from './combined-archive-symbols.mjs';
import {checkArchiveDeployment} from './combined-archive-deployment.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../..');
const commandPackage = 'cmd/ynx-artifact-release-cabi';
const tags = 'securelink_openssl,securelink_pay_native_startup,securelink_product_pay_transport';
export const RETAINED_OBSERVER_PIN = Object.freeze({bytes: 5953, sha256: 'f3bd7c1cd3c3965f3ce03fad31f0e77b51fa26f27fe3cf35288e5a1f8bdd19db'});
export const PRIOR_SUFFIX_PIN = Object.freeze({bytes: 97577, sha256: 'c0b524a60dc81dd601b827f921bc912e935b77ff1bdc8cded100ad693a192954'});
export const ORIGINAL_GO_TOOLCHAIN_PINS = Object.freeze({
  executable: Object.freeze({bytes: 14534704, sha256: '5742f0004c49c005313d88cd06df964b09cad6bcf2eac4506bdb90abc923b1f4'}),
  version: Object.freeze({bytes: 36, sha256: '3f3fbe1bb9146eb51957d11386aabb1016b0cb389b8cb551e831abefc77ee54f'}),
});

const archivePin = {bytes: 16453296, sha256: '53f239db88d8ad479a006ce9166e1321c039a70a7ea13a3f09c7fbf507a12400'};
const generatedPin = {bytes: 6925, sha256: 'a9946c9466b66a0e4ca5214cfbaa54f9b7ca2f143ed92f2d5d1746a71879efbd'};
const requireValue = (value, message) => {if (!value) throw Error('Retained suffix: ' + message);};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
const inside = (parent, candidate) => candidate === parent || candidate.startsWith(parent + path.sep);
const samePin = (a, b) => a?.bytes === b.bytes && a.sha256 === b.sha256;
const exact = (actual, expected, label) => requireValue(Array.isArray(actual) && new Set(actual).size === actual.length &&
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()), 'closed unique ' + label + ' required');
function regular(file) {
  const absolute = path.resolve(file), stat = fs.lstatSync(absolute);
  requireValue(stat.isFile() && stat.uid === process.getuid(), 'original owned regular file required: ' + absolute);
  // Parent-directory symlinks would otherwise redirect a retained path.
  requireValue(fs.realpathSync(absolute) === absolute, 'symlinked original path refused: ' + absolute);
  return stat;
}
function readStable(file) {
  const before = regular(file), fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    requireValue(opened.dev === before.dev && opened.ino === before.ino && opened.size <= 512 * 1024 * 1024, 'bounded unchanged opened file required');
    const raw = fs.readFileSync(fd), after = fs.fstatSync(fd);
    requireValue(after.size === opened.size && after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs, 'original file changed during read');
    return {descriptor: {path: path.resolve(file), bytes: raw.length, sha256: sha(raw), dev: after.dev, ino: after.ino}, raw};
  } finally {fs.closeSync(fd);}
}
function pinFile(file) {return readStable(file).descriptor;}
function readPinned(row, preserveIdentity = false) {
  requireValue(row && path.isAbsolute(row.path ?? '') && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && /^[a-f0-9]{64}$/.test(row.sha256 ?? ''), 'complete original pin required');
  const {descriptor: actual, raw} = readStable(row.path);
  requireValue(samePin(actual, row) && (!preserveIdentity || (actual.dev === row.dev && actual.ino === row.ino)), 'original pin/identity mismatch: ' + row.path);
  return {descriptor: actual, value: null, raw};
}
function pinnedJSON(row, preserveIdentity = false) {const input = readPinned(row, preserveIdentity); input.value = JSON.parse(input.raw); return input;}
function writeJSON(output, name, value) {const file = path.join(output, name); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600}); return pinFile(file);}

export function validateObserverHandoff(h) {
  requireValue(h?.schema === 'YNX-ORIGINAL-A-SINGLE49-OBSERVER-RACE-FIRSTCAUSE/v1' &&
    h.state === 'NORMAL_PRODUCER_INTERRUPTED_BY_OWN_OBSERVER_GO_TMP_ENOENT_NOT_PRODUCT_FAILURE' &&
    h.normalProducerActualExit === -15 && h.normalReceiptAbsent === true && h.buildCommandLogAbsent === true &&
    h.archiveQualificationNotClaimed === true && h.inputPOSTAllExact === true &&
    h.terminal?.remainingOwned?.length === 0 && h.terminal.mutexReleased === true,
  'the exact quiesced interrupted producer is required; original Go exit remains UNKNOWN');
  requireValue(samePin(h.partialArchive, archivePin) && samePin(h.partialHeader, generatedPin) &&
    path.basename(h.partialArchive.path) === 'libynx_artifact_release.a' && path.basename(h.partialHeader.path) === 'libynx_artifact_release.h' &&
    path.dirname(h.partialArchive.path) === path.dirname(h.partialHeader.path), 'the exact retained archive/header pair is required');
  return path.dirname(h.partialArchive.path);
}

export function parseOriginalProducerArgs(argv) {
  requireValue(Array.isArray(argv) && argv.length === 20 && argv[1]?.endsWith('/cmd/ynx-secure-link-private-client/build-combined.mjs'), 'original nine-pair producer argv required');
  const options = new Map();
  for (let i = 2; i < argv.length; i += 2) {requireValue(typeof argv[i + 1] === 'string' && !options.has(argv[i]), 'unique original argument required'); options.set(argv[i], argv[i + 1]);}
  exact([...options.keys()], ['--core-handoff', '--core-sha256', '--auth-headers', '--auth-headers-sha256', '--native-undefined', '--native-undefined-sha256',
    '--link-commit', '--macos-deployment-target', '--out'], 'original producer arguments');
  requireValue(options.get('--link-commit') === CORE19_C2_BINDING.linkCommit && options.get('--macos-deployment-target') === '13.0', 'fixed LINK C2/macOS13 original arguments required');
  for (const [key, pin] of [['--core-sha256', CORE19_C2_BINDING.inputs.source], ['--auth-headers-sha256', CORE19_C2_BINDING.inputs.authHeaders],
    ['--native-undefined-sha256', CORE19_C2_BINDING.inputs.nativeUndefined]]) requireValue(options.get(key) === pin.sha256, 'fixed original input SHA required: ' + key);
  for (const key of ['--core-handoff', '--auth-headers', '--native-undefined', '--out']) requireValue(path.isAbsolute(options.get(key)), 'absolute original input/output required');
  return Object.fromEntries(options);
}

/** Stable source/include inventories only; never scan transient go-tmp/cache. */
export function verifyFileInventory(root, rows, {checkGitBlob = false} = {}) {
  requireValue(fs.realpathSync(root) === root && fs.lstatSync(root).isDirectory(), 'original inventory directory required');
  const byPath = new Map();
  for (const row of rows) {
    const name = row.repositoryPath;
    requireValue(typeof name === 'string' && name !== '' && !path.isAbsolute(name) && !name.includes('\\') && !name.includes('\0') &&
      name.split('/').every(part => part !== '' && part !== '.' && part !== '..') && !byPath.has(name), 'canonical unique inventory path required');
    byPath.set(name, row);
  }
  const names = [];
  function walk(folder, prefix = '') {
    for (const name of fs.readdirSync(folder)) {
      const file = path.join(folder, name), relative = prefix + name, stat = fs.lstatSync(file);
      requireValue(stat.uid === process.getuid() && !stat.isSymbolicLink(), 'owned nonsymlink inventory entry required: ' + relative);
      if (stat.isDirectory()) walk(file, relative + '/');
      else {requireValue(stat.isFile(), 'regular inventory leaf required: ' + relative); names.push(relative);}
    }
  }
  walk(root); exact(names, [...byPath.keys()], 'retained inventory');
  return names.sort().map(name => {
    const expected = byPath.get(name), {descriptor: actual, raw: bytes} = readStable(path.join(root, name));
    requireValue(samePin(actual, expected) && (!checkGitBlob || gitBlob(bytes) === expected.gitBlob), 'retained original bytes/Git mismatch: ' + name);
    return {...actual, repositoryPath: name};
  });
}

export function verifyGeneratedCoreHeader(text, expectedSymbols) {
  const names = [...text.matchAll(/^extern\s+int32_t\s+(YNX[A-Za-z0-9_]+)\s*\(/gm)].map(row => row[1]);
  exact(names, expectedSymbols, 'retained generated Core declarations');
  return {coreDeclarations: names.length, additionalGoExportsClaimed: false};
}

export function createOwnedSuffixOutput(out, forbiddenRoots) {
  requireValue(typeof out === 'string' && path.isAbsolute(out) && path.resolve(out) === out &&
    forbiddenRoots.every(root => !inside(root, out) && !inside(out, root)), 'canonical disjoint new output required');
  // Validate parent before the first mutation; refusing a symlink only after
  // mkdir would already have changed an old source/output directory.
  const parent = path.dirname(out), parentStat = fs.lstatSync(parent);
  requireValue(parentStat.isDirectory() && parentStat.uid === process.getuid() && fs.realpathSync(parent) === parent,
    'owned existing nonsymlink output parent required before mkdir');
  fs.mkdirSync(out, {mode: 0o700});
  const identity = fs.lstatSync(out);
  requireValue(identity.uid === process.getuid() && fs.realpathSync(out) === out, 'owned new suffix output required');
  return identity;
}

export function verifyNewGoEnvironment(actual, original, plan) {
  for (const key of ['GOVERSION', 'GOOS', 'GOARCH', 'CC', 'CXX', 'CGO_ENABLED', 'GOWORK', 'GOFLAGS', 'GOCACHE', 'GOMODCACHE'])
    requireValue(actual[key] === original[key], 'new actual Go probe differs from original: ' + key);
  for (const key of ['CGO_CFLAGS', 'CGO_CPPFLAGS', 'CGO_CXXFLAGS', 'CGO_LDFLAGS'])
    requireValue(typeof actual[key] === 'string' && actual[key].replaceAll('"', '') === plan.env[key].replaceAll('"', ''), 'new actual Go flag differs: ' + key);
  requireValue(actual.GOTOOLCHAIN === 'local' && actual.GOROOT === plan.env.GOROOT, 'new continuation must match selected cached GOROOT and prevent toolchain download');
  return {actualGoProbeMatchedOriginal: true, GOTOOLCHAIN: 'local', originalGOTOOLCHAINClaimed: false};
}

export function extractOriginalSDK(flags) {
  const match = flags?.match(/(?:^|\s)"?-isysroot"?\s+(?:"([^"]+)"|'([^']+)'|(\S+))$/);
  const sdk = match?.[1] ?? match?.[2] ?? match?.[3];
  requireValue(typeof sdk === 'string' && path.isAbsolute(sdk), 'original captured SDK path required'); return sdk;
}
export function validateContinuationMode(continuation, timeoutMs) {
  requireValue(typeof continuation === 'boolean' && (continuation
    ? Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 300000 : timeoutMs === undefined),
  'continuation requires explicit bounded Go timeout (1..300000ms); inspection never executes Go');
}
export function continuationReceiptState(actualGo, gatesPassed) {
  return actualGo?.exit === 0 && actualGo.signal === null && actualGo.error === null && gatesPassed === true
    ? 'COMBINED_CORE_LINK_ARCHIVE_VERIFIED_NOT_DEPLOYED' : 'FAILED_OUTPUT_RETAINED';
}
function goQuote(argument) {requireValue(!argument.includes('"'), 'unquoted original build path required'); return '"' + argument + '"';}
export function selectOriginalGoToolchain(original) {
  requireValue(original?.GOVERSION === 'go1.26.10' && original.GOOS === 'darwin' && original.GOARCH === 'arm64' &&
    typeof original.GOMODCACHE === 'string' && path.isAbsolute(original.GOMODCACHE) && path.resolve(original.GOMODCACHE) === original.GOMODCACHE,
  'exact original cached Go1.26.10/darwin/arm64 module selection required');
  const root = path.join(original.GOMODCACHE, 'golang.org', 'toolchain@v0.0.1-' + original.GOVERSION + '.' + original.GOOS + '-' + original.GOARCH);
  return {root, command: path.join(root, 'bin', 'go'), versionFile: path.join(root, 'VERSION'),
    executablePin: ORIGINAL_GO_TOOLCHAIN_PINS.executable, versionPin: ORIGINAL_GO_TOOLCHAIN_PINS.version};
}
export function qualifyOriginalGoToolchain(selection, observed) {
  requireValue(observed.rootRealPath === selection.root && observed.executable.path === selection.command &&
    observed.version.path === selection.versionFile && samePin(observed.executable, selection.executablePin) &&
    samePin(observed.version, selection.versionPin) && observed.uid === process.getuid() && observed.versionUID === process.getuid() &&
    observed.regular === true && observed.versionRegular === true && (observed.mode & 0o100) !== 0 &&
    observed.versionText.split('\n')[0] === 'go1.26.10', 'actual owned executable/VERSION/cache root pin mismatch');
  return {root: selection.root, command: selection.command, executable: observed.executable, version: observed.version,
    versionFirstLine: 'go1.26.10', downloaded: false};
}

export function makeIncrementalGoPlan({originalOutput, output, originalEnv, preEnv, sdk}) {
  requireValue(path.isAbsolute(originalOutput) && path.isAbsolute(output) && path.resolve(originalOutput) === originalOutput && path.resolve(output) === output &&
    !inside(originalOutput, output) && !inside(output, originalOutput), 'canonical new exclusive incremental output required');
  requireValue(originalEnv.GOVERSION === 'go1.26.10' && originalEnv.GOOS === 'darwin' && originalEnv.GOARCH === 'arm64' && originalEnv.CGO_ENABLED === '1' &&
    originalEnv.GOWORK === 'off' && originalEnv.GOFLAGS === '' && originalEnv.GOCACHE === path.join(originalOutput, 'go-cache') &&
    [originalEnv.CC, originalEnv.CXX, originalEnv.GOMODCACHE, sdk].every(name => typeof name === 'string' && path.isAbsolute(name)), 'same pinned original Go/CC/cache environment required');
  const target = ['-mmacosx-version-min=13.0', '-isysroot', sdk].map(goQuote).join(' ');
  const flags = {CGO_CFLAGS: goQuote('-I' + path.join(originalOutput, 'include')) + ' ' + target,
    CGO_CPPFLAGS: '', CGO_CXXFLAGS: '-O2 -g ' + target, CGO_LDFLAGS: '-O2 -g ' + target};
  // go env prints parsed flags without unnecessary quotes. Require logical
  // equality to the immutable capture, then restore the original recipe flags.
  for (const key of Object.keys(flags)) requireValue(originalEnv[key] === flags[key] || originalEnv[key] === flags[key].replaceAll('"', ''), 'original deployment/cgo flag mismatch: ' + key);
  requireValue(preEnv && typeof preEnv.PATH === 'string' && path.isAbsolute(preEnv.PKG_CONFIG_PATH ?? '') && preEnv.PKG_CONFIG_LIBDIR === preEnv.PKG_CONFIG_PATH,
    'original normal OpenSSL pkg-config selection required');
  const selectedToolchain = selectOriginalGoToolchain(originalEnv);
  return {state: 'PLAN_ONLY_NOT_EXECUTED_REQUIRES_ORIGINAL_A_NEW_ONCE_BUDGET', command: selectedToolchain.command, selectedToolchain,
    args: ['build', '-x', '-work', '-mod=readonly', '-p', '1', '-trimpath', '-tags=' + tags, '-buildmode=c-archive', '-o',
      path.join(output, 'incremental-archive', 'libynx_artifact_release.a'), './' + commandPackage],
    cwd: path.join(originalOutput, 'source'), env: {...preEnv, ...flags, CC: originalEnv.CC, CXX: originalEnv.CXX, CGO_ENABLED: '1',
      GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB', GOWORK: 'off', GOFLAGS: '', GOTOOLCHAIN: 'local', GOROOT: selectedToolchain.root, GOOS: 'darwin', GOARCH: 'arm64',
      GOCACHE: originalEnv.GOCACHE, GOMODCACHE: originalEnv.GOMODCACHE, GOTMPDIR: path.join(output, 'incremental-go-tmp'),
      TMPDIR: path.join(output, 'incremental-native-tmp'), SDKROOT: sdk, MACOSX_DEPLOYMENT_TARGET: '13.0'},
    mkdirExclusive: ['incremental-archive', 'incremental-go-tmp', 'incremental-native-tmp'].map(name => path.join(output, name)),
    stdout: path.join(output, 'incremental-go.stdout.log'), stderr: path.join(output, 'incremental-go.stderr.log'),
    captureRealExitRequired: true, cacheHitAssumed: false, recompilationAssumed: false, retainedArtifactsSourceAndHeadersMayBeWritten: false, originalGoCacheMayBeWritten: true,
    note: 'One command on the same source/cache. -x/-work records actual cache/link/compiler work; no -a/cache clean, cold source tree, parallel archive, or claimed exit0.'};
}

export function verifyPriorStaticReadback(prior, current) {
  requireValue(samePin(prior.handoff.descriptor, PRIOR_SUFFIX_PIN), 'fixed original A prior suffix H required');
  const h = prior.handoff.value, r = prior.retained.value;
  requireValue(h.schema === 'YNX-ORIGINAL-A-RETAINED49-LOCAL-GO-PROBE-FIRSTCAUSE/v1' &&
    h.state === 'FAILED_BEFORE_NEW_GO_BUILD_PROBE_GOVERSION_MISMATCH' && h.actualGoBuildInvocations === 0 &&
    h.originalGoExit === 'UNKNOWN' && h.normalReaderExit === 1 && samePin(h.originalArchive, current.archive) &&
    samePin(h.originalHeader, current.generatedHeader), 'same retained artifact/header and zero-build prior failure required');
  requireValue(r.schema === 'YNX-RETAINED-COMBINED49-SUFFIX-READBACK/v1' && r.originalGoExit === 'UNKNOWN' &&
    r.goBuildInvocations === 0 && r.incrementalGoExecuted === false && samePin(r.archive, current.archive) &&
    samePin(r.generatedHeader, current.generatedHeader) && samePin(r.originalObserver, RETAINED_OBSERVER_PIN) &&
    r.intake?.profile === current.selected.id, 'same fixed profile prior readback required');
  for (const key of Object.keys(CORE19_C2_BINDING.inputs)) requireValue(
    samePin(r.intake.originalPinnedInputs?.[key], current.inputs[key].descriptor) &&
    r.intake.originalPinnedInputs[key].path === current.inputs[key].descriptor.path, 'same seven-input prior binding required: ' + key);
  for (const [oldRows, currentRows, label] of [[r.source, current.sourceRows, 'source'], [r.headers, current.headers, 'headers']]) {
    exact(oldRows?.map(row => row.repositoryPath), currentRows.map(row => row.repositoryPath), 'prior ' + label);
    for (const row of currentRows) {const old = oldRows.find(old => old.repositoryPath === row.repositoryPath);
      requireValue(old.path === row.path && samePin(old, row), 'current original ' + label + ' differs from prior');}
  }
  requireValue(current.sourceRows.length === 1623 && current.headers.length === 23, 'full current source/header binding required before report reuse');
  for (const key of ['symbols', 'neutralC', 'deployment']) requireValue(
    JSON.stringify(prior.reports[key].value) === JSON.stringify(h.observedStaticReadbackOnly?.[key]) &&
    JSON.stringify(prior.reports[key].value) === JSON.stringify(r[key]), 'fixed prior static report mismatch: ' + key);
  const symbols = prior.reports.symbols.value, neutralC = prior.reports.neutralC.value, deployment = prior.reports.deployment.value;
  verifyCombinedSupplyResult(current.selected, symbols);
  requireValue(symbols.status === 'COMBINED_GO_ARCHIVE_STRONG_SYMBOLS_VERIFIED' && symbols.goArchives?.length === 1 &&
    samePin(symbols.goArchives[0], current.archive), 'same old archive strong/single-Go evidence required');
  exact(neutralC?.map(row => row.symbol), CORE19_C2_BINDING.neutralCSymbols, 'prior ten neutral C symbols');
  requireValue(neutralC.every(row => row.type === 'T') && deployment.status === 'ARCHIVE_DEPLOYMENT_TARGET_VERIFIED' &&
    samePin(deployment.archive, current.archive) && deployment.target === '13.0' && deployment.architecture === 'arm64' &&
    deployment.objectCount === 42 && deployment.verifiedObjects === 42 && deployment.rejectedObjects === 0 && deployment.unverifiableObjects === 0,
    'same actual min13/42-object evidence required');
  return {symbols, neutralC, deployment, provenance: {source: prior.handoff.descriptor,
    retainedReceipt: prior.retained.descriptor, reports: Object.fromEntries(Object.entries(prior.reports).map(([key, input]) => [key, input.descriptor])),
    priorGoExit: 'UNKNOWN', priorBuildInvocations: 0, priorSourcePostVerified: r.sourcePostVerified === true,
    currentSourceHeadersAndInputsVerifiedBeforeReuse: true, originalArtifactBytesIdentical: true, newNmOrDeploymentRun: false}};
}

export function runRetainedSuffix({observerHandoff, observerSHA256, output, continuation = false, goTimeoutMs, priorSuffixHandoff, priorSuffixSHA256}) {
  validateContinuationMode(continuation, goTimeoutMs);
  requireValue((priorSuffixHandoff === undefined && priorSuffixSHA256 === undefined) ||
    (path.isAbsolute(priorSuffixHandoff ?? '') && priorSuffixSHA256 === PRIOR_SUFFIX_PIN.sha256), 'only fixed prior suffix H reuse is accepted');
  requireValue(process.platform === 'darwin' && process.arch === 'arm64', 'the original native Darwin arm64 inspection host is required');
  requireValue(observerSHA256 === RETAINED_OBSERVER_PIN.sha256, 'the exact observer first-cause H is required');
  const observer = pinnedJSON({path: path.resolve(observerHandoff), ...RETAINED_OBSERVER_PIN});
  requireValue(path.isAbsolute(output) && path.resolve(output) === output, 'canonical absolute new suffix output required');
  const originalOutput = validateObserverHandoff(observer.value), out = path.resolve(output);
  requireValue(!inside(originalOutput, out) && !inside(out, originalOutput) && !inside(repository, out), 'new external suffix directory must not overlap original output or source checkout');
  const rootStat = fs.lstatSync(originalOutput);
  requireValue(rootStat.isDirectory() && rootStat.uid === process.getuid() && fs.realpathSync(originalOutput) === originalOutput, 'original output ownership required');
  // Neither an old partial receipt nor an old build log is replaced or invented.
  for (const name of ['BUILD-RECEIPT.json', 'combined-build.log']) requireValue(!fs.existsSync(path.join(originalOutput, name)), 'first-cause absent original record changed: ' + name);
  const outIdentity = createOwnedSuffixOutput(out, [originalOutput, repository]);
  const inputsRead = [observer], commands = [];
  let failure, intake, symbols, neutralC, deployment, incrementalPlan, sourceRows, headers, generatedHeader, archive;
  let continuedArchive, continuedGenerated, continuedSymbols, continuedNeutral, continuedDeployment, actualGo, continuationPassed = false;
  let normalizationProvenance, selectedProfile, originalInputs, continuedEnvironment, toolchain, sourcePostVerified = false;
  let priorReadbackReuse, continuationReportReuse;
  const run = (exe, args, name, cwd = repository, env = process.env, timeout = 60000) => {
    const started = new Date().toISOString(), stdout = path.join(out, name + '.stdout'), stderr = path.join(out, name + '.stderr');
    // Open durable log destinations before starting the child. A second outer
    // interruption can leave -x/-work prefixes, never another absent log.
    writeJSON(out, name + '.intent.json', {command: exe, args, cwd, timeoutMs: timeout, startedUTC: started, once: true});
    const stdoutFD = fs.openSync(stdout, 'wx', 0o600), stderrFD = fs.openSync(stderr, 'wx', 0o600);
    let r;
    try {r = spawnSync(exe, args, {cwd, env, stdio: ['ignore', stdoutFD, stderrFD], timeout});}
    finally {fs.closeSync(stdoutFD); fs.closeSync(stderrFD);}
    const capturedOut = readStable(stdout), capturedError = readStable(stderr);
    const command = {command: exe, args, cwd, exit: r.status, signal: r.signal, pid: r.pid, timeoutMs: timeout, startedUTC: started,
      finishedUTC: new Date().toISOString(), error: r.error ? {code: r.error.code ?? null, message: r.error.message} : null,
      stdout: capturedOut.descriptor, stderr: capturedError.descriptor};
    commands.push(command);
    if (exe === incrementalPlan?.command && args[0] === 'build') actualGo = command;
    requireValue(!r.error && r.status === 0, 'command failed: ' + exe + (r.error ? ' ' + r.error.code + ': ' + r.error.message : ' exit=' + r.status + ' signal=' + r.signal));
    requireValue(command.stdout.bytes <= (64 << 20), 'bounded command stdout required');
    return capturedOut.raw.toString('utf8');
  };
  const remember = input => {inputsRead.push(input); return input;};
  try {
    const refs = new Map();
    for (const row of observer.value.refs) {requireValue(!refs.has(row.path), 'unique observer ref required'); refs.set(row.path, remember(readPinned(row, true)));}
    const ref = (base, json = false) => {
      const matches = [...refs.values()].filter(row => path.basename(row.descriptor.path) === base);
      requireValue(matches.length === 1, 'one original observer reference required: ' + base);
      if (json) matches[0].value = JSON.parse(matches[0].raw); return matches[0];
    };
    const pre = ref('PRE.json', true), intent = ref('NORMAL_SINGLE_GO49_ARCHIVE.intent.json', true);
    const options = parseOriginalProducerArgs(pre.value.argv);
    requireValue(JSON.stringify(intent.value.argv) === JSON.stringify(pre.value.argv) && options['--out'] === originalOutput &&
      intent.value.cwd === repository, 'original PRE/intent/source/output mismatch');
    for (const row of pre.value.pins) remember(readPinned(row));
    for (const name of ['build-combined.mjs', 'combined-supply-profile.mjs', 'combined-archive-symbols.mjs', 'combined-archive-deployment.mjs'])
      requireValue(pre.value.pins.some(row => row.path === path.join(directory, name)), 'original frozen verifier pin required: ' + name);
    const bundle = path.dirname(options['--core-handoff']);
    const b = CORE19_C2_BINDING;
    const inputs = Object.fromEntries([['source', options['--core-handoff']], ['composition', path.join(bundle, 'COMPOSITION.json')],
      ['fork', path.join(bundle, 'FORK-CONTEXT.json')], ['supplier', path.join(bundle, 'SUPPLIER-CONTRACT.json')], ['handoff', path.join(bundle, 'HANDOFF.json')],
      ['authHeaders', options['--auth-headers']], ['nativeUndefined', options['--native-undefined']]].map(([key, file]) =>
        [key, remember(pinnedJSON({path: file, ...b.inputs[key]}))]));
    const selected = selectCoreSupplyProfile(inputs.source.value), normalizedResult = normalizeCoreSupply(inputs.source.value), normalized = normalizedResult.supply;
    selectedProfile = selected; normalizationProvenance = normalizedResult.provenance; originalInputs = inputs;
    const linkNames = run('git', ['ls-tree', '-r', '--name-only', b.linkCommit, '--', 'internal/securelink'], 'link-paths').trim().split('\n');
    const linkPaths = [...linkNames, 'cmd/ynx-secure-link-caller/private_client_v1.h', 'cmd/ynx-secure-link-caller/private_client_startup_v1.h'];
    const linkTree = run('git', ['rev-parse', b.linkCommit + '^{tree}'], 'link-tree').trim();
    const composition = verifyCore19C2Recipe(selected, inputs, {linkCommit: b.linkCommit, linkTree, linkPaths});
    requireValue(run('git', ['rev-parse', b.commit + '^{tree}'], 'core-tree').trim() === b.tree &&
      run('git', ['rev-parse', b.commit + ':third_party/cometbft'], 'fork-tree').trim() === b.forkTree, 'actual original Core/fork trees required');
    const expected = [...new Map([...inputs.composition.value.normalProducerSources, ...inputs.fork.value.files].map(row => [row.repositoryPath, row])).values()];
    sourceRows = verifyFileInventory(path.join(originalOutput, 'source'), expected, {checkGitBlob: true});
    const byPath = new Map(sourceRows.map(row => [row.repositoryPath, row]));
    const coreBytes = new Map(normalized.sources.map(row => [row.path, fs.readFileSync(byPath.get(row.path).path)]));
    const descriptorBytes = new Map(normalized.moduleContext.descriptors.map(row => [row.repositoryPath, fs.readFileSync(byPath.get(row.repositoryPath).path)]));
    const coreSource = verifyCoreSupplyBytes(inputs.source.value, selected, coreBytes, descriptorBytes);
    const sourceHeaders = [...selected.headers.map(name => ({...byPath.get(name), repositoryPath: path.basename(name), owner: 'core'})),
      ...['private_client_v1.h', 'private_client_startup_v1.h'].map(name => ({...byPath.get('cmd/ynx-secure-link-caller/' + name), repositoryPath: name, owner: 'link'})),
      ...inputs.authHeaders.value.headers.map(row => ({...row, repositoryPath: row.name, owner: row.name === 'product_pay_transport_private.h' ? 'product' : 'auth'}))];
    for (const row of inputs.authHeaders.value.headers) remember(readPinned(row));
    headers = verifyFileInventory(path.join(originalOutput, 'include'), sourceHeaders).map(row => ({...row,
      name: row.repositoryPath, owner: sourceHeaders.find(expectedRow => expectedRow.repositoryPath === row.repositoryPath).owner}));
    requireValue(sourceRows.length === 1623 && headers.length === 23, 'complete original source/include closure required');
    const goPackages = ref('go-packages.json'), goEnv = ref('go-environment.json', true);
    requireValue(goPackages.descriptor.path === path.join(originalOutput, 'go-packages.json') && goEnv.descriptor.path === path.join(originalOutput, 'go-environment.json'), 'same original output captures required');
    const dependencyClosure = verifyCoreCommandDependencyClosure(selected, goPackages.raw.toString('utf8'));
    const archiveInput = remember(readPinned(observer.value.partialArchive, true)); archive = archiveInput.descriptor;
    const generated = remember(readPinned(observer.value.partialHeader, true)); generatedHeader = {
      ...generated.descriptor, ...verifyGeneratedCoreHeader(generated.raw.toString('utf8'), selected.symbols)};
    // Verify the pinned installed normal OpenSSL headers/libraries too. This
    // reads public compilation assets only, never certificates/private keys.
    const sslPin = pre.value.pins.filter(row => path.basename(row.path) === 'HANDOFF.json' && row.sha256 === '1fc1e311117747e3ef76f436b9b6d5813aa603b9760e054ae98c3762d4d4d3e4');
    requireValue(sslPin.length === 1, 'original normal OpenSSL header H required');
    const ssl = remember(pinnedJSON(sslPin[0]));
    requireValue(ssl.value.headerCount === 142 && ssl.value.headers?.length === 142, '142 original normal OpenSSL headers required');
    for (const row of ssl.value.headers) {remember(readPinned(row.source)); remember(readPinned(row.frozen));}
    for (const row of ssl.value.originalQualifiedLibraries) remember(readPinned(row));
    const plan = {version: 1, goArchives: [archive],
      coreSources: sourceRows.filter(row => selected.sourcePaths.includes(row.repositoryPath) && row.repositoryPath.startsWith(commandPackage + '/') && row.repositoryPath.endsWith('.go')),
      headers: headers.filter(row => ['core', 'link', 'product'].includes(row.owner)), nativeUndefined: [inputs.nativeUndefined.descriptor], linkerInputs: [archive]};
    writeJSON(out, 'SYMBOL-PLAN.json', plan);
    if (priorSuffixHandoff) {
      const handoff = remember(pinnedJSON({path: priorSuffixHandoff, ...PRIOR_SUFFIX_PIN}));
      const retained = remember(pinnedJSON(handoff.value.retainedReadbackReceipt));
      const reports = Object.fromEntries([['symbols', 'SYMBOL-RESULT.json'], ['neutralC', 'NEUTRAL-C-RESULT.json'], ['deployment', 'DEPLOYMENT-RESULT.json']].map(([key, name]) => {
        const rows = handoff.value.refs.filter(row => path.basename(row.path) === name && path.dirname(row.path) === path.dirname(retained.descriptor.path));
        requireValue(rows.length === 1, 'one fixed prior static report required: ' + key); return [key, remember(pinnedJSON(rows[0]))];
      }));
      const reused = verifyPriorStaticReadback({handoff, retained, reports}, {archive, generatedHeader, selected, inputs, sourceRows, headers});
      ({symbols, neutralC, deployment} = reused); priorReadbackReuse = reused.provenance;
      writeJSON(out, 'PRIOR-STATIC-READBACK-REUSE.json', priorReadbackReuse);
    } else {
      symbols = checkCombinedArchive(plan); verifyCombinedSupplyResult(selected, symbols);
      neutralC = verifyCore19C2NeutralSymbols(selected, run('/usr/bin/nm', ['-g', archive.path], 'neutral-c-global', out), run('/usr/bin/nm', ['-m', archive.path], 'neutral-c-macho', out));
      try {deployment = checkArchiveDeployment(archive, {target: '13.0', architecture: 'arm64'});}
      catch (error) {deployment = error.report ?? null; throw error;}
    }
    writeJSON(out, 'SYMBOL-RESULT.json', symbols); writeJSON(out, 'NEUTRAL-C-RESULT.json', neutralC);
    const sdk = extractOriginalSDK(goEnv.value.CGO_CFLAGS);
    incrementalPlan = makeIncrementalGoPlan({originalOutput, output: out, originalEnv: goEnv.value, preEnv: pre.value.envOverrides, sdk});
    writeJSON(out, 'INCREMENTAL-GO-PLAN-NOT-EXECUTED.json', incrementalPlan);
    intake = {profile: selected.id, composition, coreSource, sourceFiles: sourceRows.length, handHeaders: headers.length,
      generatedHeader, dependencyClosure, normalOpenSSLHeaderCount: 142, originalPinnedInputs: Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.descriptor]))};
    for (const row of [...sourceRows, ...headers]) readPinned(row, true);
    for (const input of inputsRead) readPinned(input.descriptor, true);
    if (continuation) {
      // Explicit Root/A-only continuation. Exactly one new Go build; never a
      // retry or a claim about the interrupted command. Cache updates are real
      // writes under the old cache, while old source/artifacts stay immutable.
      for (const folder of incrementalPlan.mkdirExclusive) fs.mkdirSync(folder, {mode: 0o700});
      continuedEnvironment = incrementalPlan.env;
      const env = {...process.env, ...incrementalPlan.env}, selection = incrementalPlan.selectedToolchain;
      const executable = remember(readPinned({path: selection.command, ...selection.executablePin}));
      const version = remember(readPinned({path: selection.versionFile, ...selection.versionPin}));
      const executableStat = fs.lstatSync(selection.command), versionStat = fs.lstatSync(selection.versionFile);
      const selectedOriginalToolchain = qualifyOriginalGoToolchain(selection, {rootRealPath: fs.realpathSync(selection.root),
        executable: executable.descriptor, version: version.descriptor, uid: executableStat.uid, versionUID: versionStat.uid,
        mode: executableStat.mode, regular: executableStat.isFile() && !executableStat.isSymbolicLink(),
        versionRegular: versionStat.isFile() && !versionStat.isSymbolicLink(), versionText: version.raw.toString('utf8')});
      const goProbe = JSON.parse(run(incrementalPlan.command, ['env', '-json', 'GOVERSION', 'GOOS', 'GOARCH', 'CC', 'CXX', 'CGO_ENABLED', 'GOWORK', 'GOFLAGS',
        'GOCACHE', 'GOMODCACHE', 'CGO_CFLAGS', 'CGO_CPPFLAGS', 'CGO_CXXFLAGS', 'CGO_LDFLAGS', 'GOTOOLCHAIN', 'GOROOT'],
      'continuation-go-environment', incrementalPlan.cwd, env, Math.min(goTimeoutMs, 30000)));
      const probeQualification = verifyNewGoEnvironment(goProbe, goEnv.value, incrementalPlan);
      const compilerCapture = readStable(path.join(originalOutput, 'compiler-version.log')); remember(compilerCapture);
      const compilerVersion = run(goEnv.value.CC, ['--version'], 'continuation-compiler-version', incrementalPlan.cwd, env, Math.min(goTimeoutMs, 30000));
      requireValue(compilerVersion === compilerCapture.raw.toString('utf8'), 'new actual compiler differs from original capture');
      toolchain = {sdk, cc: {path: goEnv.value.CC, actualRealPath: fs.realpathSync(goEnv.value.CC)},
        cxx: {path: goEnv.value.CXX, actualRealPath: fs.realpathSync(goEnv.value.CXX)}, compilerVersion,
        opensslVersion: '3.6.4', originalGoEnvironment: goEnv.descriptor, actualNewGoVersionProbeRun: true,
        actualNewGoEnvironment: goProbe, probeQualification, selectedOriginalToolchain, explicitNewGOROOT: selection.root, originalCompilerVersionCapture: compilerCapture.descriptor};
      run(incrementalPlan.command, incrementalPlan.args, 'incremental-go', incrementalPlan.cwd, env, goTimeoutMs);
      const newArchivePath = incrementalPlan.args[incrementalPlan.args.indexOf('-o') + 1];
      continuedArchive = pinFile(newArchivePath);
      const newHeader = readStable(newArchivePath.replace(/\.a$/, '.h'));
      continuedGenerated = newHeader.descriptor;
      verifyGeneratedCoreHeader(newHeader.raw.toString('utf8'), selected.symbols);
      const continuedPlan = {...plan, goArchives: [continuedArchive], linkerInputs: [continuedArchive]};
      writeJSON(out, 'CONTINUATION-SYMBOL-PLAN.json', continuedPlan);
      if (samePin(continuedArchive, archive)) {
        continuationReportReuse = {reason: 'NEW_ARCHIVE_BYTES_IDENTICAL_TO_RETAINED_VERIFIED_ARCHIVE',
          retainedArchive: archive, newArchive: continuedArchive, priorReadbackReuse: priorReadbackReuse ?? null,
          freshRetainedReports: priorReadbackReuse ? null : ['SYMBOL-RESULT.json', 'NEUTRAL-C-RESULT.json', 'DEPLOYMENT-RESULT.json'],
          newNmOrDeploymentRun: false};
        continuedSymbols = {...symbols, goArchives: [continuedArchive], commands: [], byteIdentityEvidenceReuse: continuationReportReuse};
        continuedNeutral = neutralC;
        continuedDeployment = {...deployment, archive: continuedArchive, byteIdentityEvidenceReuse: continuationReportReuse};
        writeJSON(out, 'CONTINUATION-BYTE-IDENTITY-REUSE.json', continuationReportReuse);
      } else {
        continuedSymbols = checkCombinedArchive(continuedPlan); verifyCombinedSupplyResult(selected, continuedSymbols);
        continuedNeutral = verifyCore19C2NeutralSymbols(selected, run('/usr/bin/nm', ['-g', continuedArchive.path], 'continuation-neutral-global', out),
          run('/usr/bin/nm', ['-m', continuedArchive.path], 'continuation-neutral-macho', out));
        try {continuedDeployment = checkArchiveDeployment(continuedArchive, {target: '13.0', architecture: 'arm64'});}
        catch (error) {continuedDeployment = error.report ?? null; throw error;}
      }
      writeJSON(out, 'CONTINUATION-SYMBOL-RESULT.json', continuedSymbols);
      writeJSON(out, 'CONTINUATION-NEUTRAL-C-RESULT.json', continuedNeutral);
    }
    for (const row of [...sourceRows, ...headers]) readPinned(row, true);
    for (const input of inputsRead) readPinned(input.descriptor, true);
    // Re-enumerate stable inventories too; an injected extra source/header must
    // not be hidden by only revisiting the original row list after execution.
    verifyFileInventory(path.join(originalOutput, 'source'), expected, {checkGitBlob: true});
    verifyFileInventory(path.join(originalOutput, 'include'), sourceHeaders);
    if (continuation) {
      const selection = incrementalPlan.selectedToolchain, executableStat = fs.lstatSync(selection.command), versionStat = fs.lstatSync(selection.versionFile);
      const postExecutable = readPinned(toolchain.selectedOriginalToolchain.executable, true), postVersion = readPinned(toolchain.selectedOriginalToolchain.version, true);
      // Byte/identity pins were re-read above. Recheck executable mode and the
      // original real module root too, rather than treating SHA alone as live.
      qualifyOriginalGoToolchain(selection, {rootRealPath: fs.realpathSync(selection.root),
        executable: postExecutable.descriptor, version: postVersion.descriptor,
        uid: executableStat.uid, versionUID: versionStat.uid, mode: executableStat.mode,
        regular: executableStat.isFile() && !executableStat.isSymbolicLink(), versionRegular: versionStat.isFile() && !versionStat.isSymbolicLink(),
        versionText: postVersion.raw.toString('utf8')});
      toolchain.selectedOriginalToolchainPostValidated = true;
    }
    sourcePostVerified = true;
    if (continuation) {readPinned(continuedArchive, true); readPinned(continuedGenerated, true); continuationPassed = true;}
    for (const name of ['BUILD-RECEIPT.json', 'combined-build.log']) requireValue(!fs.existsSync(path.join(originalOutput, name)), 'original absent build record changed during readback');
    const after = fs.lstatSync(out); requireValue(after.uid === outIdentity.uid && after.dev === outIdentity.dev && after.ino === outIdentity.ino, 'suffix output ownership changed');
  } catch (error) {failure = error;}
  if (deployment) writeJSON(out, 'DEPLOYMENT-RESULT.json', deployment);
  const receipt = {schema: 'YNX-RETAINED-COMBINED49-SUFFIX-READBACK/v1',
    state: failure ? 'SUFFIX_FAILED_FIRSTCAUSE_PRESERVED' : 'RETAINED_BINARY_READBACK_VERIFIED_ORIGINAL_GO_EXIT_UNKNOWN',
    originalObserver: observer.descriptor, originalOutput, originalProducerExit: observer.value.normalProducerActualExit,
    originalGoExit: 'UNKNOWN', originalGoExitCode: null, originalGoBuildLogAvailable: false, originalNormalReceiptAvailable: false,
    normalBuildReceiptCompatible: false, notAReplacementForOriginalBuildReceipt: true,
    archive: archive ?? null, generatedHeader: generatedHeader ?? null, intake: intake ?? null,
    symbols: symbols ?? null, neutralC: neutralC ?? null, deployment: deployment ?? null,
    source: sourceRows ?? [], headers: headers ?? [], inputReadback: inputsRead.map(input => input.descriptor), commands,
    priorReadbackReuse: priorReadbackReuse ?? null, continuationReportReuse: continuationReportReuse ?? null,
    incrementalPlanAvailable: Boolean(incrementalPlan), incrementalGoExecuted: Boolean(actualGo), goBuildInvocations: actualGo ? 1 : 0,
    failure: failure ? {message: failure.message, stack: failure.stack} : null,
    originalOutputWritten: continuation && actualGo ? 'ORIGINAL_GOCACHE_UPDATES_POSSIBLE_ONLY' : false,
    originalGoCacheMayBeWritten: Boolean(continuation && actualGo), retainedArtifactsSourceAndHeadersWritten: false,
    sourcePostVerified, oldFailureSuppressed: false, normalNativeImageVerified: false,
    RootAdmission: false, SourceAdmission: false, installed: false, deployed: false};
  const result = writeJSON(out, 'RETAINED-SUFFIX-RECEIPT.json', receipt);
  let continuationReceipt;
  if (continuation) {
    if (continuedDeployment) writeJSON(out, 'CONTINUATION-DEPLOYMENT-RESULT.json', continuedDeployment);
    const state = continuationReceiptState(actualGo, continuationPassed && !failure);
    const normal = {version: 1, state, coreHandoff: originalInputs?.source.descriptor ?? null,
      authHeaders: originalInputs?.authHeaders.descriptor ?? null, nativeUndefined: originalInputs?.nativeUndefined.descriptor ?? null,
      coreSupplyProfile: selectedProfile ? {id: selectedProfile.id, commit: selectedProfile.commit, tree: selectedProfile.tree,
        coreExports: selectedProfile.coreExports, totalExports: selectedProfile.totalExports} : null,
      coreSourceVerification: intake?.coreSource ?? null, profileVerifier: pinFile(path.join(directory, 'combined-supply-profile.mjs')),
      preparedSourceInputs: intake?.originalPinnedInputs ?? null, preparedCompositionVerification: intake?.composition ?? null,
      neutralCReadback: continuedNeutral ?? null, coreSupplyNormalization: normalizationProvenance ?? null,
      coreCommandDependencyClosure: intake?.dependencyClosure ?? null,
      normalResourceBinder: intake?.dependencyClosure?.normalResourceBinder ?? 'NOT_VERIFIED',
      resourceBackendNormalReachabilityClaimed: intake?.dependencyClosure?.resourceConsentAlreadyImportedByCoreCommand === true,
      protectedAuthNativeFactoryQualified: false, coreCommit: CORE19_C2_BINDING.commit, linkCommit: CORE19_C2_BINDING.linkCommit,
      baseLINKCommit: '8df4139adb14c68d93e0a55a56851399d46059ac', soleMain: commandPackage + '/core.go',
      source: sourceRows ?? [], headers: [...(headers ?? []), ...(continuedGenerated ? [{...continuedGenerated, name: path.basename(continuedGenerated.path), owner: 'generated'}] : [])],
      commands, archive: continuedArchive ?? null, symbols: continuedSymbols ?? null, deployment: continuedDeployment ?? null,
      deploymentTarget: '13.0', buildEnvironment: continuedEnvironment ?? null, toolchain: toolchain ?? null,
      builder: pinFile(fileURLToPath(import.meta.url)), template: CORE19_C2_BINDING.template,
      goBuildInvocations: actualGo ? 1 : 0, failure: failure?.message ?? null,
      resumeProvenance: {observer: observer.descriptor, priorReadbackReuse: priorReadbackReuse ?? null, continuationReportReuse: continuationReportReuse ?? null, retainedSuffixReceipt: result, originalOutput,
        originalProducerExit: -15, originalGoExit: 'UNKNOWN', originalGoExitCode: null, originalRecordsRewritten: false,
        newGo: actualGo ?? null, newGoExit: actualGo?.exit ?? null, newGoSignal: actualGo?.signal ?? null,
        sameOriginalSource: true, sameOriginalGoCache: true, originalGoCacheMayBeWritten: Boolean(actualGo),
        originalSourceArtifactsAndHeadersWritten: false, sourceAndInputPostVerified: sourcePostVerified,
        actualCompileOrCacheHitEvidence: actualGo ? {stdout: actualGo.stdout, stderr: actualGo.stderr, flags: ['-x', '-work'], cacheHitNotAssumed: true} : null},
      sameNormalNativeImageLinked: false, actualMacOS13RuntimeTested: false, RootAdmission: false, SourceAdmission: false, installed: false, deployed: false};
    continuationReceipt = writeJSON(out, 'BUILD-RECEIPT.json', normal);
  }
  if (failure) {failure.receipt = continuationReceipt ?? result; throw failure;}
  return {receipt: continuationReceipt ?? result, retainedSuffix: result,
    state: continuation ? 'COMBINED_CORE_LINK_ARCHIVE_VERIFIED_NOT_DEPLOYED' : receipt.state,
    originalGoExit: 'UNKNOWN', newGoExit: actualGo?.exit ?? null, normalBuildReceiptCompatible: continuation};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = new Map(); let continuation = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--continue') {requireValue(!continuation, 'duplicate continuation flag'); continuation = true; continue;}
    requireValue(['--observer-handoff', '--observer-sha256', '--out', '--go-timeout-ms', '--prior-suffix-handoff', '--prior-suffix-sha256'].includes(key) &&
      !options.has(key) && args[i + 1] && !args[i + 1].startsWith('--'), 'closed unique suffix arguments required');
    options.set(key, args[++i]);
  }
  requireValue(['--observer-handoff', '--observer-sha256', '--out'].every(key => options.has(key)) &&
    (!options.has('--go-timeout-ms') || /^[1-9][0-9]*$/.test(options.get('--go-timeout-ms'))), 'complete original observer/new output and bounded explicit continuation required');
  console.log(JSON.stringify(runRetainedSuffix({observerHandoff: options.get('--observer-handoff'), observerSHA256: options.get('--observer-sha256'), output: options.get('--out'),
    continuation, goTimeoutMs: options.has('--go-timeout-ms') ? Number(options.get('--go-timeout-ms')) : undefined,
    priorSuffixHandoff: options.get('--prior-suffix-handoff'), priorSuffixSHA256: options.get('--prior-suffix-sha256')})));
}
