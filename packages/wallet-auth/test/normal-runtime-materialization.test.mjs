// PUBLIC temporary prefixes and actual fixed316 supplier bytes. No Native,
// runtime9342/9351 traversal, installed prefix mutation or application grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {materializeNormalRuntimeDependencies, verifyNormalRuntimeAppCoverage} from '../scripts/normal-runtime-materialization.mjs';

const packageRoot = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const appPath = path.join(packageRoot, 'integration/WALLET_APP_RUNTIME_DEPENDENCIES_316.json');
const sha = b => createHash('sha256').update(b).digest('hex');
const raw = fs.readFileSync(appPath), app = JSON.parse(raw);
assert.equal(raw.length, 52657);
assert.equal(sha(raw), '403467d07349bbaddab122f9e6e5ca600c2df5965ee96013fc5c5ab94d345106');
const appRef = {path: appPath, bytes: raw.length, sha256: sha(raw)};
const files = app.files.map(r => ({...r, path: 'node_modules/' + r.path}));
// Actual Auth28 minunion intersection, reproduced from its frozen manifest:
// all 53 ciphers source/type/map/provider files were outside the selected263.
const old263 = files.filter(r => !r.path.startsWith('node_modules/@noble/ciphers/'));
assert.equal(old263.length, 263);
function writeJSON(file, value) { const b = Buffer.from(JSON.stringify(value)); fs.writeFileSync(file, b); return {path: file, bytes: b.length, sha256: sha(b)}; }
function fixture(run) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'PUBLIC-normal-runtime-'));
  try {
    const runtimeUnionRef = writeJSON(path.join(root, 'minimum.json'), {files: old263, version: 'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'});
    return run({sourcePackageRoot: packageRoot, newOutputRoot: path.join(root, 'output'), runtimeUnionRef, sourceOwnedAppManifestRef: appRef}, root);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
}
function copyFixture(source, entries = files) {
  fs.mkdirSync(source, {recursive: true});
  for (const r of entries) { const to = path.join(source, r.path); fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(path.join(packageRoot, r.path), to); }
  for (const r of ['package.json', 'integration/SDK332_R140_NATIVE_COMPATIBILITY.json']) { const to = path.join(source, r); fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(path.join(packageRoot, r), to); }
}

test('PUBLIC old263 pins pass while fixed full316 guard reports the real missing53', () => fixture((request, root) => {
  const old = path.join(root, 'old263'); copyFixture(old, old263);
  for (const r of old263) { const b = fs.readFileSync(path.join(old, r.path)); assert.equal(b.length, r.bytes); assert.equal(sha(b), r.sha256); }
  assert.throws(() => verifyNormalRuntimeAppCoverage(old), e => e.code === 'NORMAL_RUNTIME_APP_FILES_MISSING' && e.missing.length === 53 && e.missing.every(p => p.startsWith('node_modules/@noble/ciphers/')));
}));

test('PUBLIC actual CLI merges263 plus53, verifies316, rejects wrong request pin and existing output', () => fixture((request, root) => {
  const ref = writeJSON(path.join(root, 'request.json'), request), cli = path.join(packageRoot, 'scripts/build-contract-relay-runtime-manifest.mjs');
  const bad = spawnSync(process.execPath, [cli, '--materialize-normal-runtime', ref.path, String(ref.bytes), '0'.repeat(64)], {encoding: 'utf8'});
  assert.notEqual(bad.status, 0); assert.match(bad.stderr, /materialization request differs/); assert.equal(fs.existsSync(request.newOutputRoot), false);
  const good = spawnSync(process.execPath, [cli, '--materialize-normal-runtime', ref.path, String(ref.bytes), ref.sha256], {encoding: 'utf8'});
  assert.equal(good.status, 0, good.stderr);
  const r = JSON.parse(good.stdout), pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json')));
  assert.equal(r.actualSDKVersion, pkg.version); assert.equal(r.minUnionDependencyCount, 263); assert.equal(r.app316Added, 53); assert.equal(r.app316AlreadyInMinimumUnion, 263); assert.equal(r.filesCopied, 316); assert.equal(r.fullAppDependencyCoverage, true);
  assert.equal(r.declaredNormalInputCounts.normal, 102); assert.equal(r.declaredNormalInputCounts.withSourceCurrentIO, 103); assert.equal(r.declaredNormalInputCounts.CPPHeaderInputs, 81);
  for (const k of ['packagePayloadMaterialized', 'CoWClaimed', 'NativeAdmission', 'SourceAdmission', 'AppQualified', 'installed', 'published']) assert.equal(r[k], false);
  assert.equal(verifyNormalRuntimeAppCoverage(request.newOutputRoot).filesVerified, 316);
  assert.throws(() => materializeNormalRuntimeDependencies(request), {code: 'NORMAL_RUNTIME_OUTPUT_EXISTS'});
  assert.equal(verifyNormalRuntimeAppCoverage(request.newOutputRoot).filesVerified, 316);
}));

test('PUBLIC missing/changed/symlink source fails before output creation; fixed appref and conflict rejected', () => fixture((request, root) => {
  const source = path.join(root, 'source'); copyFixture(source);
  request = {...request, sourcePackageRoot: source};
  const file = path.join(source, files[0].path), original = fs.readFileSync(file);
  fs.unlinkSync(file); assert.throws(() => materializeNormalRuntimeDependencies(request), {code: 'ENOENT'}); assert.equal(fs.existsSync(request.newOutputRoot), false);
  fs.writeFileSync(file, Buffer.concat([original, Buffer.from('\nPUBLIC changed')])); assert.throws(() => materializeNormalRuntimeDependencies(request), {code: 'NORMAL_RUNTIME_INPUT_DIFFERS'}); assert.equal(fs.existsSync(request.newOutputRoot), false);
  fs.unlinkSync(file); fs.symlinkSync(path.join(packageRoot, files[0].path), file); assert.throws(() => materializeNormalRuntimeDependencies(request), {code: 'NORMAL_RUNTIME_SYMLINK'}); assert.equal(fs.existsSync(request.newOutputRoot), false);
  fs.unlinkSync(file); fs.writeFileSync(file, original);
  const aliasParent = path.dirname(file), held = aliasParent + '-held'; fs.renameSync(aliasParent, held); fs.symlinkSync(held, aliasParent);
  assert.throws(() => materializeNormalRuntimeDependencies(request), {code: 'NORMAL_RUNTIME_SYMLINK'}); assert.equal(fs.existsSync(request.newOutputRoot), false);
  fs.unlinkSync(aliasParent); fs.renameSync(held, aliasParent);
  const hardlink = path.join(root, 'alias'); fs.linkSync(file, hardlink); assert.throws(() => materializeNormalRuntimeDependencies(request), {code: 'NORMAL_RUNTIME_ALIAS_OR_TYPE'}); fs.unlinkSync(hardlink);
  assert.throws(() => materializeNormalRuntimeDependencies({...request, sourceOwnedAppManifestRef: {...appRef, sha256: '0'.repeat(64)}}), {code: 'NORMAL_RUNTIME_APP_MANIFEST_REF'});
  const changed = {...files[0], sha256: '0'.repeat(64)};
  request.runtimeUnionRef = writeJSON(path.join(root, 'conflict.json'), {files: [...old263, changed], version: 'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'});
  assert.throws(() => materializeNormalRuntimeDependencies(request), {code: 'NORMAL_RUNTIME_APP_UNION_CONFLICT'}); assert.equal(fs.existsSync(request.newOutputRoot), false);
}));

test('PUBLIC default minimum-union CLI preserves its schema and explicitly denies full App coverage', () => fixture((request, root) => {
  const cliRoot = path.join(root, 'cli'); fs.mkdirSync(path.join(cliRoot, 'evidence'), {recursive: true});
  const cli = path.join(cliRoot, 'build-contract-relay-runtime-manifest.mjs'); fs.copyFileSync(path.join(packageRoot, 'scripts/build-contract-relay-runtime-manifest.mjs'), cli);
  const version = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'))).version;
  const executor = {path: 'src/walletconnect-contract-initiator-boundary.js', bytes: 1, sha256: sha(Buffer.from('x'))};
  const a = writeJSON(path.join(root, 'original-auth-runtime-manifest.json'), {files: [...old263, executor], version: 'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'});
  const w = writeJSON(path.join(root, 'walletconnect-runtime-manifest.json'), {kind: 'YNX-WALLETCONNECT-PRODUCTION-CLOSURE/v1', sdk: {version}, files: [], packages: [], edges: []});
  const h = writeJSON(path.join(root, 'canonical.json'), {versionSDK: version, version, evidence: [a, w], runtime: {Auth: {files: 264, manifestSHA256: a.sha256}, WalletConnect: {files: 0, packages: 0, edges: 0}}});
  const result = spawnSync(process.execPath, [cli, h.path, String(h.bytes), h.sha256], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const r = JSON.parse(result.stdout); assert.equal(r.fullPackageDependencyMaterialization, false); assert.equal(r.App316CoverageVerified, false);
  const union = JSON.parse(fs.readFileSync(r.manifest.path)); assert.equal(union.version, 'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'); assert.equal(union.files.filter(r => r.path.startsWith('node_modules/')).length, 263);
}));

test('PUBLIC injected copy failure retains its actual first cause and partial files; no retry or overwrite', () => fixture(request => {
  // Test-only syscall observation, not a production provider or caller hook.
  const originalOpen = fs.openSync, first = Object.assign(new Error('PUBLIC second exclusive create refused'), {code: 'PUBLIC_COPY_FAILURE'});
  let attempts = 0;
  fs.openSync = function(file, flags, ...args) {
    if (typeof file === 'string' && file.startsWith(request.newOutputRoot + '/') && typeof flags === 'number' && (flags & fs.constants.O_EXCL)) {
      attempts++;
      if (attempts === 2) throw first;
    }
    return originalOpen.call(this, file, flags, ...args);
  };
  try {
    assert.throws(() => materializeNormalRuntimeDependencies(request), error => error === first && error.partialMaterialization.rootCreated === true && error.partialMaterialization.filesCopied === 1 && error.partialMaterialization.retryPerformed === false);
    assert.equal(attempts, 2);
  } finally { fs.openSync = originalOpen; }
  const selectedFirst = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)[0];
  const retained = fs.readFileSync(path.join(request.newOutputRoot, selectedFirst.path));
  assert.equal(sha(retained), selectedFirst.sha256);
  assert.throws(() => materializeNormalRuntimeDependencies(request), {code: 'NORMAL_RUNTIME_OUTPUT_EXISTS'});
  assert.equal(sha(fs.readFileSync(path.join(request.newOutputRoot, selectedFirst.path))), selectedFirst.sha256);
}));

test('PUBLIC coverage gate directly rejects deletion, byte changes and symlink substitution after full316 success', () => fixture((request, root) => {
  const output = path.join(root, 'verified316'); copyFixture(output);
  assert.equal(verifyNormalRuntimeAppCoverage(output).fullAppDependencyCoverage, true);
  const entry = files[0], file = path.join(output, entry.path), original = fs.readFileSync(file);
  fs.unlinkSync(file);
  assert.throws(() => verifyNormalRuntimeAppCoverage(output), e => e.code === 'NORMAL_RUNTIME_APP_FILES_MISSING' && e.missing.length === 1 && e.missing[0] === entry.path);
  fs.writeFileSync(file, Buffer.concat([original, Buffer.from('\nPUBLIC changed after verification')]));
  assert.throws(() => verifyNormalRuntimeAppCoverage(output), {code: 'NORMAL_RUNTIME_INPUT_DIFFERS'});
  fs.unlinkSync(file); fs.symlinkSync(path.join(packageRoot, entry.path), file);
  assert.throws(() => verifyNormalRuntimeAppCoverage(output), {code: 'NORMAL_RUNTIME_SYMLINK'});
}));
