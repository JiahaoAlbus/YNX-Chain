import {readFileSync} from 'node:fs';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Exact source body with PUBLIC lexical stand-ins. No product import graph,
// real FD, root/role/key, private admission factory or Native export runs.
const source = readFileSync(new URL('../src/original-ide-service-admission-startup.js', import.meta.url), 'utf8');
const ENTRY = '/PUBLIC/Resources/server.mjs';
const DIGEST = 'a'.repeat(64);
const selection = {
  sourceSelection: {PUBLIC: 'NO_AUTHORITY'},
  receiptSelection: {receiptPath: '/PUBLIC/receipts/n.admission.json', receiptDigest: 'd'.repeat(64)},
  expectedRequest: {requestNonce: 'n', consumerManifestDigest: DIGEST},
  receiptDirectory: '/PUBLIC/receipts'
};

function fixture({closeFailures = new Map(), bodyFailure, failBody = false, openFailure, failOpen = false} = {}) {
  const provenance = Buffer.from(JSON.stringify({
    schemaVersion: 1, productId: 'ynx-developer-v1', sourceDirty: false,
    sourceCommit: 'b'.repeat(40), sourceTree: 'c'.repeat(40),
    runtimeCheckpoint: 'b'.repeat(40), platform: 'macos-arm64', artifactClass: 'unsigned-testnet-preview'
  }));
  const paths = new Map(), held = new Map();
  const state = {opened: [], closeAttempts: [], qualificationStandInCalls: 0};
  let nextFD = 100, nextInode = 1;
  const stat = path => {
    if (!paths.has(path)) {
      const file = path === ENTRY || path.endsWith('build-provenance.json');
      paths.set(path, {
        dev: 1, ino: nextInode++, uid: 1000, mode: file ? 0o100644 : 0o040755,
        nlink: 1, size: provenance.length,
        isFile: () => file, isDirectory: () => !file, isSymbolicLink: () => false
      });
    }
    return paths.get(path);
  };
  class PublicWalletAuthError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const context = vm.createContext({
    constants: {O_RDONLY: 0, O_DIRECTORY: 1, O_NOFOLLOW: 2},
    dirname, isAbsolute, join, resolve, fileURLToPath, types, URL, Buffer,
    process: {getuid: () => 1000, arch: 'arm64', argv: ['PUBLIC_NODE', ENTRY]},
    canonicalJSON: JSON.stringify, captureOriginalRecoveryJSON: value => structuredClone(value),
    exactFields(value, fields) {
      assert.equal(Object.keys(value).sort().join(), [...fields].sort().join());
    },
    WalletAuthError: PublicWalletAuthError,
    lstatSync: stat,
    openSync(path) {
      if (failOpen && path.endsWith('build-provenance.json')) throw openFailure;
      const fd = nextFD++;
      held.set(fd, {path, stat: stat(path)});
      state.opened.push(fd);
      return fd;
    },
    fstatSync(fd) {
      // Entry FD is captured in held before the late identity check fails.
      if (failBody && fd === 103) throw bodyFailure;
      return held.get(fd).stat;
    },
    readSync(fd, buffer, offset, length, position) {
      return position >= provenance.length ? 0 : provenance.copy(buffer, offset, position, Math.min(provenance.length, position + length));
    },
    closeSync(fd) {
      state.closeAttempts.push(fd);
      if (closeFailures.has(fd)) throw closeFailures.get(fd);
      held.delete(fd);
    },
    createHash() { return {update() { return this; }, digest() { return DIGEST; }}; },
    prepareOriginalWalletServiceAdmission() {
      // A stop marker at the existing qualification boundary, never a grant.
      state.qualificationStandInCalls++;
      throw Object.assign(Error('PUBLIC_QUALIFICATION_BOUNDARY_STOP'), {code: 'PUBLIC_QUALIFICATION_BOUNDARY_STOP'});
    },
    readOriginalOperationProtectedSource() { throw Error('No private reads allowed in PUBLIC fixture'); }
  });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replace('export function', 'function') + '\nthis.prepare = prepareOriginalIDEServiceAdmissionStartup;', context);
  return {state, call: () => context.prepare(selection, 'file://' + ENTRY, () => new Date())};
}

function thrown(call) {
  try { call(); return {present: false}; }
  catch (cause) { return {present: true, cause}; }
}

function cleanupBlocked(f) {
  const result = thrown(f.call);
  assert.equal(result.present, true);
  assert.equal(result.cause?.code, 'IDE_ADMISSION_CONSUMER_CLEANUP_INCOMPLETE');
  assert.equal(f.state.qualificationStandInCalls, 0);
}

test('PUBLIC close failure blocks qualification and attempts every held close exactly once', () => {
  const f = fixture({closeFailures: new Map([[103, Error('PUBLIC_CLOSE_EIO')]])});
  cleanupBlocked(f);
  assert.deepEqual(f.state.closeAttempts, [104, 103, 102, 101, 100]);
});

test('PUBLIC multiple close failures retain debt and later acquisition never retries unknown or recycled FDs', () => {
  const f = fixture({closeFailures: new Map([[104, Error('PUBLIC_CLOSE_A')], [103, Error('PUBLIC_CLOSE_B')]])});
  cleanupBlocked(f);
  const opened = [...f.state.opened], attempted = [...f.state.closeAttempts];
  cleanupBlocked(f);
  assert.deepEqual(f.state.opened, opened);
  assert.deepEqual(f.state.closeAttempts, attempted);
});

test('PUBLIC original frozen read failure is preserved separately from cleanup failure', () => {
  const original = Object.freeze(Error('PUBLIC_ORIGINAL_READ_FAILURE'));
  const f = fixture({failBody: true, bodyFailure: original, closeFailures: new Map([[103, Error('PUBLIC_CLOSE_FAILURE')]])});
  assert.equal(thrown(f.call).cause, original);
  assert.deepEqual(f.state.closeAttempts, [103, 102, 101, 100]);
  const count = f.state.opened.length;
  cleanupBlocked(f);
  assert.equal(f.state.opened.length, count);
});

for (const [name, value] of [['zero', 0], ['false', false], ['null', null], ['undefined', undefined], ['empty', '']]) {
  test(`PUBLIC ${name} original read cause survives cleanup debt without truthiness conversion`, () => {
    const f = fixture({failBody: true, bodyFailure: value, closeFailures: new Map([[103, Error('PUBLIC_CLOSE_FAILURE')]])});
    const first = thrown(f.call);
    assert.equal(first.present, true);
    assert.equal(first.cause, value);
    assert.deepEqual(f.state.closeAttempts, [103, 102, 101, 100]);
    cleanupBlocked(f);
  });
}

test('PUBLIC falsy close cause is still unresolved cleanup, not successful release', () => {
  const f = fixture({closeFailures: new Map([[103, 0]])});
  cleanupBlocked(f);
  cleanupBlocked(f);
  assert.deepEqual(f.state.closeAttempts, [104, 103, 102, 101, 100]);
});

test('PUBLIC partial open failure preserves primary cause and cleans only captured descriptors', () => {
  const original = Error('PUBLIC_OPEN_FAILURE');
  const f = fixture({failOpen: true, openFailure: original, closeFailures: new Map([[102, Error('PUBLIC_CLOSE_FAILURE')]])});
  assert.equal(thrown(f.call).cause, original);
  assert.deepEqual(f.state.closeAttempts, [103, 102, 101, 100]);
  cleanupBlocked(f);
});

test('PUBLIC complete cleanup leaves the original qualification refusal boundary in place', () => {
  const f = fixture();
  assert.equal(thrown(f.call).cause?.code, 'PUBLIC_QUALIFICATION_BOUNDARY_STOP');
  assert.equal(f.state.qualificationStandInCalls, 1);
  assert.deepEqual(f.state.closeAttempts, [104, 103, 102, 101, 100]);
});
