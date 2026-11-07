// Original LINK source-CI hook: actual fixed Auth public source + LINK owner.
// No normal Root/Principal/Source is admitted. Go executes only in this CLI on
// the original GitHub Actions job; imports/metadata tests never invoke Go.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../..');
const authDependencyDirectory = path.join(directory, 'server-tls-auth-deps');
const moduleName = 'github.com/JiahaoAlbus/YNX-Chain';
const tags = 'securelink_openssl,securelink_reviewed_server_tls';
export const SERVER_TLS_REQUIRED_TESTS = Object.freeze(['TestOriginalServerTLSOriginalFactoryEmptyRootCleanup']);
export const AUTH_SERVER_TLS_SNAPSHOT = Object.freeze([
  Object.freeze({path: 'internal/authservertls/lease.go', bytes: 16311, sha256: '119e448e87e16ef2690b7dbf4c37a6778ce88a4bba4e90fc89f7eef59ba7e7a2', gitBlob: 'c179ce4f8ab7929d775a6bef7b328e9c9f10ae55'}),
  Object.freeze({path: 'internal/authservertls/parent_darwin.go', bytes: 427, sha256: 'a04f8058d0e8068a0c0271b114d74481fd445e6b3ed80934295f7859a75eff26', gitBlob: 'a491f1aeb4e38a64f4537b11ef78352e51ae668c'}),
  Object.freeze({path: 'internal/authservertls/parent_linux.go', bytes: 429, sha256: '96ad86046ee79cd9b9be5ca9893a7eb958a426459e0e63e4a1deee7d02134882', gitBlob: 'b6858541da3160d56f2477f9ac46b72b239108d2'}),
]);
const requireValue = (ok, why) => {if (!ok) throw Error('Server TLS source CI: ' + why);};
const sha = raw => createHash('sha256').update(raw).digest('hex');
const gitBlob = raw => createHash('sha1').update(Buffer.from('blob ' + raw.length + '\0')).update(raw).digest('hex');
const inside = (root, child) => child === root || child.startsWith(root + path.sep);
function exact(actual, expected, label) {
  requireValue(Array.isArray(actual) && new Set(actual).size === actual.length &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()), 'closed unique ' + label + ' required');
}
function readOwned(file) {
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && stat.size <= (16 << 20) &&
    fs.realpathSync(file) === file, 'bounded owned nonsymlink public source required: ' + file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd); requireValue(before.dev === stat.dev && before.ino === stat.ino, 'opened source identity changed');
    const raw = fs.readFileSync(fd), after = fs.fstatSync(fd);
    requireValue(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'source changed while reading');
    return {raw, descriptor: {path: file, bytes: raw.length, sha256: sha(raw), gitBlob: gitBlob(raw)}};
  } finally {fs.closeSync(fd);}
}
function verifyPin(actual, expected, label) {
  requireValue(actual.bytes === expected.bytes && actual.sha256 === expected.sha256 && actual.gitBlob === expected.gitBlob, 'original public source pin mismatch: ' + label);
}
export function verifyAuthSnapshot(root = authDependencyDirectory) {
  const manifest = readOwned(path.join(root, 'ORIGINALS.json')), value = JSON.parse(manifest.raw);
  requireValue(value.schema === 'YNX-LINK-AUTH-SERVER-TLS-PUBLIC-SOURCE-SNAPSHOT/v1' &&
    value.state === 'ACTUAL_SOURCE_SNAPSHOT_NOT_OWNER_RELEASE_OR_ROOT_ADMISSION' && value.copiedSourceOnly === true &&
    value.modifiedSupplierSource === false && value.RootAdmission === false && value.SourceAdmission === false && value.V4PrincipalAdmission === false,
    'actual source snapshot provenance required; no owner release/Root claim');
  exact(value.sources?.map(row => row.path), AUTH_SERVER_TLS_SNAPSHOT.map(row => row.path), 'Auth public source files');
  const sources = AUTH_SERVER_TLS_SNAPSHOT.map(expected => {
    const row = value.sources.find(row => row.path === expected.path);
    verifyPin(row, expected, expected.path);
    requireValue(row.mode === '100644' && typeof row.originalPath === 'string' && path.isAbsolute(row.originalPath) &&
      row.originalPath.endsWith('/' + expected.path), 'actual supplier original source path required');
    const input = readOwned(path.join(root, expected.path)); verifyPin(input.descriptor, expected, expected.path);
    return {...input, repositoryPath: expected.path, owner: 'AUTH_ACTUAL_PUBLIC_SOURCE_SNAPSHOT', originalSupplierPath: row.originalPath};
  });
  return {manifest: manifest.descriptor, sources};
}
export function ownedEmptyRoot(root, forbidden = []) {
  requireValue(typeof root === 'string' && path.isAbsolute(root) && path.resolve(root) === root &&
    forbidden.every(other => !inside(other, root) && !inside(root, other)), 'explicit disjoint canonical CI root required');
  const parent = path.dirname(root); requireValue(fs.realpathSync(parent) === parent && fs.lstatSync(parent).isDirectory(), 'existing nonsymlink parent required');
  if (!fs.existsSync(root)) fs.mkdirSync(root, {mode: 0o700});
  const stat = fs.lstatSync(root);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && !(stat.mode & 0o077) &&
    fs.realpathSync(root) === root && fs.readdirSync(root).length === 0, 'fresh private owned0700 root required');
  return root;
}
function sourceFiles(root) {
  const files = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      const file = path.join(folder, entry.name);
      requireValue(!entry.isSymbolicLink(), 'source tree symlink refused');
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:go|c|h)$/.test(entry.name)) {requireValue(entry.isFile(), 'regular compiled source required'); files.push(file);}
    }
  }
  walk(root); return files.sort();
}
function writeLeaf(root, name, bytes) {
  const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  fs.writeFileSync(file, bytes, {flag: 'wx', mode: 0o600}); return file;
}
/** Copies only the actual Go closure used by the selected LINK tests. The root
 * go.mod/sum and replacement module descriptors are retained byte-for-byte. */
export function prepareServerTLSComposite({repositoryRoot, privateRoot, publicRoot, dependencyRoot = authDependencyDirectory}) {
  requireValue(!fs.existsSync(path.join(repositoryRoot, 'internal/authservertls')), 'real repository Auth package now exists; explicit owner rebind required rather than masking it with a stale snapshot');
  const dependency = verifyAuthSnapshot(dependencyRoot), inputs = [];
  const names = ['go.mod', 'go.sum', 'third_party/cometbft/go.mod', 'third_party/cometbft/go.sum',
    'cmd/ynx-secure-link-caller/private_client_v1.h',
    ...sourceFiles(path.join(repositoryRoot, 'internal/securelink')).map(file => path.relative(repositoryRoot, file).split(path.sep).join('/'))];
  for (const name of names) {
    const input = readOwned(path.join(repositoryRoot, name)); inputs.push({...input, repositoryPath: name, owner: 'ORIGINAL_LINK_WORKTREE_BYTES'});
  }
  const mod = inputs.find(row => row.repositoryPath === 'go.mod').raw.toString('utf8');
  requireValue(new RegExp('^module ' + moduleName.replaceAll('.', '\\.') + '$', 'm').test(mod) && /^go 1\.26\.10$/m.test(mod) &&
    /^replace github\.com\/cometbft\/cometbft => \.\/third_party\/cometbft$/m.test(mod), 'original module/toolchain/fork replace retained');
  inputs.push(...dependency.sources);
  exact(inputs.map(row => row.repositoryPath), [...names, ...AUTH_SERVER_TLS_SNAPSHOT.map(row => row.path)], 'composite source paths');
  fs.mkdirSync(privateRoot, {mode: 0o700}); fs.mkdirSync(publicRoot, {mode: 0o700});
  const rows = inputs.map(input => {
    const virtualPath = writeLeaf(privateRoot, input.repositoryPath, input.raw);
    const publishedSource = writeLeaf(publicRoot, input.repositoryPath, input.raw);
    return {...input.descriptor, repositoryPath: input.repositoryPath, owner: input.owner, virtualPath, publishedSource,
      ...(input.originalSupplierPath ? {originalSupplierPath: input.originalSupplierPath} : {})};
  });
  const closure = rows.map(({repositoryPath, owner, bytes, sha256, gitBlob}) => ({repositoryPath, owner, bytes, sha256, gitBlob}));
  return {sources: rows, authManifest: dependency.manifest, compositeSHA256: sha(Buffer.from(JSON.stringify(closure))),
    completeSourceGraphNotJustGitHead: true, originalModuleBytesUnchanged: true, actualAuthLeafSnapshot: true,
    RootAdmission: false, SourceAdmission: false};
}
export function verifyCompositeUnchanged(composite) {
  for (const row of composite.sources) for (const file of [row.path, row.virtualPath, row.publishedSource]) verifyPin(readOwned(file).descriptor, row, row.repositoryPath);
  const manifest = readOwned(composite.authManifest.path); requireValue(manifest.descriptor.sha256 === composite.authManifest.sha256, 'Auth snapshot manifest changed');
  return true;
}
export function qualifyServerTLSTestEvents(raw, exit, signal, error) {
  requireValue(exit === 0 && signal === null && error === null, 'actual selected Go test command must exit0 without timeout/signal');
  const passed = [], skipped = [], failed = [];
  for (const line of raw.split('\n').filter(Boolean)) {
    let row; try {row = JSON.parse(line);} catch {throw Error('Server TLS source CI: malformed Go test JSON');}
    requireValue(row.Action !== 'fail', 'Go package/subtest failure must not be hidden by a top-level pass');
    if (!row.Test || row.Test.includes('/')) continue;
    if (row.Action === 'pass') passed.push(row.Test);
    if (row.Action === 'skip') skipped.push(row.Test);
    if (row.Action === 'fail') failed.push(row.Test);
  }
  requireValue(skipped.length === 0 && failed.length === 0, 'selected test must not skip or fail');
  exact(passed, SERVER_TLS_REQUIRED_TESTS, 'new transport/native/concrete Auth empty-Root controls');
  return {pass: passed.length, skip: 0, fail: 0, actualSelectedTests: passed.sort(), actualAuthEmptyRootRefused: true, physicalAndIdentityReexecuted: false,
    RootAdmission: false, SourceAdmission: false, V4PrincipalAdmission: false};
}

export function runServerTLSCI(env = process.env) {
  requireValue(env.CI === 'true' && env.GITHUB_ACTIONS === 'true', 'Go execution is restricted to the original GitHub Actions source CI entry');
  requireValue(['linux', 'darwin'].includes(process.platform), 'original POSIX native CI required');
  const publicRoot = ownedEmptyRoot(env.YNX_LINK_SERVER_TLS_CI_EVIDENCE, [repository]);
  const privateRoot = ownedEmptyRoot(env.YNX_LINK_SERVER_TLS_CI_PRIVATE, [repository, publicRoot]);
  const cache = env.GOCACHE, prefix = env.OPENSSL_PREFIX;
  requireValue([cache, prefix].every(value => typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value &&
    !inside(repository, value) && !inside(publicRoot, value)), 'original S3 private cache/OpenSSL prefix required');
  requireValue(env.PKG_CONFIG_PATH === path.join(prefix, 'lib/pkgconfig') && env.PKG_CONFIG_LIBDIR === env.PKG_CONFIG_PATH,
    'reuse the original S3 fixed private OpenSSL pkg-config context');
  for (const root of [cache, prefix]) {
    const stat = fs.lstatSync(root);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && !(stat.mode & 0o022) && fs.realpathSync(root) === root,
      'original S3 cache/OpenSSL must be actual owned nonsymlink directories');
  }
  const commands = [];
  let composite, failure, qualification;
  function json(name, value) {writeLeaf(publicRoot, name, Buffer.from(JSON.stringify(value, null, 2) + '\n'));}
  function run(executable, args, name, cwd, variables, timeout) {
    const stdout = path.join(publicRoot, name + '.stdout'), stderr = path.join(publicRoot, name + '.stderr');
    json(name + '.intent.json', {command: executable, args, cwd, timeout, purpose: 'SOURCE_CI_TRANSPORT_AND_EMPTY_ROOT_ONLY'});
    const outFD = fs.openSync(stdout, 'wx', 0o600), errFD = fs.openSync(stderr, 'wx', 0o600); let r;
    try {r = spawnSync(executable, args, {cwd, env: variables, stdio: ['ignore', outFD, errFD], timeout});}
    finally {fs.closeSync(outFD); fs.closeSync(errFD);}
    const out = readOwned(stdout), err = readOwned(stderr);
    const command = {command: executable, args, cwd, exit: r.status, signal: r.signal,
      error: r.error ? {code: r.error.code ?? null, message: r.error.message} : null, stdout: out.descriptor, stderr: err.descriptor}; commands.push(command);
    requireValue(r.status === 0 && !r.error && !r.signal, 'actual command failure preserved: ' + executable);
    return {stdout: out.raw.toString('utf8'), command};
  }
  try {
    composite = prepareServerTLSComposite({repositoryRoot: repository, privateRoot: path.join(privateRoot, 'source'), publicRoot: path.join(publicRoot, 'sources')});
    const testEnv = {...env, CGO_ENABLED: '1', GOTOOLCHAIN: 'local', GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB', GOWORK: 'off', GOFLAGS: '',
      GOTMPDIR: path.join(privateRoot, 'go-tmp'), TMPDIR: path.join(privateRoot, 'test-tmp'), PATH: path.join(prefix, 'bin') + path.delimiter + env.PATH};
    fs.mkdirSync(testEnv.GOTMPDIR, {mode: 0o700}); fs.mkdirSync(testEnv.TMPDIR, {mode: 0o700});
    composite.originalLINKGitHEAD = run('git', ['rev-parse', 'HEAD'], 'source-head', repository, testEnv, 10000).stdout.trim();
    requireValue(/^[a-f0-9]{40}$/.test(composite.originalLINKGitHEAD), 'actual original Git HEAD readback required');
    json('SOURCE-BEFORE.json', composite);
    requireValue(run('pkg-config', ['--modversion', 'openssl'], 'openssl-version', privateRoot, testEnv, 10000).stdout.trim() === '3.6.4', 'exact OpenSSL3.6.4 required');
    requireValue(run('pkg-config', ['--variable=prefix', 'openssl'], 'openssl-prefix', privateRoot, testEnv, 10000).stdout.trim() === prefix, 'same job-private OpenSSL prefix required');
    run(path.join(prefix, 'bin/openssl'), ['version', '-a'], 'openssl-runtime', privateRoot, testEnv, 10000);
    const go = JSON.parse(run('go', ['env', '-json', 'GOVERSION', 'CGO_ENABLED', 'GOCACHE', 'GOWORK', 'GOFLAGS'], 'go-environment', path.join(privateRoot, 'source'), testEnv, 30000).stdout);
    requireValue(go.GOVERSION === 'go1.26.10' && go.CGO_ENABLED === '1' && go.GOCACHE === cache && go.GOWORK === 'off' && go.GOFLAGS === '', 'original S3 Go1.26.10/cache/cgo context required');
    const result = run('go', ['test', '-mod=readonly', '-race', '-p', '1', '-count=1', '-timeout=90s', '-json', '-tags=' + tags,
      '-run', '^TestOriginalServerTLSOriginalFactoryEmptyRootCleanup$', './internal/securelink'], 'server-tls-tests', path.join(privateRoot, 'source'), testEnv, 150000);
    qualification = qualifyServerTLSTestEvents(result.stdout, result.command.exit, result.command.signal, result.command.error);
    verifyCompositeUnchanged(composite); json('SOURCE-AFTER.json', {unchanged: true, compositeSHA256: composite.compositeSHA256, sources: composite.sources});
  } catch (error) {failure = error;}
  const receipt = {schema: 'YNX-LINK-ORIGINAL-SERVER-TLS-SOURCE-CI/v1', state: failure ? 'FAIL_FIRSTCAUSE_PRESERVED' : 'PASS_TRANSPORT_AND_ACTUAL_AUTH_EMPTY_ROOT_ONLY',
    composite: composite ?? null, commands, qualification: qualification ?? null, failure: failure ? {message: failure.message, stack: failure.stack} : null,
    privateTemporaryKeysPublished: false, publicEvidenceRoot: publicRoot, privateWorkRoot: privateRoot, normalGoCArchiveBuilt: false,
    compiledActualAuthAdapter: Boolean(qualification), defaultRootRegistrationEmpty: true, normalRootIssued: false,
    priorPhysicalControls: {entry: 'original check.sh native/stub in SAME job', reexecutedByThisHook: false},
    V4PrincipalAdmission: false, RootAdmission: false, SourceAdmission: false, installed: false, deployed: false};
  json('RESULT.json', receipt);
  if (failure) throw failure;
  return {result: path.join(publicRoot, 'RESULT.json'), state: receipt.state, testsPassed: qualification.pass};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  requireValue(process.argv.length === 2, 'no config/URL/provider arguments; use explicit original CI evidence/private environment');
  console.log(JSON.stringify(runServerTLSCI()));
}
