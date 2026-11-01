import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Build inputs are source dependencies, never runtime Root registrations.
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, '../..');
const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!['--inputs', '--inputs-sha256', '--out'].includes(args[i]) ||
      options.has(args[i]) || !args[i + 1]) throw Error('usage: node build-startup.mjs --inputs FILE --inputs-sha256 SHA256 --out NEW_DIRECTORY');
  options.set(args[i], args[i + 1]);
}
if (options.size !== 3 || !/^[0-9a-f]{64}$/.test(options.get('--inputs-sha256') ?? '')) throw Error('complete pinned build inputs required');
if (process.platform !== 'darwin') throw Error('this normal Root image composition requires Darwin; no cross-platform Root claim');
const output = path.resolve(options.get('--out'));
if (output === repository || output.startsWith(repository + path.sep)) throw Error('build output must be outside the source worktree');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const describe = file => { const bytes = fs.readFileSync(file); return {path: file, bytes: bytes.length, sha256: digest(bytes)}; };
const inputPath = path.resolve(options.get('--inputs'));
const inputBytes = fs.readFileSync(inputPath);
if (digest(inputBytes) !== options.get('--inputs-sha256')) throw Error('build input manifest hash mismatch');
const input = JSON.parse(inputBytes);
if (input.version !== 1 || !Array.isArray(input.headers) || input.headers.length < 2 || input.headers.length > 32) throw Error('bounded header manifest required');
const headers = new Map();
for (const entry of input.headers) {
  if (!entry || !/^[A-Za-z0-9_.-]+\.h(?:pp)?$/.test(entry.name ?? '') ||
      headers.has(entry.name) || !path.isAbsolute(entry.path ?? '') ||
      !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 131072 ||
      !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '') ||
      ['private_client_v1.h', 'private_client_startup_v1.h'].includes(entry.name)) throw Error('invalid or duplicate Auth header dependency');
  const actual = describe(entry.path);
  if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw Error(`Auth header readback mismatch: ${entry.name}`);
  headers.set(entry.name, entry);
}
const rootHeader = headers.get('pay_root_transport_loan_private.h');
if (!rootHeader || rootHeader.sha256 !== 'df01e639f2909d5ad370db6eac9b6f2bca17a801a85805d0b38ef171bd030e47') throw Error('matching original Root transport C ABI required');
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.mkdirSync(output); // An existing or uncertain prior output is never replaced.
const include = path.join(output, 'include');
fs.mkdirSync(include);
const copied = [];
for (const [name, entry] of headers) {
  const bytes = fs.readFileSync(entry.path);
  if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw Error(`Auth header changed before copy: ${name}`);
  const target = path.join(include, name);
  fs.writeFileSync(target, bytes, {flag: 'wx'});
  copied.push({...describe(target), original: entry.path});
}
for (const name of ['private_client_v1.h', 'private_client_startup_v1.h']) {
  const source = path.join(repository, 'cmd/ynx-secure-link-caller', name);
  const target = path.join(include, name);
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  copied.push({...describe(target), original: source});
}
// Go's quoted.Split recognizes a quote at the beginning of an argument.
// Quote the complete -I argument; embedded quotes would become path bytes.
const environment = {...process.env, GOMAXPROCS: '2', CGO_ENABLED: '1', CGO_CFLAGS: JSON.stringify(`-I${include}`)};
const commands = [];
function run(command, commandArgs, logName) {
  const result = spawnSync(command, commandArgs, {cwd: repository, env: environment, encoding: 'utf8', maxBuffer: 64 << 20});
  const log = path.join(output, logName);
  fs.writeFileSync(log, (result.stdout ?? '') + (result.stderr ?? ''), {flag: 'wx'});
  commands.push({command, args: commandArgs, exit: result.status, signal: result.signal, log: describe(log)});
  if (result.error || result.status !== 0) throw result.error ?? Error(`${command} failed; retained ${log}`);
  return result.stdout;
}
const tags = 'securelink_openssl,securelink_pay_native_startup';
const sourceNames = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--',
  'internal/securelink', 'cmd/ynx-secure-link-private-client',
  'cmd/ynx-secure-link-caller/private_client_v1.h', 'cmd/ynx-secure-link-caller/private_client_startup_v1.h', 'go.mod', 'go.sum'], 'source-paths.log').trim().split('\n').filter(Boolean);
const sourceBefore = sourceNames.map(name => ({repositoryPath: name, ...describe(path.join(repository, name))}));
const archive = path.join(output, 'libynx_link_pay_native_startup.a');
let failure;
try {
  run('go', ['version'], 'go-version.log');
  const goEnvironment = JSON.parse(run('go', ['env', '-json', 'GOVERSION', 'GOOS', 'GOARCH', 'CGO_ENABLED', 'CC', 'CXX', 'GOFLAGS', 'GOTOOLCHAIN'], 'go-environment.json'));
  if (goEnvironment.GOOS !== 'darwin' || goEnvironment.GOARCH !== ({arm64: 'arm64', x64: 'amd64'})[process.arch]) throw Error('archive must match this normal Native host');
  run('go', ['list', '-mod=readonly', '-p', '1', '-deps', '-json', '-tags=' + tags, './cmd/ynx-secure-link-private-client'], 'go-packages.json');
  run('go', ['build', '-mod=readonly', '-p', '1', '-tags=' + tags, '-buildmode=c-archive', '-o', archive, './cmd/ynx-secure-link-private-client'], 'archive-build.log');
  const symbols = run('nm', ['-g', archive], 'archive-symbols.log');
  for (const operation of ['open', 'adopt_source', 'retire', 'join', 'close', 'closed', 'free', 'error']) {
    if (!new RegExp(`\\bT _?ynx_link_pay_native_startup_${operation}_v1\\b`).test(symbols)) throw Error(`normal startup definition missing: ${operation}`);
  }
  for (const getter of ['profile_read', 'fence']) {
    if (!new RegExp(`\\bU _?ynx_wallet_pay_root_transport_${getter}_v1\\b`).test(symbols)) throw Error(`strong original Auth getter dependency missing: ${getter}`);
  }
  if (/\b[UT] _?ynx_link_private_fixture_/.test(symbols)) throw Error('fixture installer in normal startup archive');
  for (const before of sourceBefore) {
    if (describe(before.path).sha256 !== before.sha256) throw Error(`source changed during build: ${before.repositoryPath}`);
  }
  for (const header of copied) {
    if (describe(header.original).sha256 !== header.sha256 || describe(header.path).sha256 !== header.sha256) throw Error('header dependency changed during build');
  }
  if (digest(fs.readFileSync(inputPath)) !== options.get('--inputs-sha256')) throw Error('build input manifest changed during build');
} catch (error) {
  failure = error;
}
const receipt = {
  version: 1, state: failure ? 'FAILED_ARTIFACT_RETAINED' : 'NORMAL_STARTUP_ARCHIVE_BUILT_NOT_QUALIFIED',
  inputManifest: {path: inputPath, bytes: inputBytes.length, sha256: digest(inputBytes)}, headers: copied, source: sourceBefore, commands,
  sourceIdentity: 'explicit source-tree fingerprints; compiled package list separately recorded',
  build: {tags, mode: 'c-archive', GOMAXPROCS: 2, CGO_ENABLED: 1, CGO_CFLAGS: environment.CGO_CFLAGS},
  archive: fs.existsSync(archive) ? describe(archive) : null,
  failure: failure?.message ?? null,
  finalAuthSymbolsResolved: false, sameNormalImageLinked: false,
  RootAdmission: false, SourceAdmission: false, installed: false, deployed: false,
};
const receiptPath = path.join(output, 'BUILD-RECEIPT.json');
fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
if (failure) throw failure;
console.log(JSON.stringify({archive: receipt.archive, receipt: describe(receiptPath)}));
