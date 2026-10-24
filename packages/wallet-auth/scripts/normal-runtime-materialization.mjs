// Source-owned ordinary dependency copies. Import performs no filesystem I/O.
// File coverage is not Native, Source, application or installation admission.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const appPath = fileURLToPath(new URL('../integration/WALLET_APP_RUNTIME_DEPENDENCIES_316.json', import.meta.url));
const appPin = Object.freeze({path: appPath, bytes: 52657, sha256: '403467d07349bbaddab122f9e6e5ca600c2df5965ee96013fc5c5ab94d345106'});
const digest = raw => createHash('sha256').update(raw).digest('hex');
const fail = (code, detail) => { throw Object.assign(new Error(code + (detail ? ':' + detail : '')), {code, ...(detail ? {detail} : {})}); };
const exactKeys = (value, keys) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length || Object.keys(value).sort().join('|') !== [...keys].sort().join('|') || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !Object.hasOwn(d, 'value'))) fail('NORMAL_RUNTIME_DATA');
};
function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) fail('NORMAL_RUNTIME_PATH');
  return value;
}
function ancestors(file, kind) {
  absolute(file);
  for (let at = file;; at = path.dirname(at)) {
    const st = fs.lstatSync(at);
    if (st.isSymbolicLink()) fail('NORMAL_RUNTIME_SYMLINK', at);
    if (at === file ? (kind === 'file' ? !st.isFile() || st.nlink !== 1 : !st.isDirectory()) : !st.isDirectory()) fail('NORMAL_RUNTIME_ALIAS_OR_TYPE', at);
    if (at === path.dirname(at)) break;
  }
}
function relative(value) {
  if (typeof value !== 'string' || !value || path.posix.isAbsolute(value) || value.includes('\\') || !/^[\x20-\x7e]+$/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..') || path.posix.normalize(value) !== value) fail('NORMAL_RUNTIME_RELATIVE');
  return value;
}
function row(value) {
  exactKeys(value, ['path', 'bytes', 'sha256']);
  relative(value.path);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > 16777216 || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || (value.bytes === 0 && value.sha256 !== digest(Buffer.alloc(0)))) fail('NORMAL_RUNTIME_PIN');
  return {path: value.path, bytes: value.bytes, sha256: value.sha256};
}
function withFD(fd, action) {
  let failed = false, first, result;
  try { result = action(fd); } catch (error) { failed = true; first = error; }
  try { fs.closeSync(fd); } catch (error) { if (!failed) { failed = true; first = error; } }
  if (failed) throw first;
  return result;
}
function readFile(file, cap = 16777216) {
  ancestors(file, 'file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  return withFD(fd, () => {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > cap) fail('NORMAL_RUNTIME_ALIAS_OR_CAP', file);
    const raw = fs.readFileSync(fd), after = fs.fstatSync(fd);
    ancestors(file, 'file');
    const actual = fs.lstatSync(file);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || actual.dev !== after.dev || actual.ino !== after.ino || raw.length !== after.size) fail('NORMAL_RUNTIME_CHANGED', file);
    return raw;
  });
}
function pinned(ref) {
  exactKeys(ref, ['path', 'bytes', 'sha256']);
  absolute(ref.path);
  const raw = readFile(ref.path);
  if (raw.length !== ref.bytes || digest(raw) !== ref.sha256) fail('NORMAL_RUNTIME_INPUT_DIFFERS', ref.path);
  return raw;
}
function actual(root, entry) {
  const raw = readFile(path.join(root, relative(entry.path)));
  if (raw.length !== entry.bytes || digest(raw) !== entry.sha256) fail('NORMAL_RUNTIME_INPUT_DIFFERS', entry.path);
  return raw;
}
function manifest() {
  const raw = pinned(appPin), body = JSON.parse(raw);
  if (body.schemaVersion !== 2 || body.files?.length !== 316) fail('NORMAL_RUNTIME_APP_MANIFEST');
  const files = body.files.map(r => row({...r, path: 'node_modules/' + r.path}));
  if (new Set(files.map(r => r.path)).size !== 316) fail('NORMAL_RUNTIME_APP_MANIFEST');
  return {raw, files};
}

/** Checks all fixed 316 files, including ancestor aliases and exact bytes. */
export function verifyNormalRuntimeAppCoverage(packageRoot) {
  ancestors(packageRoot, 'directory');
  const {files} = manifest(), missing = [];
  for (const entry of files) {
    try { actual(packageRoot, entry); }
    catch (error) { if (error?.code === 'ENOENT') missing.push(entry.path); else throw error; }
  }
  if (missing.length) {
    const error = Object.assign(new Error('NORMAL_RUNTIME_APP_FILES_MISSING:' + missing.length), {code: 'NORMAL_RUNTIME_APP_FILES_MISSING', missing});
    throw error;
  }
  return Object.freeze({sourceOwnedAppManifest: appPin, filesVerified: files.length, fullAppDependencyCoverage: true, scope: 'fixed 316 regular file bytes only', NativeAdmission: false, SourceAdmission: false, AppQualified: false, installed: false});
}

/**
 * Preflight every selected source before creating a new output root. Copy only
 * node_modules entries from the minimum union plus all fixed App316 entries.
 * Every write is exclusive, ordinary copy with readback. No clone, download,
 * loader, retry, cleanup-on-error, overwrite or existing-prefix modification.
 */
export function materializeNormalRuntimeDependencies(request) {
  exactKeys(request, ['sourcePackageRoot', 'newOutputRoot', 'runtimeUnionRef', 'sourceOwnedAppManifestRef']);
  const {sourcePackageRoot: source, newOutputRoot: output} = request;
  ancestors(source, 'directory'); absolute(output);
  if (output === source || output.startsWith(source + '/') || source.startsWith(output + '/')) fail('NORMAL_RUNTIME_ROOT_OVERLAP');
  ancestors(path.dirname(output), 'directory');
  try { fs.lstatSync(output); fail('NORMAL_RUNTIME_OUTPUT_EXISTS'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  exactKeys(request.sourceOwnedAppManifestRef, ['path', 'bytes', 'sha256']);
  if (Object.keys(appPin).some(k => request.sourceOwnedAppManifestRef[k] !== appPin[k])) fail('NORMAL_RUNTIME_APP_MANIFEST_REF');
  const app = manifest(), unionRaw = pinned(request.runtimeUnionRef), union = JSON.parse(unionRaw);
  exactKeys(union, ['files', 'version']);
  if (union.version !== 'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1' || !Array.isArray(union.files) || !union.files.length || union.files.length > 100000) fail('NORMAL_RUNTIME_UNION');
  const all = new Set(), selected = new Map();
  for (const entry of union.files) {
    const r = row(entry);
    if (all.has(r.path)) fail('NORMAL_RUNTIME_UNION_DUPLICATE', r.path);
    all.add(r.path);
    if (r.path.startsWith('node_modules/')) selected.set(r.path, r);
  }
  if (!selected.size) fail('NORMAL_RUNTIME_UNION_DEPENDENCIES_EMPTY');
  const minUnionDependencyCount = selected.size;
  let app316AlreadyInMinimumUnion = 0;
  for (const r of app.files) {
    const prior = selected.get(r.path);
    if (prior) {
      if (prior.bytes !== r.bytes || prior.sha256 !== r.sha256) fail('NORMAL_RUNTIME_APP_UNION_CONFLICT', r.path);
      app316AlreadyInMinimumUnion++;
    } else selected.set(r.path, r);
  }
  const files = [...selected.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const pkgRaw = readFile(path.join(source, 'package.json')), pkg = JSON.parse(pkgRaw);
  const inventoryRaw = readFile(path.join(source, 'integration/SDK332_R140_NATIVE_COMPATIBILITY.json')), inventory = JSON.parse(inventoryRaw);
  if (pkg.name !== '@ynx-chain/wallet-auth' || typeof pkg.version !== 'string' || inventory.version !== pkg.version) fail('NORMAL_RUNTIME_SDK_VERSION');
  for (const name of ['NativeInputs', 'HelperInputs', 'pureDeploymentInputs', 'sourceCurrentIOInputs']) if (!Array.isArray(inventory[name])) fail('NORMAL_RUNTIME_SDK_INVENTORY');
  const normal = [...inventory.NativeInputs, ...inventory.HelperInputs, ...inventory.pureDeploymentInputs, inventory.normalBuildTool];
  if (normal.some(r => typeof r?.path !== 'string') || new Set(normal.map(r => r.path)).size !== normal.length) fail('NORMAL_RUNTIME_SDK_INVENTORY');
  // Preflight ALL files before mkdir. No partial prefix is created for missing,
  // changed, aliased, conflicting or untrusted source metadata.
  for (const entry of files) actual(source, entry);
  let created = false;
  const copied = [];
  try {
    fs.mkdirSync(output, {mode: 0o700}); created = true;
    for (const entry of files) {
      const raw = actual(source, entry), destination = path.join(output, entry.path);
      ancestors(output, 'directory');
      fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
      ancestors(path.dirname(destination), 'directory');
      const fd = fs.openSync(destination, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
      withFD(fd, () => fs.writeFileSync(fd, raw));
      actual(output, entry);
      copied.push(entry);
    }
    const coverage = verifyNormalRuntimeAppCoverage(output);
    if (!readFile(path.join(source, 'package.json')).equals(pkgRaw) || !readFile(path.join(source, 'integration/SDK332_R140_NATIVE_COMPATIBILITY.json')).equals(inventoryRaw) || !pinned(request.runtimeUnionRef).equals(unionRaw) || !pinned(appPin).equals(app.raw)) fail('NORMAL_RUNTIME_CHANGED');
    for (const entry of files) { actual(source, entry); actual(output, entry); }
    return Object.freeze({kind: 'YNX_NORMAL_RUNTIME_DEPENDENCY_MATERIALIZATION/v1', operation: 'exclusive ordinary copy', sourcePackageRoot: source, newOutputRoot: output,
      actualSDKVersion: pkg.version, declaredNormalInputCounts: {NativeInputs: inventory.NativeInputs.length, HelperInputs: inventory.HelperInputs.length, pureDeploymentInputs: inventory.pureDeploymentInputs.length, normal: normal.length, withSourceCurrentIO: new Set([...normal, ...inventory.sourceCurrentIOInputs].map(r => r.path)).size, CPPHeaderInputs: normal.filter(r => /\.(?:h|mm|cpp)$/.test(r.path)).length},
      runtimeUnionRef: {...request.runtimeUnionRef}, sourceOwnedAppManifestRef: appPin, minUnionDependencyCount, app316Files: 316, app316AlreadyInMinimumUnion, app316Added: 316 - app316AlreadyInMinimumUnion,
      filesCopied: files.length, totalBytes: files.reduce((n, r) => n + r.bytes, 0), files: copied, fullAppDependencyCoverage: coverage.fullAppDependencyCoverage,
      packagePayloadMaterialized: false, CoWClaimed: false, NativeAdmission: false, SourceAdmission: false, AppQualified: false, installed: false, published: false});
  } catch (error) {
    // Preserve the actual first cause and the complete partial output. Do not
    // retry uncertain writes or delete evidence to make a second run succeed.
    if (error && (typeof error === 'object' || typeof error === 'function') && Object.isExtensible(error)) error.partialMaterialization = {newOutputRoot: output, rootCreated: created, filesCopied: copied.length, outputPreserved: true, retryPerformed: false};
    throw error;
  }
}
