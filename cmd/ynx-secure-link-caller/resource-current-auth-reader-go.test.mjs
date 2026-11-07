// Explicit opt-in PUBLIC integration of the original frozen Auth Reader body
// with actual LINK held-client TUs and one pinned P09 Go/broker producer pair.
// This file builds no Go, substitutes no C mocks, and never treats RED as PASS.
//
// Required ENV (all paths absolute; owned roots are explicit, with no fallback):
// YNX_LINK_AUTH_READER_INPUTS / _INPUTS_BYTES / _INPUTS_SHA256,
// YNX_LINK_AUTH_READER_TEST_ARTIFACTS, YNX_LINK_AUTH_READER_GO_ROOT.
// Manifest v1: {version:1,authH:pin,authHeader:pin,driver:pin,go:pin,
// authBaseH:pin (required for the successor files[] schema),
// producerReceipts:[pin,...],cases:[{mode:'normal'|'chunked',
// control:'current'|'prewrite-denial'}]}.
// A pin is {path,bytes,sha256}. The original header's basename/bytes/SHA must
// match exactly one authH.sources[] or authH.files[] row; its runtime path may
// be an explicit mirror. Executables bind to the role-specific binary in the
// pinned YNX-LINK-AUTH-READER-CI-PRODUCER/v1 receipts, or the exact original
// P09-RESOURCE-CURRENT-DRIVER-R2 handoff. Thus CI
// can supply its actual build receipt rather than a developer-machine binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {constants} from 'node:fs';
import {open, lstat, mkdir, mkdtemp, chmod, realpath, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const source = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(source, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceLeaves = [
  'resource-current-auth-reader-go.test.mjs', 'resource-current-auth-reader-go-fixture-call.cpp',
  'resource-current-held-client.cpp', 'resource-current-held-identity.cpp', 'resource-current-peer.cpp',
  'resource-current-held-identity.hpp', 'resource-current-held-bound.hpp', 'resource-current-peer.hpp',
  'resource-current-json.hpp', 'resource-current-held-json.hpp', 'resource_current_client_v2.h',
  'resource_current_client_v1.h', 'private_client_v1.h', 'resource_current_auth_v2.h',
];
const originalProducerLeaf = {
  'original-go': ['apps/network/localipc/resource_current_link_fixture_test.go', '1ee45dcf7fda9f5f5e30aa0823b6098bcf737ebdb99cb0676a07ecba79de1468'],
  'original-driver': ['apps/network/localipc/testdata/resource_current_link_driver.mm', '3d28acd498d360c1dd64cabee22f34b5277e5afeb2d98825b5455dabd65d2b87'],
};
const errorRecord = error => error ? {name: error.name, message: error.message, code: error.code ?? null,
  syscall: error.syscall ?? null, signal: error.signal ?? null} : null;
const samePin = (a, b) => a.path === b.path && a.bytes === b.bytes && a.sha256 === b.sha256;
const sameContent = (a, b) => a.bytes === b.bytes && a.sha256 === b.sha256;
function absolute(value, label) {
  assert.ok(typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value &&
    !value.includes('\0'), `${label}: explicit normalized absolute path required`);
  return value;
}
function pinShape(row, label, maximum = 128 << 20) {
  absolute(row?.path, label);
  assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= maximum &&
    typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256), `${label}: bounded exact bytes/SHA256 required`);
  return {path: row.path, bytes: row.bytes, sha256: row.sha256};
}
function environmentPin(stem, maximum) {
  const bytes = process.env[stem + '_BYTES'];
  assert.match(bytes ?? '', /^[1-9][0-9]{0,9}$/, `${stem}_BYTES must be explicit canonical decimal`);
  return pinShape({path: process.env[stem], bytes: Number(bytes), sha256: process.env[stem + '_SHA256']}, stem, maximum);
}
async function originalBytes(filename, maximum = 128 << 20, allowEmpty = false) {
  absolute(filename, 'input');
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    assert.ok(before.isFile() && (before.size > 0 || allowEmpty) && before.size <= maximum, `bounded regular file required: ${filename}`);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      assert.ok(result.bytesRead > 0, `original input truncated: ${filename}`);
      offset += result.bytesRead;
    }
    const after = await file.stat(), current = await lstat(filename);
    assert.ok(!current.isSymbolicLink() && before.dev === current.dev && before.ino === current.ino &&
      before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
    `original input replaced or changed while read: ${filename}`);
    return bytes;
  } finally { await file.close(); }
}
async function pinned(row, label, maximum) {
  const expected = pinShape(row, label, maximum), bytes = await originalBytes(expected.path, maximum);
  assert.equal(bytes.length, expected.bytes, `${label}: byte length changed`);
  assert.equal(sha(bytes), expected.sha256, `${label}: SHA256 changed`);
  return {pin: expected, bytes};
}
function json(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch (error) { throw Error(`${label}: invalid JSON: ${error.message}`); }
}
async function ownedParent(value, label) {
  absolute(value, label);
  await mkdir(value, {recursive: true, mode: 0o700});
  const actual = await realpath(value), info = await lstat(value);
  assert.equal(actual, value, `${label}: symlink aliases are not an owned root`);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() &&
    (info.mode & 0o022) === 0, `${label}: caller-owned non-writable-by-others directory required`);
  return actual;
}
async function fresh(parent, prefix) {
  const directory = await mkdtemp(path.join(parent, prefix));await chmod(directory, 0o700);
  const info = await lstat(directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() &&
    (info.mode & 0o7777) === 0o700, 'new owned directory must be 0700');
  return directory;
}

test('explicit frozen Auth Reader consumes actual same-client held Go DATA and original cleanup ACKs',
  {timeout: 540000}, async t => {
    assert.equal(process.platform, 'darwin', 'this pinned original broker uses actual Darwin suspended spawn; no simulated or skipped Go leg');
    const artifactEnvironment = process.env.YNX_LINK_AUTH_READER_ARTIFACTS ?? process.env.YNX_LINK_AUTH_READER_TEST_ARTIFACTS;
    if (process.env.YNX_LINK_AUTH_READER_ARTIFACTS && process.env.YNX_LINK_AUTH_READER_TEST_ARTIFACTS)
      assert.equal(process.env.YNX_LINK_AUTH_READER_ARTIFACTS, process.env.YNX_LINK_AUTH_READER_TEST_ARTIFACTS, 'explicit artifact roots disagree');
    const owned = await fresh(await ownedParent(artifactEnvironment, 'YNX_LINK_AUTH_READER_ARTIFACTS'), 'a-');
    const temporary = path.join(owned, 'tmp');await mkdir(temporary, {mode: 0o700});
    t.diagnostic('Original Auth/LINK/Go evidence retained without deleting RED or UNKNOWN: ' + owned);
    const record = {version: 1, status: 'STARTED', owned, temporary, commands: [], cases: [], inputsBefore: [], inputsAfter: [],
      originalAuthReaderBody: false, realLINKTUs: false, actualGoExecuted: false, publicTransportSeam: true,
      actualTypedRoot: false, actualAuthFence: false, RootAdmission: false, SourceAdmission: false,
      GoBuiltHere: false, oldNativeOrCodecSuitesRun: false, installed: false, deployed: false};
    let firstError = null;
    const snapshots = new Map();
    async function remember(row, label, maximum) {
      const result = await pinned(row, label, maximum);
      const prior = snapshots.get(result.pin.path);
      if (prior) assert.ok(samePin(prior, result.pin), `inconsistent selected input pins: ${result.pin.path}`);
      else { snapshots.set(result.pin.path, result.pin);record.inputsBefore.push(result.pin); }
      return result;
    }
    async function run(label, command, args, timeout, selectedEnvironment = {}) {
      const boundedEnvironment = {TMPDIR: temporary, GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB', ...selectedEnvironment};
      const environment = {...process.env, ...boundedEnvironment};
      // The pinned broker supplies these only to its own spawned Go child.
      // An inherited PUBLIC fixture variable must not shadow its actual root.
      for (const key of ['YNX_PUBLIC_CURRENT_LINK_SERVER', 'YNX_PUBLIC_CURRENT_LINK_ROOT', 'YNX_PUBLIC_CURRENT_LINK_MODE']) delete environment[key];
      const result = spawnSync(command, args, {cwd: repository, env: environment, timeout, maxBuffer: 8 << 20});
      const prefix = path.join(owned, `${String(record.commands.length + 1).padStart(2, '0')}-${label}`);
      const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
      await writeFile(prefix + '.stdout', stdout, {flag: 'wx', mode: 0o600});
      await writeFile(prefix + '.stderr', stderr, {flag: 'wx', mode: 0o600});
      const details = {label, command, args, selectedEnvironment: boundedEnvironment, timeoutMs: timeout, status: result.status, signal: result.signal,
        error: errorRecord(result.error), stdout: {path: prefix + '.stdout', bytes: stdout.length, sha256: sha(stdout)},
        stderr: {path: prefix + '.stderr', bytes: stderr.length, sha256: sha(stderr)}};
      record.commands.push(details);
      await writeFile(prefix + '.json', JSON.stringify(details, null, 2) + '\n', {flag: 'wx', mode: 0o600});
      return {result, details, stdout, stderr};
    }
    async function preservedOutputs(directory) {
      const names = await readdir(directory);assert.ok(names.length <= 32, 'broker output collection bound exceeded');
      const files = [];
      for (const name of names.sort()) {
        const filename = path.join(directory, name), info = await lstat(filename);
        assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid() &&
          (info.mode & 0o077) === 0, `original broker output is not an owned private regular file: ${name}`);
        const bytes = await originalBytes(filename, 8 << 20, true);
        files.push({path: filename, bytes: bytes.length, sha256: sha(bytes)});
      }
      return files;
    }
    try {
      const manifestInput = await remember(environmentPin('YNX_LINK_AUTH_READER_INPUTS', 1 << 20), 'explicit input manifest', 1 << 20);
      const manifest = json(manifestInput.bytes, 'input manifest');
      assert.equal(manifest.version, 1, 'explicit manifest version 1 required');
      assert.ok(Array.isArray(manifest.cases) && manifest.cases.length >= 1 && manifest.cases.length <= 3,
        'one to three explicit original Reader cases required');
      const caseKeys = [];
      for (const row of manifest.cases) {
        assert.ok(row && JSON.stringify(Object.keys(row).sort()) === '["control","mode"]' &&
          ['normal', 'chunked'].includes(row.mode) && ['current', 'prewrite-denial'].includes(row.control) &&
          (row.control !== 'prewrite-denial' || row.mode === 'normal'), 'unsupported explicit Reader case');
        caseKeys.push(row.mode + '/' + row.control);
      }
      assert.equal(new Set(caseKeys).size, caseKeys.length, 'duplicate Reader case would rerun an original leg');
      assert.ok(Array.isArray(manifest.producerReceipts) && manifest.producerReceipts.length >= 1 && manifest.producerReceipts.length <= 2,
        'one original P09 handoff or two role-specific CI producer receipts required');
      const authInput = await remember(manifest.authH, 'original frozen Auth handoff', 8 << 20);
      const authH = json(authInput.bytes, 'Auth handoff');
      assert.notEqual(Array.isArray(authH.sources), Array.isArray(authH.files), 'Auth handoff must select exactly one original sources[] or files[] schema');
      const authRows = Array.isArray(authH.sources) ? authH.sources : authH.files;
      assert.ok(authRows.length >= 1 && authRows.length <= 512, 'bounded original Auth source rows required');
      const readerPin = pinShape(manifest.authHeader, 'original Auth Reader header', 1 << 20);
      assert.equal(path.basename(readerPin.path), 'NetworkPublisherReaderV2.hpp', 'original named Auth Reader required');
      const readerRows = authRows.filter(row => typeof row?.path === 'string' && path.basename(row.path) === 'NetworkPublisherReaderV2.hpp');
      assert.equal(readerRows.length, 1, 'Auth handoff must name one original Reader header');
      assert.ok(sameContent(readerRows[0], readerPin), 'Auth handoff does not bind the original Reader bytes/SHA256');
      await remember(readerPin, 'original Auth Reader header', 1 << 20);
      const authInclude = path.dirname(readerPin.path);
      assert.equal(await realpath(authInclude), authInclude, 'original frozen include directory must be explicit and canonical');
      let abiH = authH;
      if (Array.isArray(authH.files)) {
        const baseInput = await remember(manifest.authBaseH, 'original Auth ABI base handoff', 8 << 20);
        assert.ok(sameContent(authH.oldFrozen ?? {}, baseInput.pin), 'successor handoff does not bind the supplied original Auth ABI base');
        abiH = json(baseInput.bytes, 'original Auth ABI base handoff');
        record.authBaseH = baseInput.pin;
      }
      const abiRows = [...(Array.isArray(abiH.headers) ? abiH.headers : []),
        ...(Array.isArray(abiH.strongBridgeDependencies) ? abiH.strongBridgeDependencies : [])];
      assert.ok(abiRows.length > 0 && abiRows.length <= 128, 'original Auth ABI header pins required');
      const driverInput = await remember(manifest.driver, 'original P09 broker executable', 128 << 20);
      const goInput = await remember(manifest.go, 'original Go fixture executable', 128 << 20);
      const produced = new Map();record.producerBindings = [];
      for (const receipt of manifest.producerReceipts) {
        const input = await remember(receipt, 'original producer receipt', 8 << 20);
        const producer = json(input.bytes, 'producer receipt');
        if (producer.version === 'P09-RESOURCE-CURRENT-DRIVER-R2') {
          assert.equal(manifest.producerReceipts.length, 1, 'original P09 handoff cannot be mixed with CI producer schemas');
          const driver = pinShape(producer.binary, 'original P09 broker pin');
          const go = pinShape(producer.unchangedGoFixture, 'original P09 Go fixture pin');
          assert.equal(producer.invocation?.newBinary, driver.path, 'original P09 invocation does not bind its broker');
          produced.set('original-driver', driver);produced.set('original-go', go);
          record.producerBindings.push({receipt: input.pin, schema: producer.version, driver, go,
            buildExecutedHere: false, originalProducerHandoffOnly: true});
          continue;
        }
        assert.equal(producer.schema, 'YNX-LINK-AUTH-READER-CI-PRODUCER/v1', 'explicit original producer schema required');
        assert.equal(manifest.producerReceipts.length, 2, 'CI Go and driver require separate original producer receipts');
        assert.ok(['original-go', 'original-driver'].includes(producer.role) && !produced.has(producer.role), 'one producer per exact original role required');
        assert.match(producer.sourceCommit ?? '', /^[a-f0-9]{40}$/, 'producer source commit required');
        assert.match(producer.sourceTree ?? '', /^[a-f0-9]{40}$/, 'producer source tree required');
        assert.ok(Array.isArray(producer.sourceLeaves) && producer.sourceLeaves.length >= 1 && producer.sourceLeaves.length <= 512,
          'bounded producer-declared original source leaves required');
        for (const row of producer.sourceLeaves) pinShape(row, 'producer-declared source leaf', 8 << 20);
        const [originalLeaf, originalSHA] = originalProducerLeaf[producer.role];
        const originalRows = producer.sourceLeaves.filter(row => row.path.endsWith('/' + originalLeaf));
        assert.equal(originalRows.length, 1, 'producer must name its exact original P09 fixture/driver leaf');
        assert.equal(originalRows[0].sha256, originalSHA, 'original P09 fixture/driver source leaf changed');
        assert.equal(producer.commandResult?.status, 0, 'original producer build did not exit zero');
        assert.equal(producer.commandResult.signal, null, 'original producer build had a signal');
        assert.equal(producer.commandResult.error, null, 'original producer build had a process error');
        assert.ok(typeof producer.commandResult.command === 'string' && producer.commandResult.command.length > 0 &&
          Array.isArray(producer.commandResult.args) && producer.commandResult.args.length <= 256 &&
          producer.commandResult.args.every(arg => typeof arg === 'string'), 'original producer argv required');
        const binaryPin = pinShape(producer.binary, 'original producer binary');
        produced.set(producer.role, binaryPin);
        record.producerBindings.push({receipt: input.pin, role: producer.role, binary: binaryPin,
          sourceCommit: producer.sourceCommit, sourceTree: producer.sourceTree, sourceLeaves: producer.sourceLeaves,
          sourceLeavesAreProducerDeclarations: true});
      }
      const pair = record.producerBindings.filter(row => row.role);
      if (pair.length) {
        assert.equal(pair.length, 2, 'both original CI producer roles required');
        assert.equal(pair[0].sourceCommit, pair[1].sourceCommit, 'Go and broker producer source commits differ');
        assert.equal(pair[0].sourceTree, pair[1].sourceTree, 'Go and broker producer source trees differ');
      }
      assert.ok(sameContent(produced.get('original-driver'), driverInput.pin), 'original-driver producer does not bind the selected broker bytes/SHA');
      assert.ok(sameContent(produced.get('original-go'), goInput.pin), 'original-go producer does not bind the selected Go image bytes/SHA');
      for (const filename of [driverInput.pin.path, goInput.pin.path]) {
        const info = await lstat(filename);assert.ok((info.mode & 0o111) !== 0, `pinned executable has no executable bit: ${filename}`);
      }
      for (const leaf of sourceLeaves) {
        const filename = path.join(source, leaf), bytes = await originalBytes(filename, 2 << 20);
        await remember({path: filename, bytes: bytes.length, sha256: sha(bytes)}, 'selected LINK source ' + leaf, 2 << 20);
      }
      record.authABIBindings = [];
      for (const leaf of ['resource_current_client_v2.h', 'resource_current_client_v1.h', 'private_client_v1.h', 'resource_current_auth_v2.h']) {
        const declared = abiRows.filter(row => typeof row?.path === 'string' && path.basename(row.path) === leaf);
        assert.equal(declared.length, 1, `original Auth ABI must bind one ${leaf}`);
        const local = snapshots.get(path.join(source, leaf));
        assert.ok(sameContent(declared[0], local), `selected LINK ABI differs from original Auth base: ${leaf}`);
        record.authABIBindings.push({declared: declared[0], selected: local});
      }
      // Quote includes search the caller's own directory before -I. Refuse an
      // unexpected local copy rather than silently compiling a replacement.
      await assert.rejects(lstat(path.join(source, 'NetworkPublisherReaderV2.hpp')), {code: 'ENOENT'});
      record.authHeader = readerPin;record.authDeclaredHeader = readerRows[0];record.manifest = manifestInput.pin;record.producerReceipts = manifest.producerReceipts;
      await writeFile(path.join(owned, 'SOURCE-BEFORE.json'), JSON.stringify(record.inputsBefore, null, 2) + '\n', {flag: 'wx', mode: 0o600});
      const goRootValue = process.env.YNX_LINK_AUTH_READER_GO_ROOT ?? manifest.goRoot;
      if (process.env.YNX_LINK_AUTH_READER_GO_ROOT && manifest.goRoot)
        assert.equal(process.env.YNX_LINK_AUTH_READER_GO_ROOT, manifest.goRoot, 'explicit Go/socket roots disagree');
      const goParent = await ownedParent(goRootValue, 'YNX_LINK_AUTH_READER_GO_ROOT or manifest.goRoot');
      const binary = path.join(owned, 'auth-reader-go-caller');
      const compiled = await run('compile-original-reader', '/usr/bin/clang++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-pedantic', '-pthread', '-H',
        '-DYNX_AUTH_READER_PUBLIC_CONTROLS', '-DYNX_LINK_AUTH_READER_TEST_CALLER', '-I', authInclude, '-I', source,
        ...['resource-current-held-client.cpp', 'resource-current-held-identity.cpp', 'resource-current-peer.cpp',
          'resource-current-auth-reader-go-fixture-call.cpp'].map(leaf => path.join(source, leaf)), '-lbsm', '-o', binary], 45000);
      assert.equal(compiled.result.error, undefined, 'compiler process failure; original logs retained');
      assert.equal(compiled.result.status, 0, 'original Auth Reader / actual LINK compilation failed; original logs retained');
      const readerIncludes = compiled.stderr.toString('utf8').split('\n').filter(line => /^\.+ /.test(line))
        .map(line => line.replace(/^\.+ /, '')).filter(filename => path.basename(filename) === 'NetworkPublisherReaderV2.hpp');
      assert.ok(readerIncludes.length > 0 && readerIncludes.every(filename => filename === readerPin.path),
        'compiler did not include the exact handoff-pinned original Auth Reader');
      record.originalReaderIncludeObserved = true;
      record.originalAuthReaderBody = true;record.realLINKTUs = true;
      const binaryBytes = await originalBytes(binary, 128 << 20);
      record.binary = {path: binary, bytes: binaryBytes.length, sha256: sha(binaryBytes)};
      for (const selected of manifest.cases) {
        const {mode, control} = selected;
        const leg = {mode, control, passed: false};record.cases.push(leg);
        try {
          leg.goRoot = await fresh(goParent, 'g-');leg.cppOutput = await fresh(owned, `${mode}-${control}-`);
          leg.socket = path.join(leg.goRoot, 'ipc/network-helper.sock');
          assert.ok(Buffer.byteLength(leg.socket) < 104, 'new original Go socket path exceeds 104-byte native limit; no fallback');
          const observed = await run(`${mode}-${control}-original-go-broker`, driverInput.pin.path,
            [goInput.pin.path, binary, leg.goRoot, leg.cppOutput, mode, goInput.pin.sha256], 150000,
            {YNX_LINK_AUTH_READER_CONTROL: control});
          leg.command = observed.details;
          // Save the broker/caller originals before deciding this case. All
          // explicit cases run with fresh owned children even after one RED.
          leg.outputs = await preservedOutputs(leg.cppOutput);
          try { leg.broker = json(observed.stdout, 'original broker stdout'); }
          catch (error) { leg.brokerParseError = errorRecord(error); }
          const callerOutput = leg.outputs.find(row => path.basename(row.path) === 'link.stdout');
          if (callerOutput) {
            try { leg.caller = json(await originalBytes(callerOutput.path, 8 << 20, true), 'original caller stdout/stderr'); }
            catch (error) { leg.callerParseError = errorRecord(error); }
          }
          leg.processExit0 = !observed.result.error && observed.result.status === 0 && observed.result.signal === null;
          const b = leg.broker, c = leg.caller;
          if (Number.isSafeInteger(b?.goPIDFromActualSpawn) && b.goPIDFromActualSpawn > 0) record.actualGoExecuted = true;
          leg.brokerPassed = !!(b?.PUBLIC === true && b.sameSourceGo === true && b.linkExit0 === true &&
            b.goReaderActuallyDrained === true && b.goOwnerWaitExit0 === true && b.goWaitObserved === true &&
            b.goRawWaitStatus === 0 && b.goExitCode === 0 && b.goTermSignal === 0 && b.goOutputEOF === true &&
            b.goOutputTruncated === false && b.goReadErrno === 0 && b.goWaitErrno === 0 && b.goCaptureErrno === 0 &&
            Number.isSafeInteger(b.goPIDFromActualSpawn) && b.goPIDFromActualSpawn > 0 &&
            Number.isSafeInteger(b.nativePIDFromActualSuspendedSpawn) && b.nativePIDFromActualSuspendedSpawn > 0 &&
            b.actualAuthFence === false && b.RootAdmission === false && b.SourceAdmission === false);
          const callerBase = c?.PUBLIC === true && c.productionAuthReaderBody === true && c.realLINKBody === true &&
            c.mode === mode && c.control === control && c.passed === true && c.completed === true && c.hasDebt === false &&
            c.physicalDrained === true && c.nativeReleaseCount === 1 && c.actualTypedRoot === false &&
            c.actualAuthFence === false && c.RootAdmission === false && c.SourceAdmission === false;
          if (control === 'current') {
            leg.callerPassed = !!(callerBase && c.readCount === 2 && Array.isArray(c.bodyBytes) && c.bodyBytes.length === 2 &&
              c.bodyBytes.every(n => Number.isSafeInteger(n) && n > (mode === 'chunked' ? 2048 : 0)) && c.openCode === 0 &&
              JSON.stringify(c.currentCodes) === '[0,0]' && c.retireCode === 0 && c.drainCode === 0 && c.readerFirstCode === 0);
            leg.originalBodiesPreserved = !!(c && [0, 1].every(index => leg.outputs.some(row =>
              path.basename(row.path) === `response-${index}.body` && row.bytes === c.bodyBytes?.[index])));
          } else {
            // This positive control expects a known pre-connect DENIED (1),
            // with completed local custody and its original sticky firstcause.
            // A real old Reader debt/RED still exits nonzero and fails below.
            leg.callerPassed = !!(callerBase && c.readCount === 0 && JSON.stringify(c.bodyBytes) === '[0,0]' &&
              JSON.stringify(c.currentCodes) === '[-1,-1]' && c.openCode === 1 && c.retireCode === 1 && c.drainCode === 1 && c.readerFirstCode === 1);
            leg.originalBodiesPreserved = !leg.outputs.some(row => /^response-[01]\.body$/.test(path.basename(row.path)));
          }
          leg.passed = leg.processExit0 && leg.brokerPassed && leg.callerPassed && leg.originalBodiesPreserved;
          if (!leg.passed) leg.firstCause = {message: 'Original Auth Reader/LINK/Go RED or UNKNOWN; raw process results preserved'};
        } catch (error) { leg.firstCause = errorRecord(error); }
        finally {
          if (leg.cppOutput) await writeFile(path.join(leg.cppOutput, 'LEG-RESULT.json'), JSON.stringify(leg, null, 2) + '\n', {flag: 'wx', mode: 0o600});
        }
      }
      assert.ok(record.cases.length === manifest.cases.length && record.cases.every(leg => leg.passed),
        `original Auth Reader/LINK/Go RED or UNKNOWN; every selected case result retained in ${owned}`);
    } catch (error) { firstError = error;record.firstCause = errorRecord(error); }
    finally {
      for (const before of record.inputsBefore) {
        try {
          const bytes = await originalBytes(before.path, 128 << 20);
          record.inputsAfter.push({path: before.path, bytes: bytes.length, sha256: sha(bytes)});
        } catch (error) { record.inputsAfter.push({path: before.path, error: errorRecord(error)}); }
      }
      record.selectedInputsUnchanged = record.inputsBefore.length > 0 && record.inputsBefore.every((before, i) => samePin(before, record.inputsAfter[i]));
      if (!record.selectedInputsUnchanged && !firstError) {
        firstError = Error('original header or selected source/input changed during this run');record.firstCause = errorRecord(firstError);
      }
      record.status = firstError ? 'RED_OR_UNKNOWN_OR_INPUT_REFUSED' : 'PUBLIC_ORIGINAL_READER_ACTUAL_LINK_GO_PASS';
      await writeFile(path.join(owned, 'SOURCE-AFTER.json'), JSON.stringify(record.inputsAfter, null, 2) + '\n', {flag: 'wx', mode: 0o600});
      await writeFile(path.join(owned, 'RESULT.json'), JSON.stringify(record, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    }
    if (firstError) throw firstError;
    assert.ok(record.cases.length > 0 && record.cases.every(leg => leg.passed), 'an actual original Go case was not verified');
  });
