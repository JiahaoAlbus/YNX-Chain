import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../..');
const linkCommit = '8df4139adb14c68d93e0a55a56851399d46059ac';
const packagePath = 'cmd/ynx-artifact-release-cabi';
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--core-handoff', '--core-sha256', '--auth-headers', '--auth-headers-sha256', '--native-undefined', '--native-undefined-sha256', '--out'].includes(key) || !value || options.has(key)) throw Error('complete pinned Core/Auth/Native inputs and a new output directory required');
  options.set(key, value);
}
if (options.size !== 7 || process.platform !== 'darwin') throw Error('seven build arguments and a native Darwin host required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const describe = file => {const bytes = fs.readFileSync(file); return {path: file, bytes: bytes.length, sha256: hash(bytes)};};
function pinned(file, sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw Error('SHA256 required');
  const absolute = path.resolve(file), bytes = fs.readFileSync(absolute);
  if (hash(bytes) !== sha256) throw Error('pinned input changed: ' + absolute);
  return {descriptor: {path: absolute, bytes: bytes.length, sha256}, value: JSON.parse(bytes)};
}
const core = pinned(options.get('--core-handoff'), options.get('--core-sha256'));
const auth = pinned(options.get('--auth-headers'), options.get('--auth-headers-sha256'));
const undefinedInput = pinned(options.get('--native-undefined'), options.get('--native-undefined-sha256'));
if (core.value.version !== 'YNX-CORE-MACOS-SINGLE-GO-IMAGE-PUBLIC-SOURCE-SUPPLY/v1' ||
    core.value.source?.module !== 'github.com/JiahaoAlbus/YNX-Chain' ||
    core.value.source?.go !== '1.26.10' || core.value.LINKReadOnlyComposition?.sourceCommit !== linkCommit ||
    !Array.isArray(core.value.sources) || core.value.sources.length !== 65 ||
    core.value.exports?.length !== 14 || auth.value.version !== 1 || !Array.isArray(auth.value.headers) ||
    !Array.isArray(undefinedInput.value.unresolvedCore)) throw Error('matching complete original supply contract required');
const output = path.resolve(options.get('--out'));
if (output === repository || output.startsWith(repository + path.sep)) throw Error('output must be outside the source worktree');
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.mkdirSync(output); // Never replace an uncertain prior build or receipt.
const source = path.join(output, 'source'), include = path.join(output, 'include');
fs.mkdirSync(source); fs.mkdirSync(include);
const commands = [], sources = [], headerRows = [];
function run(command, args, name, cwd = source, env = process.env) {
  const result = spawnSync(command, args, {cwd, env, encoding: 'utf8', maxBuffer: 64 << 20});
  const file = path.join(output, name);
  fs.writeFileSync(file, (result.stdout ?? '') + (result.stderr ?? ''), {flag: 'wx'});
  commands.push({command, args, cwd, exit: result.status, signal: result.signal, log: describe(file)});
  if (result.error || result.status !== 0) throw result.error ?? Error(`${command} failed; preserved ${file}`);
  return result.stdout;
}
function relative(value) {
  if (typeof value !== 'string' || path.isAbsolute(value) || value !== path.posix.normalize(value) || value.startsWith('../') || value.includes('\\') || value.includes('\0')) throw Error('canonical source path required');
  return value;
}
function materialize(name, bytes, origin) {
  const target = path.join(source, relative(name));
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, bytes, {flag: 'wx'});
  sources.push({...describe(target), repositoryPath: name, origin});
  return target;
}
function gitObject(commit, name) {
  const result = spawnSync('git', ['show', commit + ':' + name], {cwd: repository, maxBuffer: 128 << 20});
  if (result.status !== 0) throw Error('pinned git object unavailable: ' + name);
  return result.stdout;
}
function copyHeader(name, bytes, owner, original) {
  if (!/^[A-Za-z0-9_.-]+\.h(?:pp)?$/.test(name)) throw Error('closed header basename required');
  const target = path.join(include, name);
  fs.writeFileSync(target, bytes, {flag: 'wx'});
  headerRows.push({owner, name, ...describe(target), original});
}
function goQuote(argument) {
  if (!argument.includes('"')) return '"' + argument + '"';
  if (!argument.includes("'")) return "'" + argument + "'";
  throw Error('Go build argument contains both quote characters');
}
let archive, failure, checkResult;
try {
  const expectedTree = run('git', ['ls-tree', '-r', core.value.source.commit, '--', ...core.value.sources.map(row => row.path)], 'core-git-tree.log', repository);
  const blobs = new Map(expectedTree.trim().split('\n').map(row => {const [meta, name] = row.split('\t'); return [name, meta.split(' ')[2]];}));
  for (const row of core.value.sources) {
    const name = relative(row.path), original = path.join(core.value.delivery.sourceDirectory, name), bytes = fs.readFileSync(original);
    if (bytes.length !== row.bytes || hash(bytes) !== row.sha256 || blobs.get(name) !== row.gitBlob) throw Error('Core source is not its original fixed Git bytes: ' + name);
    materialize(name, bytes, {owner: 'core', path: original, commit: core.value.source.commit, gitBlob: row.gitBlob});
    if (name.startsWith(packagePath + '/') && name.endsWith('.h')) copyHeader(path.basename(name), bytes, 'core', original);
  }
  // These are real replacement-module metadata from the SAME Core commit,
  // not fake modules or changes to its original go.mod/replaces.
  for (const name of ['third_party/cometbft/go.mod', 'third_party/cometbft/go.sum']) {
    materialize(name, gitObject(core.value.source.commit, name), {owner: 'core-replacement-context', commit: core.value.source.commit});
  }
  const linkNames = run('git', ['ls-tree', '-r', '--name-only', linkCommit, '--', 'internal/securelink'], 'link-source-paths.log', repository).trim().split('\n').filter(Boolean);
  for (const name of linkNames) materialize(name, gitObject(linkCommit, name), {owner: 'link', commit: linkCommit});
  for (const name of ['private_client_v1.h', 'private_client_startup_v1.h']) {
    const original = 'cmd/ynx-secure-link-caller/' + name, bytes = gitObject(linkCommit, original);
    materialize(original, bytes, {owner: 'link', commit: linkCommit});
    copyHeader(name, bytes, 'link', original);
  }
  const template = path.join(directory, 'combined-entry.go.in');
  const importLeaf = materialize(packagePath + '/link_transport_import.go', fs.readFileSync(template), {owner: 'link-composition', template: describe(template)});
  const authNames = new Set();
  for (const row of auth.value.headers) {
    if (authNames.has(row.name) || !path.isAbsolute(row.path ?? '')) throw Error('unique pinned Auth headers required');
    authNames.add(row.name);
    const bytes = fs.readFileSync(row.path);
    if (bytes.length !== row.bytes || hash(bytes) !== row.sha256) throw Error('Auth header changed: ' + row.name);
    copyHeader(row.name, bytes, 'auth', row.path);
  }
  for (const required of ['pay_root_transport_loan_private.h', 'pay_native_actual_context_private.h', 'pay_native_source_lease_private.h']) if (!authNames.has(required)) throw Error('missing original Auth header: ' + required);
  const goCache = path.join(output, 'go-cache'), goTmp = path.join(output, 'go-tmp');
  fs.mkdirSync(goCache); fs.mkdirSync(goTmp);
  const env = {...process.env, CGO_ENABLED: '1', GOMAXPROCS: '2', GOWORK: 'off', GOCACHE: goCache, GOTMPDIR: goTmp, CGO_CFLAGS: goQuote('-I' + include)};
  const goEnv = JSON.parse(run('go', ['env', '-json', 'GOVERSION', 'GOOS', 'GOARCH', 'CC', 'CGO_ENABLED', 'GOWORK', 'GOCACHE', 'GOMODCACHE'], 'go-environment.json', source, env));
  if (goEnv.GOVERSION !== 'go1.26.10' || goEnv.GOOS !== 'darwin' || goEnv.GOARCH !== ({arm64: 'arm64', x64: 'amd64'})[process.arch]) throw Error('original native Go toolchain/architecture required');
  run('go', ['list', '-mod=readonly', '-p', '1', '-deps', '-json', '-tags=securelink_openssl,securelink_pay_native_startup', './' + packagePath], 'go-packages.json', source, env);
  archive = path.join(output, 'libynx_artifact_release.a');
  run('go', ['build', '-mod=readonly', '-p', '1', '-trimpath', '-tags=securelink_openssl,securelink_pay_native_startup', '-buildmode=c-archive', '-o', archive, './' + packagePath], 'combined-build.log', source, env);
  const generated = archive.replace(/\.a$/, '.h');
  if (!fs.existsSync(generated)) throw Error('original Core export generated header missing');
  copyHeader(path.basename(generated), fs.readFileSync(generated), 'generated', generated);
  const checkerPlan = {version: 1, goArchives: [describe(archive)],
    coreSources: sources.filter(row => row.repositoryPath.startsWith(packagePath + '/') && row.repositoryPath.endsWith('.go') && row.path !== importLeaf),
    headers: headerRows.filter(row => ['core', 'link'].includes(row.owner)),
    nativeUndefined: [undefinedInput.descriptor], linkerInputs: [describe(archive)]};
  const planFile = path.join(output, 'SYMBOL-PLAN.json');
  fs.writeFileSync(planFile, JSON.stringify(checkerPlan, null, 2) + '\n', {flag: 'wx'});
  const checker = await import('./combined-archive-symbols.mjs');
  checkResult = checker.checkCombinedArchive(checkerPlan);
  fs.writeFileSync(path.join(output, 'SYMBOL-RESULT.json'), JSON.stringify(checkResult, null, 2) + '\n', {flag: 'wx'});
  for (const row of [...sources, ...headerRows]) {
    if (describe(row.path).sha256 !== row.sha256) throw Error('materialized source/header changed during build');
  }
  for (const dependency of [core, auth, undefinedInput]) if (describe(dependency.descriptor.path).sha256 !== dependency.descriptor.sha256) throw Error('handoff changed during build');
} catch (error) { failure = error; }
const receipt = {version: 1, state: failure ? 'FAILED_OUTPUT_RETAINED' : 'COMBINED_CORE_LINK_ARCHIVE_VERIFIED_NOT_DEPLOYED',
  coreHandoff: core.descriptor, authHeaders: auth.descriptor, nativeUndefined: undefinedInput.descriptor,
  coreCommit: core.value.source.commit, linkCommit, soleMain: packagePath + '/core.go',
  source: sources, headers: headerRows, commands,
  archive: archive && fs.existsSync(archive) ? describe(archive) : null,
  symbols: checkResult ?? null, failure: failure?.message ?? null,
  builder: describe(fileURLToPath(import.meta.url)), template: describe(path.join(directory, 'combined-entry.go.in')),
  goBuildInvocations: commands.filter(row => row.command === 'go' && row.args[0] === 'build').length,
  sameNormalNativeImageLinked: false, RootAdmission: false, SourceAdmission: false, installed: false, deployed: false};
const receiptFile = path.join(output, 'BUILD-RECEIPT.json');
fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
if (failure) throw failure;
console.log(JSON.stringify({archive: receipt.archive, receipt: describe(receiptFile)}));
