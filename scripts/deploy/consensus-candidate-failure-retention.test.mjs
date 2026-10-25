import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const relative = 'scripts/deploy/deploy-consensus-candidate.sh';
const current = readFileSync(join(root, relative), 'utf8');
const original = execFileSync('git', ['show', `5294cb2d91ced414ee16edde39318de017404e53:${relative}`], { cwd: root, encoding: 'utf8' });
// These are the exact pre-fix deployment-script bytes published with efdf467a.
// Pin the reachable blob, not the unpublished main-side commit whose identical
// change was cherry-picked into integration (and need not exist in CI history).
const originalStage = execFileSync('git', ['show', '6a2b54bd653b841cb21bc605c48e1c378dbb1775'], { cwd: root, encoding: 'utf8' });
// Exact normal caller used by the failed macOS preparation. Retain the real
// historical function rather than implementing a second preparer in this test.
const originalRuntimePreparation = execFileSync('git', ['show', `c979d1c42e775dcac69555f6cd7b76f304c5917e:${relative}`], { cwd: root, encoding: 'utf8' });
assert.equal(Buffer.byteLength(originalRuntimePreparation), 18927);
assert.equal(createHash('sha256').update(originalRuntimePreparation).digest('hex'), 'f10700ed58cc9accb45c488b795a49e65520497918288dcfb356bed23ec4f176');
const operations = readFileSync(join(root, 'scripts/ops/lib.sh'), 'utf8');

function actualFunction(source, name) {
  const body = source.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'm'))?.[0];
  assert.ok(body, `actual ${name} function missing`);
  return body;
}

function savedPath(path) {
  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) return { kind: 'symlink', target: readlinkSync(path) };
    if (info.isDirectory()) return { kind: 'directory' };
    return { kind: 'file', bytes: readFileSync(path) };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

// Execute the production role/verification functions and the real ynx_ops_copy /
// ynx_ops_ssh wrappers. Only their transport is replaced: the command runs under
// a private temporary root, with sudo/stat/sha256sum/systemctl platform stubs.
// No complete deployment script, SSH, Go, builder or real service is launched.
function roleStage(source, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ynx-candidate-stage-'));
  const remote = join(directory, 'remote');
  const work = join(directory, 'work');
  const packageRoot = join(directory, 'package');
  const release = 'ynx-consensus-candidate-isolated';
  const role = options.role ?? 'singapore';
  const remoteDir = join(remote, 'opt/ynx-chain/consensus-candidates', release, role);
  const remoteArchive = join(remote, 'tmp', `${release}-${role}.tar.gz`);
  const localStage = join(work, 'roles', role);
  const localArchive = join(work, `${release}-${role}.tar.gz`);
  const marker = join(remoteDir, 'unknown-original-marker');
  const oldArchive = Buffer.from('original UNKNOWN archive bytes\0\xff', 'latin1');
  try {
    for (const path of [join(remote, 'tmp'), join(remote, 'opt/ynx-chain/consensus-candidates'), join(remote, 'var/lib/ynx-chain/consensus-candidate/bin'), join(work, 'bin'), join(work, 'roles'), join(packageRoot, 'roles', role, 'scripts')]) mkdirSync(path, { recursive: true, mode: 0o700 });
    const executable = (path, body) => writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o700 });
    for (const binary of ['ynx-abci', 'cometbft']) executable(join(work, 'bin', binary), 'exit 0');
    for (const binary of ['ynx-bft-gatewayd', 'ynx-indexerd', 'ynx-explorerd', 'ynx-faucetd', 'ynx-ai-gatewayd', 'ynx-payd', 'ynx-trustd', 'ynx-resourced']) executable(join(work, 'bin', binary), 'exit 0');
    writeFileSync(join(work, 'runtime-SOURCE.json'), '{"fixture":"retained pinned runtime identity"}\n');
    const paused = ['ynx-ai-gatewayd', 'ynx-payd', 'ynx-trustd'];
    for (const name of paused) writeFileSync(join(remote, 'var/lib/ynx-chain/consensus-candidate/bin', name), `original paused ${name} bytes`);
    executable(join(work, 'bin', 'ynx-consensus-keycheck'), 'printf "keycheck\\n" >> "$YNX_STAGE_EVENTS"; exit "${YNX_STAGE_KEYCHECK_EXIT:-0}"');
    for (const [name, status] of [['backup', '0'], ['install', '${YNX_STAGE_INSTALL_EXIT:-0}'], ['verify', '${YNX_STAGE_VERIFY_EXIT:-0}']]) executable(join(packageRoot, 'roles', role, 'scripts', `${name}-candidate.sh`), `printf '${name}\\n' >> "$YNX_STAGE_EVENTS"; exit "${status}"`);
    writeFileSync(join(packageRoot, 'roles', role, 'role-manifest.json'), '{"fixture":"only"}\n');
    if (options.existingRelease === 'directory') { mkdirSync(remoteDir, { recursive: true }); writeFileSync(marker, 'original staged UNKNOWN'); }
    if (options.existingRelease === 'file') { mkdirSync(dirname(remoteDir), { recursive: true }); writeFileSync(remoteDir, 'original release file'); }
    if (options.existingRelease === 'symlink') { mkdirSync(dirname(remoteDir), { recursive: true }); symlinkSync(join(directory, 'absent-release-target'), remoteDir); }
    if (options.existingArchive === 'file') writeFileSync(remoteArchive, oldArchive, { mode: 0o600 });
    if (options.existingArchive === 'directory') mkdirSync(remoteArchive);
    if (options.existingArchive === 'symlink') symlinkSync(join(directory, 'absent-archive-target'), remoteArchive);
    if (options.localStage) { mkdirSync(localStage); writeFileSync(join(localStage, 'old'), 'local staged UNKNOWN'); }
    if (options.localArchive) writeFileSync(localArchive, oldArchive, { mode: 0o600 });
    const before = { release: savedPath(remoteDir), archive: savedPath(remoteArchive), localArchive: savedPath(localArchive) };
    const remotePrefix = [
      'set -Eeuo pipefail',
      'sudo() {',
      '  printf "sudo %s\\n" "$*" >> "$YNX_STAGE_TRACE"',
      '  if [[ "$1" == mkdir && "${!#}" == "$YNX_STAGE_REMOTE_DIR" ]]; then',
      '    if [[ "${YNX_STAGE_RESERVATION_RACE:-}" == release ]]; then command mkdir -p "$YNX_STAGE_REMOTE_DIR"; printf "competing release" > "$YNX_STAGE_REMOTE_DIR/unknown-original-marker"; fi',
      '    if [[ "${YNX_STAGE_RESERVATION_RACE:-}" == archive ]]; then printf "competing UNKNOWN archive" > "$YNX_STAGE_REMOTE_ARCHIVE"; fi',
      '  fi',
      // Owner/group flags are normal production install arguments. Drop only
      // those attributes in this unprivileged temporary transport fixture.
      '  if [[ "$1" == install ]]; then',
      '    shift; local -a args=(); while (($#)); do case "$1" in -o|-g) shift 2;; *) args+=("$1"); shift;; esac; done; command install "${args[@]}"',
      '  else "$@"; fi',
      '}',
      process.platform === 'darwin' ? 'stat() { if [[ "$1" == -c && "$2" == %a ]]; then command stat -f %OLp "$3"; else command stat "$@"; fi; }' : 'stat() { command stat "$@"; }',
      'sha256sum() { command shasum -a 256 "$@"; }',
      'systemctl() { [[ "$*" == "is-active ynx-chaind" ]] || return 91; printf "systemctl\\n" >> "$YNX_STAGE_EVENTS"; }',
    ].join('\n');
    const transport = [
      'ynx_transport_ssh() {',
      '  local label="$1" command="$4" status=0 prefix replacement',
      '  printf "%s\\n" "$label" >> "$YNX_STAGE_TRACE"',
      '  prefix=/tmp/; replacement="$YNX_STAGE_REMOTE/tmp/"; command="${command//$prefix/$replacement}"',
      '  prefix=/opt/ynx-chain/; replacement="$YNX_STAGE_REMOTE/opt/ynx-chain/"; command="${command//$prefix/$replacement}"',
      '  prefix=/var/lib/ynx-chain/; replacement="$YNX_STAGE_REMOTE/var/lib/ynx-chain/"; command="${command//$prefix/$replacement}"',
      '  prefix=/var/backups/ynx-chain/; replacement="$YNX_STAGE_REMOTE/var/backups/ynx-chain/"; command="${command//$prefix/$replacement}"',
      '  prefix=/etc/ynx/; replacement="$YNX_STAGE_REMOTE/etc/ynx/"; command="${command//$prefix/$replacement}"',
      '  bash -c "$YNX_STAGE_REMOTE_PREFIX' + '\n' + '$command" || status=$?',
      '  if [[ "$label" == *" ops copy" && "$status" == 0 ]]; then',
      '    cp "$YNX_STAGE_REMOTE_ARCHIVE" "$YNX_STAGE_COPY_OBSERVED"',
      '    if [[ "${YNX_STAGE_COPY_UNKNOWN:-0}" == 1 ]]; then return 31; fi',
      '    if [[ "${YNX_STAGE_TAMPER_COPY:-0}" == 1 ]]; then printf tampered >> "$YNX_STAGE_REMOTE_ARCHIVE"; fi',
      '  fi',
      '  return "$status"',
      '}',
    ].join('\n');
    const script = ['set -Eeuo pipefail', 'package_root="$YNX_STAGE_PACKAGE"', 'work="$YNX_STAGE_WORK"', `release=${release}`, transport, actualFunction(operations, 'ynx_ops_copy'), actualFunction(operations, 'ynx_ops_ssh'), actualFunction(source, 'deploy_candidate_role'), actualFunction(source, 'verify_candidate_role'), `deploy_candidate_role ${role} fixture unused.invalid unused validator`, ...(options.verify ? [`verify_candidate_role ${role} fixture unused.invalid unused validator`] : [])].join('\n');
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, DEPLOY_DRY_RUN: '0', YNX_STAGE_PACKAGE: packageRoot, YNX_STAGE_WORK: work, YNX_STAGE_REMOTE: remote, YNX_STAGE_REMOTE_DIR: remoteDir, YNX_STAGE_REMOTE_ARCHIVE: remoteArchive, YNX_STAGE_COPY_OBSERVED: join(directory, 'copy-observed'), YNX_STAGE_REMOTE_PREFIX: remotePrefix, YNX_STAGE_TRACE: join(directory, 'trace'), YNX_STAGE_EVENTS: join(directory, 'events'), YNX_STAGE_KEYCHECK_EXIT: String(options.keycheckExit ?? 0), YNX_STAGE_INSTALL_EXIT: String(options.installExit ?? 0), YNX_STAGE_VERIFY_EXIT: String(options.verifyExit ?? 0), YNX_STAGE_COPY_UNKNOWN: options.copyUnknown ? '1' : '0', YNX_STAGE_TAMPER_COPY: options.tamperCopy ? '1' : '0', YNX_STAGE_RESERVATION_RACE: options.reservationRace ?? '' } });
    assert.equal(result.error, undefined);
    const trace = existsSync(join(directory, 'trace')) ? readFileSync(join(directory, 'trace'), 'utf8') : '';
    return { status: result.status, stderr: result.stderr, before, release: savedPath(remoteDir), archive: savedPath(remoteArchive), localArchive: savedPath(localArchive), oldArchive, marker: existsSync(marker) ? readFileSync(marker, 'utf8') : null, staged: savedPath(join(remoteDir, 'role/role-manifest.json')), localMarker: existsSync(join(localStage, 'old')) ? readFileSync(join(localStage, 'old'), 'utf8') : null, copied: savedPath(join(directory, 'copy-observed')), copyCount: trace.split('\n').filter(line => line === `${role} ops copy`).length, trace, events: existsSync(join(directory, 'events')) ? readFileSync(join(directory, 'events'), 'utf8').trim().split('\n') : [], paused: Object.fromEntries(paused.map(name => [name, { staged: savedPath(join(remoteDir, 'bin', name)), installed: savedPath(join(remote, 'var/lib/ynx-chain/consensus-candidate/bin', name)) }])), runtimeSource: savedPath(join(remoteDir, 'runtime-SOURCE.json')) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function exitHook(source, started, complete, status) {
  const body = source.match(/^cleanup_failed_candidate_deploy\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert.ok(body, 'actual deployment exit hook missing');
  const directory = mkdtempSync(join(tmpdir(), 'ynx-candidate-retention-'));
  try {
    const marker = join(directory, 'remote-operation-attempted');
    // Only the actual exit hook is executed. The deployment script, builders,
    // SSH transport and real services are never started. A stub records any
    // attempted cross-role cleanup without performing it.
    const script = `set -Eeuo pipefail\nrelease=isolated-fixture\ncandidate_mutation_started=${started}\ndeployment_complete=${complete}\nynx_ops_each_node() { : > "$YNX_RETENTION_MARKER"; }\n${body}\ntrap cleanup_failed_candidate_deploy EXIT\nexit ${status}\n`;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, YNX_RETENTION_MARKER: marker } });
    assert.equal(result.error, undefined);
    assert.equal(result.status, status, 'original failure status changed');
    return { attemptedRemoteCleanup: existsSync(marker), stderr: result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('original failure control attempts cross-role cleanup after a partial deployment', () => {
  assert.equal(exitHook(original, 1, 0, 19).attemptedRemoteCleanup, true);
});

test('partial failure retains services, ledger and signer history without remote cleanup', () => {
  const result = exitHook(current, 1, 0, 19);
  assert.equal(result.attemptedRemoteCleanup, false);
  assert.match(result.stderr, /state, signer history, backups and staged artifacts are retained/);
});

test('successful and pre-mutation exits preserve status and perform no recovery writes', () => {
  for (const [started, complete, status] of [[1, 1, 0], [0, 0, 19]]) {
    const result = exitHook(current, started, complete, status);
    assert.equal(result.attemptedRemoteCleanup, false);
    assert.equal(result.stderr, '');
  }
});

test('original role staging really deletes the old marker, overwrites its archive, then deletes the package on failure', () => {
  const result = roleStage(originalStage, { existingRelease: 'directory', existingArchive: 'file', keycheckExit: 23 });
  assert.equal(result.status, 23, result.stderr);
  assert.equal(result.copyCount, 1);
  assert.equal(result.marker, null);
  assert.notDeepEqual(result.copied.bytes, result.oldArchive);
  assert.deepEqual(result.copied, result.localArchive);
  assert.equal(result.archive, null);
  assert.equal(result.staged.kind, 'file');
});

test('existing remote release or UNKNOWN archive refuses before copy and preserves every original byte', async t => {
  for (const options of [{ existingRelease: 'directory', existingArchive: 'file' }, { existingRelease: 'file' }, { existingRelease: 'symlink' }, { existingArchive: 'file' }, { existingArchive: 'directory' }, { existingArchive: 'symlink' }]) {
    await t.test(JSON.stringify(options), () => {
      const result = roleStage(current, options);
      assert.notEqual(result.status, 0, result.stderr);
      assert.equal(result.copyCount, 0, result.stderr);
      assert.deepEqual(result.release, result.before.release);
      assert.deepEqual(result.archive, result.before.archive);
      if (options.existingRelease === 'directory') assert.equal(result.marker, 'original staged UNKNOWN');
      assert.deepEqual(result.events, []);
    });
  }
});

test('new release stages and verifies once while retaining the exact original archive', () => {
  const result = roleStage(current, { verify: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.copyCount, 1);
  assert.equal(result.staged.kind, 'file');
  assert.deepEqual(result.archive, result.localArchive);
  assert.deepEqual(result.events, ['keycheck', 'backup', 'install', 'verify', 'systemctl']);
});

test('keycheck, install and verify failures retain staged files and exact package without retry', async t => {
  for (const [options, status] of [[{ keycheckExit: 23 }, 23], [{ installExit: 27 }, 27], [{ verify: true, verifyExit: 29 }, 29]]) {
    await t.test(JSON.stringify(options), () => {
      const result = roleStage(current, options);
      assert.equal(result.status, status, result.stderr);
      assert.equal(result.copyCount, 1);
      assert.equal(result.staged.kind, 'file');
      assert.deepEqual(result.archive, result.localArchive);
    });
  }
});

test('copy UNKNOWN and checksum failure preserve original transferred bytes without extraction or retry', async t => {
  for (const options of [{ copyUnknown: true }, { tamperCopy: true }]) {
    await t.test(JSON.stringify(options), () => {
      const result = roleStage(current, options);
      assert.notEqual(result.status, 0, result.stderr);
      if (options.copyUnknown) assert.equal(result.status, 31);
      assert.equal(result.copyCount, 1);
      assert.equal(result.release.kind, 'directory');
      assert.equal(result.staged, null);
      assert.equal(result.archive.kind, 'file');
      assert.deepEqual(result.archive.bytes, options.tamperCopy ? Buffer.concat([result.localArchive.bytes, Buffer.from('tampered')]) : result.localArchive.bytes);
      assert.deepEqual(result.events, []);
    });
  }
});

test('existing local role artifacts also fail closed instead of deleting or overwriting UNKNOWN bytes', () => {
  for (const options of [{ localStage: true }, { localArchive: true }]) {
    const result = roleStage(current, options);
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(result.copyCount, 0);
    if (options.localStage) assert.equal(result.localMarker, 'local staged UNKNOWN');
    if (options.localArchive) assert.deepEqual(result.localArchive, result.before.localArchive);
  }
});

test('a competing reservation after the preflight check cannot be overwritten by copy or stage', () => {
  for (const reservationRace of ['release', 'archive']) {
    const result = roleStage(current, { reservationRace });
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(result.copyCount, 0);
    assert.equal(result.staged, null);
    assert.deepEqual(result.events, []);
    if (reservationRace === 'release') assert.equal(result.marker, 'competing release');
    else assert.deepEqual(result.archive.bytes, Buffer.from('competing UNKNOWN archive'));
  }
});

function prepareWorkspace(source, existing) {
  const body = source.match(/^work_root=.*\n[\s\S]*?(?=^echo "(?:building production candidate binaries|verifying pinned production candidate runtime))/m)?.[0];
  assert.ok(body, 'actual local workspace preparation missing');
  const directory = mkdtempSync(join(tmpdir(), 'ynx-candidate-workspace-'));
  const work = join(directory, 'isolated-release');
  const marker = join(work, 'retained-package.tar.gz');
  try {
    if (existing) { mkdirSync(work); writeFileSync(marker, 'local UNKNOWN package'); }
    const result = spawnSync('bash', ['-c', `set -Eeuo pipefail\nrelease=isolated-release\n${body}`], { encoding: 'utf8', env: { ...process.env, CONSENSUS_CANDIDATE_WORK_ROOT: directory } });
    assert.equal(result.error, undefined);
    return { status: result.status, marker: existsSync(marker) ? readFileSync(marker, 'utf8') : null, bin: existsSync(join(work, 'bin')), roles: existsSync(join(work, 'roles')) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('actual top-level workspace preparation preserves an existing attempt and permits a new release', () => {
  const old = prepareWorkspace(originalStage, true);
  assert.equal(old.status, 0);
  assert.equal(old.marker, null, 'original destructive workspace control did not execute');
  const existing = prepareWorkspace(current, true);
  assert.notEqual(existing.status, 0);
  assert.equal(existing.marker, 'local UNKNOWN package');
  assert.equal(existing.bin, false);
  assert.equal(existing.roles, false);
  assert.deepEqual(prepareWorkspace(current, false), { status: 0, marker: null, bin: true, roles: true });
});

test('original primary staging installs paused products; current path retains their exact bytes without staging or running them', () => {
  const before = roleStage(originalStage, { role: 'primary' });
  assert.equal(before.status, 0, before.stderr);
  const after = roleStage(current, { role: 'primary', verify: true });
  assert.equal(after.status, 0, after.stderr);
  for (const name of ['ynx-ai-gatewayd', 'ynx-payd', 'ynx-trustd']) {
    assert.equal(before.paused[name].staged.kind, 'file');
    assert.notDeepEqual(before.paused[name].installed.bytes, Buffer.from(`original paused ${name} bytes`));
    assert.equal(after.paused[name].staged, null);
    assert.deepEqual(after.paused[name].installed.bytes, Buffer.from(`original paused ${name} bytes`));
    assert.ok(!after.trace.includes(name), `paused product entered actual transport: ${name}`);
  }
  assert.equal(after.copyCount, 1);
  assert.equal(after.runtimeSource.kind, 'file');
  assert.deepEqual(after.events, ['keycheck', 'backup', 'install', 'verify', 'systemctl']);
});

const runtimeNames = ['ynx-abci', 'ynx-comet', 'ynx-bft-gatewayd', 'ynx-consensus-pq-remote-signer', 'ynx-consensus-pq-key-init', 'ynx-consensus-proof-verify', 'ynx-consensus-package', 'ynx-consensus-keycheck'];
const operatorNames = ['ynx-consensus-pq-remote-signer.service.in', 'ynx-consensus-pq-remote-signer-launch.sh', 'ynx-consensus-pq-remote-signer.conf.in'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const filePin = bytes => ({ bytes: bytes.length, sha256: sha256(bytes) });

function runtimeFixture(directory) {
  const bundle = join(directory, 'runtime');
  mkdirSync(join(bundle, 'operator'), { recursive: true, mode: 0o700 });
  // These bytes exercise ELF/header/integrity parsing only. No test executes
  // them or claims this fixture is an actual built runtime. CI separately uses
  // its eight real normal Go binaries for the complete dry-run caller.
  const binary = Buffer.alloc((1 << 20) + 64, 0x41);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(binary);
  binary.writeUInt16LE(2, 16);
  binary.writeUInt16LE(62, 18);
  binary.writeUInt32LE(1, 20);
  const binaries = {};
  for (const [index, name] of runtimeNames.entries()) {
    const bytes = Buffer.from(binary);
    bytes[64] = index;
    writeFileSync(join(bundle, name), bytes, { mode: 0o644 });
    binaries[name] = filePin(bytes);
  }
  const operator = {};
  for (const name of operatorNames) {
    const bytes = Buffer.from(`public inert parser fixture ${name}\n`);
    writeFileSync(join(bundle, 'operator', name), bytes, { mode: 0o600 });
    operator[name] = filePin(bytes);
  }
  const sourcePin = filePin(Buffer.from('public source metadata fixture'));
  const record = { version: 'YNX-PQ-LINUX-RUNTIME-CANDIDATE/v2', commit: 'a'.repeat(40), runId: '123456', platform: 'linux/amd64', cometForkTree: 'b'.repeat(40), goMod: sourcePin, goSum: sourcePin, proofVerifierContract: 'YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1', proofVerifierSources: Object.fromEntries(['internal/consensus/pq_light_proof.go', 'cmd/ynx-consensus-proof-verify/main.go', 'cmd/ynx-consensus-proof-verify/trust.go'].map(name => [name, sourcePin])), binaries, operator, runtimeStarted: false, publicDeployment: false, pqActivation: false, purpose: 'normal entrypoint binaries and operator configuration only; no keys, credentials, ledger or signing history' };
  const raw = Buffer.from(JSON.stringify(record) + '\n');
  writeFileSync(join(bundle, 'SOURCE.json'), raw, { mode: 0o600 });
  return { bundle, record, pin: sha256(raw), commit: record.commit };
}

function runtimeValidation(mutate = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ynx-runtime-pin-'));
  try {
    const fixture = runtimeFixture(directory);
    mutate(fixture, directory);
    const paths = ['SOURCE.json', ...runtimeNames, ...operatorNames.map(name => `operator/${name}`)];
    const before = Object.fromEntries(paths.map(name => [name, savedPath(join(fixture.bundle, name))]));
    // Sourcing the ACTUAL script must only define the parser, without loading
    // deploy env, reserving work, executing binaries or contacting transport.
    const script = 'set -Eeuo pipefail\nsource "$YNX_RUNTIME_SCRIPT"\nvalidate_runtime_bundle "$YNX_RUNTIME_BUNDLE" "$YNX_RUNTIME_COMMIT" "$YNX_RUNTIME_MANIFEST"';
    const result = spawnSync('bash', ['-c', script], { cwd: directory, encoding: 'utf8', env: { ...process.env, YNX_RUNTIME_SCRIPT: join(root, relative), YNX_RUNTIME_BUNDLE: fixture.bundle, YNX_RUNTIME_COMMIT: fixture.commit, YNX_RUNTIME_MANIFEST: fixture.pin } });
    assert.equal(result.error, undefined);
    for (const name of paths) assert.deepEqual(savedPath(join(fixture.bundle, name)), before[name], `validation changed original ${name}`);
    assert.equal(existsSync(join(directory, 'tmp')), false, 'parser invoked deployment work creation');
    return { status: result.status, stderr: result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function repinRuntime(fixture) {
  const raw = Buffer.from(JSON.stringify(fixture.record) + '\n');
  writeFileSync(join(fixture.bundle, 'SOURCE.json'), raw);
  fixture.pin = sha256(raw);
}

test('actual runtime parser accepts exactly the externally pinned v2 eight-binary artifact without running or rewriting it', () => {
  const result = runtimeValidation();
  assert.equal(result.status, 0, result.stderr);
});

test('actual runtime parser refuses missing pins, stale v1, altered bytes, false metadata and non-original files without fallback', async t => {
  const cases = {
    missing_commit: f => { f.commit = ''; },
    abbreviated_commit: f => { f.commit = f.commit.slice(0, 12); },
    wrong_commit: f => { f.commit = 'c'.repeat(40); },
    wrong_manifest: f => { f.pin = 'd'.repeat(64); },
    old_six_binary_version: f => { f.record.version = 'YNX-PQ-LINUX-RUNTIME-CANDIDATE/v1'; repinRuntime(f); },
    missing_verifier: f => { rmSync(join(f.bundle, 'ynx-consensus-package')); },
    altered_binary: f => { const path = join(f.bundle, 'ynx-abci'); const bytes = readFileSync(path); bytes[65] ^= 1; writeFileSync(path, bytes); },
    altered_operator: f => { writeFileSync(join(f.bundle, 'operator', operatorNames[0]), 'different'); },
    size_disagrees: f => { f.record.binaries['ynx-comet'].bytes++; repinRuntime(f); },
    numeric_size_string: f => { f.record.binaries['ynx-comet'].bytes = String(f.record.binaries['ynx-comet'].bytes); repinRuntime(f); },
    non_ELF_even_with_new_pin: f => { const path = join(f.bundle, 'ynx-comet'); const bytes = readFileSync(path); bytes[0] = 0; writeFileSync(path, bytes); f.record.binaries['ynx-comet'] = filePin(bytes); repinRuntime(f); },
    wrong_machine_even_with_new_pin: f => { const path = join(f.bundle, 'ynx-comet'); const bytes = readFileSync(path); bytes.writeUInt16LE(183, 18); writeFileSync(path, bytes); f.record.binaries['ynx-comet'] = filePin(bytes); repinRuntime(f); },
    extra_paused_binary: f => { writeFileSync(join(f.bundle, 'ynx-payd'), 'must not be staged'); },
    manifest_extra_binary: f => { f.record.binaries['ynx-payd'] = f.record.binaries['ynx-abci']; repinRuntime(f); },
    extra_operator: f => { writeFileSync(join(f.bundle, 'operator/activate.sh'), 'must not run'); },
    already_activated: f => { f.record.pqActivation = true; repinRuntime(f); },
    unknown_manifest_field: f => { f.record.fallback = true; repinRuntime(f); },
    duplicate_manifest_field: f => { const raw = Buffer.from('{"commit":"ignored",' + JSON.stringify(f.record).slice(1)); writeFileSync(join(f.bundle, 'SOURCE.json'), raw); f.pin = sha256(raw); },
    symlink_binary: (f, dir) => { const path = join(f.bundle, 'ynx-abci'); const target = join(dir, 'outside'); writeFileSync(target, readFileSync(path)); rmSync(path); symlinkSync(target, path); },
    hardlink_binary: (f, dir) => { linkSync(join(f.bundle, 'ynx-abci'), join(dir, 'alias')); },
    symlink_manifest: (f, dir) => { const path = join(f.bundle, 'SOURCE.json'); const target = join(dir, 'manifest'); writeFileSync(target, readFileSync(path)); rmSync(path); symlinkSync(target, path); },
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, () => {
    const result = runtimeValidation(mutate);
    assert.notEqual(result.status, 0, result.stderr);
    assert.match(result.stderr, /runtime bundle rejected:/);
  });
});

function runtimePreparation(mode, { source = current, bsdChmod = false } = {}) {
  // Darwin exposes its temporary root through /var -> /private/var. The
  // production parser correctly requires original canonical paths on both OSes.
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ynx-runtime-copy-')));
  try {
    const fixture = runtimeFixture(directory);
    const destination = join(directory, 'retained-runtime');
    const entries = ['SOURCE.json', ...runtimeNames, ...operatorNames.map(name => `operator/${name}`)];
    const before = Object.fromEntries(entries.map(name => [name, { value: savedPath(join(fixture.bundle, name)), mode: lstatSync(join(fixture.bundle, name)).mode }]));
    if (mode === 'existing_directory') { mkdirSync(destination); writeFileSync(join(destination, 'UNKNOWN'), 'original retained attempt'); }
    if (mode === 'existing_file') writeFileSync(destination, 'original retained file');
    if (mode === 'existing_symlink') symlinkSync(join(directory, 'absent-target'), destination);
    const oldDestination = savedPath(destination);
    if (mode === 'bad_pin') fixture.pin = 'e'.repeat(64);
    const trace = join(directory, 'copies');
    const chmodTrace = join(directory, 'chmod-calls');
    const script = [
      'set -Eeuo pipefail',
      'source "$YNX_RUNTIME_SCRIPT"',
      actualFunction(source, 'prepare_runtime_bundle'),
      ...(bsdChmod ? [
        // BSD chmod treats -- after a numeric mode as a file operand. As on
        // the actual Mac failure, it still changes the following file before
        // returning 1. GNU chmod would silently accept the same old argv.
        'chmod() {',
        '  printf "chmod\\n" >> "$YNX_RUNTIME_CHMOD_TRACE"',
        '  if [[ "$#" -ge 3 && "$1" == 0755 && "$2" == -- ]]; then',
        '    printf "chmod: --: No such file or directory\\n" >&2',
        '    shift 2; command chmod 0755 "$@" || return',
        '    return 1',
        '  fi',
        '  command chmod "$@"',
        '}',
      ] : []),
      'cp() {',
      '  command cp "$@" || return',
      '  printf "copy\\n" >> "$YNX_RUNTIME_TRACE"',
      '  if [[ "${!#}" == "$YNX_RUNTIME_DESTINATION/ynx-comet" ]]; then',
      '    if [[ "$YNX_RUNTIME_MODE" == copy_unknown ]]; then return 31; fi',
      '    if [[ "$YNX_RUNTIME_MODE" == copy_tamper ]]; then printf tampered >> "${!#}"; fi',
      '  fi',
      '}',
      'prepare_runtime_bundle "$YNX_RUNTIME_BUNDLE" "$YNX_RUNTIME_COMMIT" "$YNX_RUNTIME_MANIFEST" "$YNX_RUNTIME_DESTINATION"',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], { cwd: directory, encoding: 'utf8', env: { ...process.env, YNX_RUNTIME_SCRIPT: join(root, relative), YNX_RUNTIME_BUNDLE: fixture.bundle, YNX_RUNTIME_COMMIT: fixture.commit, YNX_RUNTIME_MANIFEST: fixture.pin, YNX_RUNTIME_DESTINATION: destination, YNX_RUNTIME_TRACE: trace, YNX_RUNTIME_CHMOD_TRACE: chmodTrace, YNX_RUNTIME_MODE: mode } });
    assert.equal(result.error, undefined);
    for (const name of entries) {
      const path = join(fixture.bundle, name);
      assert.deepEqual({ value: savedPath(path), mode: lstatSync(path).mode }, before[name], `preparation changed original ${name} bytes/mode`);
    }
    const copies = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').length : 0;
    const chmodCalls = existsSync(chmodTrace) ? readFileSync(chmodTrace, 'utf8').trim().split('\n').length : 0;
    const prepared = Object.fromEntries(runtimeNames.map(name => {
      const path = join(destination, name);
      return [name, { value: savedPath(path), mode: existsSync(path) ? lstatSync(path).mode & 0o777 : null }];
    }));
    return { status: result.status, stderr: result.stderr, copies, chmodCalls, oldDestination, destination: savedPath(destination), prepared, before, marker: existsSync(join(destination, 'UNKNOWN')) ? readFileSync(join(destination, 'UNKNOWN'), 'utf8') : null };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('actual runtime preparation makes only a verified private executable copy and preserves artifact 0644 originals', () => {
  const result = runtimePreparation('fresh');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.copies, 12);
  for (const name of runtimeNames) {
    assert.equal(result.before[name].mode & 0o777, 0o644);
    assert.equal(result.prepared[name].mode, 0o755);
    assert.deepEqual(result.prepared[name].value, result.before[name].value);
  }
});

test('actual runtime preparation reproduces original BSD chmod failure and retains the partially executable UNKNOWN copy', () => {
  const result = runtimePreparation('fresh', { source: originalRuntimePreparation, bsdChmod: true });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /chmod: --: No such file or directory/);
  assert.equal(result.copies, 12, 'the original caller must validate and copy before the real failing chmod');
  assert.equal(result.chmodCalls, 1, 'the failed original call must stop without retry');
  assert.equal(result.destination.kind, 'directory', 'UNKNOWN preparation must remain visible');
  for (const [index, name] of runtimeNames.entries()) {
    assert.equal(result.before[name].mode & 0o777, 0o644);
    assert.deepEqual(result.prepared[name].value, result.before[name].value);
    assert.equal(result.prepared[name].mode, index === 0 ? 0o755 : 0o644, 'retain the actual partial mode change; do not reset or delete it');
  }
});

test('actual runtime preparation uses portable chmod and completes all eight copies under BSD semantics', () => {
  const result = runtimePreparation('fresh', { bsdChmod: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.copies, 12);
  assert.equal(result.chmodCalls, 8);
  assert.equal(result.destination.kind, 'directory');
  for (const name of runtimeNames) {
    assert.equal(result.before[name].mode & 0o777, 0o644);
    assert.equal(result.prepared[name].mode, 0o755);
    assert.deepEqual(result.prepared[name].value, result.before[name].value);
  }
});

test('actual runtime preparation never overwrites prior attempts or removes a partially copied UNKNOWN bundle', async t => {
  for (const mode of ['bad_pin', 'existing_directory', 'existing_file', 'existing_symlink', 'copy_unknown', 'copy_tamper']) await t.test(mode, () => {
    const result = runtimePreparation(mode);
    assert.notEqual(result.status, 0, result.stderr);
    if (mode.startsWith('existing_') || mode === 'bad_pin') {
      assert.equal(result.copies, 0);
      assert.deepEqual(result.destination, result.oldDestination);
      if (mode === 'existing_directory') assert.equal(result.marker, 'original retained attempt');
    } else {
      assert.equal(result.destination.kind, 'directory');
      assert.equal(result.prepared['ynx-abci'].value.kind, 'file');
      assert.deepEqual(result.prepared['ynx-abci'].value, result.before['ynx-abci'].value);
      assert.equal(result.prepared['ynx-abci'].mode & 0o111, 0, 'incomplete or corrupt copy became executable');
      if (mode === 'copy_unknown') { assert.equal(result.status, 31); assert.equal(result.copies, 2); }
      else assert.equal(result.copies, 12);
    }
  });
});

const selectedRuntimeTools = ['ynx-consensus-keycheck', 'ynx-consensus-pq-key-init', 'ynx-comet'];
const metadata = path => {
  const info = lstatSync(path, { bigint: true });
  return Object.fromEntries(['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].map(key => [key, info[key]]));
};

// This independent owned-output repair is applied equally to the reconstructed
// late-snapshot caller and the current caller. Original source witnesses retain
// their full nlink/ctime checks; only new directories have mutable entry counts.
const ownedDirectoryPortability = [
  ['        return info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid, info.st_gid\n',
    '        # APFS changes directory nlink when these owned files are created.\n        # Bind its stable object/owner/mode and verify both catalogs instead.\n        return info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid\n'],
  ["                'selected executable copy identity changed')\n",
    "                'selected executable copy identity changed')\n        executable_identity = identity(os.fstat(target.fileno()))\n"],
  ['            and str(work.resolve(strict=True)) == work_arg\n',
    "            and str(work.resolve(strict=True)) == work_arg\n            and {path.name for path in work.iterdir()} == {'tool'}\n            and {path.name for path in tool.iterdir()} == {'SOURCE.json', binary}\n            and identity((tool / binary).lstat()) == executable_identity\n"],
];

function applyOwnedDirectoryPortability(source, reverse = false) {
  for (const pair of ownedDirectoryPortability) {
    const [before, after] = reverse ? [...pair].reverse() : pair;
    assert.equal(source.split(before).length - 1, 1, 'owned-directory compatibility delta must be exact');
    source = source.replace(before, after);
  }
  return source;
}

function originalLateSnapshotSource() {
  // Rebuild the complete previously frozen production source, not a mock of
  // the missing check. Only this fix's small metadata-witness diff is reversed.
  const unnormalized = applyOwnedDirectoryPortability(current, true);
  const begin = unnormalized.indexOf('  local originals_snapshot\n', unnormalized.indexOf('prepare_runtime_tool() {\n'));
  const end = unnormalized.indexOf('  validate_runtime_bundle "$1" "$2" "$3" || return', begin);
  assert.ok(begin >= 0 && end > begin);
  let source = unnormalized.slice(0, begin) + unnormalized.slice(end);
  source = source.replace('  python3 -B - "$1" "$2" "$3" "$4" "$5" "$originals_snapshot"', '  python3 -B - "$1" "$2" "$3" "$4" "$5"');
  source = source.replace('    source_arg, commit, manifest_sha, work_arg, binary, snapshot_raw = sys.argv[1:]', '    source_arg, commit, manifest_sha, work_arg, binary = sys.argv[1:]');
  const bindBegin = source.indexOf('    # Bind the pre-validation witness; never adopt a later source identity.\n');
  const bindEnd = source.indexOf('    source_pin, _, raw = read_pin(', bindBegin);
  assert.ok(bindBegin >= 0 && bindEnd > bindBegin);
  source = source.slice(0, bindBegin) + '    originals = {path: identity(path.lstat()) for path in paths}\n' + source.slice(bindEnd);
  source = source.replace("    require(source_snapshot_matches(), 'pre-validation original source witness changed before completion')\n", '');
  assert.equal(Buffer.byteLength(source), 28705);
  assert.equal(sha256(source), 'ced96ba9f82c1677d150511350d1b103798635f0115ecc9a75d725e0ed537704');
  return source;
}

const lateUnusedMutation = 'LATE_UNUSED_FIXTURE_CHANGE\n';

function runtimeToolPreparation(mode, binary = selectedRuntimeTools[0], phase = null, toolSource = current) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ynx-runtime-tool-')));
  try {
    const fixture = runtimeFixture(directory);
    let work = join(directory, 'new-work');
    if (mode === 'bad_pin') fixture.pin = 'e'.repeat(64);
    if (mode === 'altered_selected' || mode === 'altered_unused') {
      const path = join(fixture.bundle, mode === 'altered_selected' ? binary : 'ynx-abci');
      const raw = readFileSync(path); raw[65] ^= 1; writeFileSync(path, raw);
    }
    if (mode === 'symlink_selected') {
      const original = join(fixture.bundle, binary), alias = join(directory, 'alias-original');
      writeFileSync(alias, readFileSync(original)); rmSync(original); symlinkSync(alias, original);
    }
    if (mode === 'hardlink_selected') linkSync(join(fixture.bundle, binary), join(directory, 'alias-original'));
    if (mode === 'existing_directory') { mkdirSync(work, { mode: 0o700 }); writeFileSync(join(work, 'UNKNOWN'), 'preserve prior attempt'); }
    if (mode === 'existing_file') writeFileSync(work, 'preserve prior file');
    if (mode === 'existing_symlink') symlinkSync(join(directory, 'absent'), work);
    if (mode === 'unsafe_parent') {
      mkdirSync(join(directory, 'real-parent'), { mode: 0o700 });
      symlinkSync(join(directory, 'real-parent'), join(directory, 'alias-parent'));
      work = join(directory, 'alias-parent', 'new-work');
    }
    const entries = ['SOURCE.json', ...runtimeNames, ...operatorNames.map(name => `operator/${name}`)];
    const before = Object.fromEntries(entries.map(name => [name, { value: savedPath(join(fixture.bundle, name)), metadata: metadata(join(fixture.bundle, name)) }]));
    const oldWork = savedPath(work), trace = join(directory, 'validation.calls'), transport = join(directory, 'transport.calls');
    const publicInput = join(directory, 'request.json'), genesis = join(directory, 'genesis.json');
    writeFileSync(publicInput, '{"syntheticOnly":true}'); writeFileSync(genesis, '{"syntheticOnly":true}');
    const env = { ...process.env, YNX_TOOL_BUNDLE: fixture.bundle, YNX_TOOL_COMMIT: fixture.commit, YNX_TOOL_PIN: fixture.pin,
      YNX_TOOL_WORK: work, YNX_TOOL_BINARY: binary, YNX_TOOL_TRACE: trace, YNX_TOOL_TRANSPORT: transport, YNX_TOOL_MODE: mode };
    let script;
    if (phase) {
      const source = readFileSync(join(root, 'scripts/ops/init-consensus-candidate-keys.sh'), 'utf8');
      const start = source.indexOf('pq_key_ceremony() {\n'), end = source.indexOf('\nif [[ $phase != legacy ]]; then\n', start);
      assert.ok(start >= 0 && end > start);
      const caller = source.slice(start, end);
      assert.equal(caller.split('prepare_runtime_tool ').length - 1, 1);
      assert.doesNotMatch(caller, /prepare_runtime_bundle |validate_runtime_bundle /);
      Object.assign(env, {
        CONSENSUS_CANDIDATE_KEY_ROLE: 'primary', CONSENSUS_CANDIDATE_KEY_WORK_ROOT: work,
        CONSENSUS_CANDIDATE_KEY_CEREMONY_RESUME: '',
        CONSENSUS_CANDIDATE_RUNTIME_BUNDLE: fixture.bundle, CONSENSUS_CANDIDATE_RUNTIME_COMMIT: fixture.commit,
        CONSENSUS_CANDIDATE_RUNTIME_MANIFEST_SHA256: fixture.pin,
        CONSENSUS_PQ_KEY_DIRECTORY: phase === 'pq-approve-first-registration' || phase === 'legacy-verify-recovery' ? '' : join(directory, 'remote-custody'),
        CONSENSUS_PQ_STATE_DIRECTORY: phase === 'pq-approve-first-registration' || phase === 'legacy-verify-recovery' ? '' : join(directory, 'remote-history'),
        CONSENSUS_PQ_EPOCH_REQUEST: phase === 'pq-new-epoch' ? publicInput : '', CONSENSUS_PQ_EPOCH_REQUEST_SHA256: phase === 'pq-new-epoch' ? filePin(readFileSync(publicInput)).sha256 : '',
        CONSENSUS_PQ_CONSENSUS_GENESIS: phase === 'pq-inspect' || phase === 'legacy-verify-recovery' ? '' : genesis,
        CONSENSUS_PQ_CONSENSUS_GENESIS_SHA256: phase === 'pq-inspect' || phase === 'legacy-verify-recovery' ? '' : filePin(readFileSync(genesis)).sha256,
        CONSENSUS_PQ_ENCRYPTED_CREDENTIAL_SHA256: phase === 'pq-new-epoch' ? 'c'.repeat(64) : '',
        CONSENSUS_PQ_PUBLIC_RECORD: phase === 'pq-approve-first-registration' ? publicInput : '',
        CONSENSUS_PQ_PUBLIC_RECORD_SHA256: phase === 'pq-approve-first-registration' ? filePin(readFileSync(publicInput)).sha256 : '',
        CONSENSUS_PQ_APPROVAL_DIRECTORY: phase === 'pq-approve-first-registration' ? join(directory, 'remote-approval') : '',
        CONSENSUS_LEGACY_RECOVERY_PARENT: phase === 'legacy-verify-recovery' ? join(directory, 'remote-recovery') : '',
        CONSENSUS_LEGACY_RECOVERY_ROLE_MANIFEST_REMOTE: phase === 'legacy-verify-recovery' ? `/opt/ynx-chain/consensus-candidates/ynx-consensus-candidate-${fixture.commit.slice(0, 12)}/primary/role/role-manifest.json` : '',
        CONSENSUS_LEGACY_RECOVERY_ROLE_MANIFEST_SHA256: phase === 'legacy-verify-recovery' ? 'd'.repeat(64) : '',
      });
      script = ['set -Eeuo pipefail', 'umask 077', `phase=${phase}`, 'PRIMARY_NODE_USER=fixture; PRIMARY_NODE_HOST=fixture.invalid; PRIMARY_NODE_SSH_KEY=public-reference-only',
        'git() { [[ "$#" -eq 2 && "$1" == rev-parse && "$2" == HEAD ]] || return 94; printf "%s\\n" "$YNX_TOOL_COMMIT"; }',
        'go() { printf "unexpected local build\\n" >&2; return 95; }',
        'ynx_ops_ssh() { printf "reserve\\n" >> "$YNX_TOOL_TRANSPORT"; return 23; }',
        'ynx_ops_copy() { printf "unexpected-copy\\n" >> "$YNX_TOOL_TRANSPORT"; return 96; }', caller, 'pq_key_ceremony'].join('\n');
    } else {
      script = ['set -Eeuo pipefail', 'umask 077', 'ulimit -c 0',
        actualFunction(current, 'validate_runtime_bundle').replace(/^validate_runtime_bundle\(\)/, 'original_validate_runtime_bundle()'),
        'validate_runtime_bundle() { printf "validate\\n" >> "$YNX_TOOL_TRACE"; original_validate_runtime_bundle "$@" || return; if [[ "$YNX_TOOL_MODE" == late_unused ]]; then printf "LATE_UNUSED_FIXTURE_CHANGE\\n" >> "$YNX_TOOL_BUNDLE/ynx-abci"; fi; }',
        actualFunction(toolSource, 'prepare_runtime_tool'), ...(mode === 'partial_write' ? ['ulimit -f 128'] : []),
        'prepare_runtime_tool "$YNX_TOOL_BUNDLE" "$YNX_TOOL_COMMIT" "$YNX_TOOL_PIN" "$YNX_TOOL_WORK" "$YNX_TOOL_BINARY"'].join('\n');
    }
    const result = spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf8', env, timeout: 30000, maxBuffer: 65536 });
    assert.equal(result.error, undefined);
    for (const name of entries) {
      const path = join(fixture.bundle, name);
      if (mode === 'late_unused' && name === 'ynx-abci') {
        assert.deepEqual(readFileSync(path), Buffer.concat([before[name].value.bytes, Buffer.from(lateUnusedMutation)]), 'fixture must change precisely the unused ELF after real full validation');
        assert.notEqual(filePin(readFileSync(path)).sha256, filePin(before[name].value.bytes).sha256);
      } else assert.deepEqual({ value: savedPath(path), metadata: metadata(path) }, before[name], `tool preparation changed original ${name}`);
    }
    const prepared = Object.fromEntries(runtimeNames.map(name => [name, { value: savedPath(join(work, 'tool', name)), mode: existsSync(join(work, 'tool', name)) ? lstatSync(join(work, 'tool', name)).mode & 0o777 : null }]));
    const receiptPath = join(work, 'runtime-tool-prepared.json');
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, oldWork, work: savedPath(work),
      prepared, before, sourceCopy: savedPath(join(work, 'tool', 'SOURCE.json')),
      workEntries: existsSync(work) && lstatSync(work).isDirectory() ? readdirSync(work).sort() : [],
      toolEntries: existsSync(join(work, 'tool')) ? readdirSync(join(work, 'tool')).sort() : [],
      toolMode: existsSync(join(work, 'tool')) ? lstatSync(join(work, 'tool')).mode & 0o777 : null,
      receipt: existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null,
      validationCalls: existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').length : 0,
      transport: existsSync(transport) ? readFileSync(transport, 'utf8').trim().split('\n') : [],
      unknown: existsSync(join(work, 'UNKNOWN')) ? readFileSync(join(work, 'UNKNOWN'), 'utf8') : null };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('actual runtime preparation selects one fixed PUBLIC tool after exactly one complete bundle validation', async t => {
  for (const binary of selectedRuntimeTools) await t.test(binary, () => {
    const result = runtimeToolPreparation('fresh', binary);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '', 'preparation must not mix DATA diagnostics into a ceremony receipt');
    assert.equal(result.validationCalls, 1);
    assert.deepEqual(result.sourceCopy, result.before['SOURCE.json'].value);
    assert.deepEqual(result.toolEntries, ['SOURCE.json', binary].sort());
    assert.deepEqual(result.workEntries, ['runtime-tool-prepared.json', 'tool']);
    assert.equal(result.toolMode, 0o700);
    for (const name of runtimeNames) {
      if (name === binary) { assert.deepEqual(result.prepared[name].value, result.before[name].value); assert.equal(result.prepared[name].mode, 0o755); }
      else assert.equal(result.prepared[name].value, null, `unused ${name} was copied`);
    }
    assert.deepEqual(result.receipt, { version: 'YNX-PUBLIC-RUNTIME-TOOL-PREPARATION/v1', classification: 'data',
      commit: 'a'.repeat(40), sourceManifestSHA256: sha256(result.sourceCopy.bytes), selectedTool: binary,
      binaryPin: filePin(result.prepared[binary].value.bytes), fullSourceBinaryCount: 8, copiedBinaryCount: 1,
      originalSourceUnchanged: true, selectedDirectoryIsRuntimeBundle: false, binaryExecuted: false, authorityGranted: false });
  });
});

test('actual runtime preparation refuses unused ELF replacement between real complete validation and work reservation', () => {
  // First reconstruct and pin the complete actual old source above. Apply only
  // the same owned-directory portability repair so APFS's unrelated nlink
  // change cannot mask the old acceptance of post-validation source mutation.
  const original = runtimeToolPreparation('late_unused', selectedRuntimeTools[0], null,
    applyOwnedDirectoryPortability(originalLateSnapshotSource()));
  assert.equal(original.status, 0, original.stderr);
  assert.equal(original.validationCalls, 1);
  assert.equal(original.receipt.originalSourceUnchanged, true, 'old late snapshot absorbed the injected unused-file change');
  assert.equal(original.work.kind, 'directory');
  assert.deepEqual(original.transport, []);
  const fixed = runtimeToolPreparation('late_unused');
  assert.notEqual(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stderr, /original source changed after full validation/);
  assert.equal(fixed.validationCalls, 1, 'do not repeat the eight-ELF full hashing pass');
  assert.equal(fixed.work, null, 'changed source must be refused before work or SSH');
  assert.equal(fixed.receipt, null);
  assert.deepEqual(fixed.transport, []);
});

test('actual runtime preparation selected tool rejects unselected corruption aliases unsafe paths and retained UNKNOWN', async t => {
  for (const mode of ['bad_pin', 'altered_selected', 'altered_unused', 'symlink_selected', 'hardlink_selected', 'unsafe_parent', 'existing_directory', 'existing_file', 'existing_symlink', 'partial_write']) await t.test(mode, () => {
    const result = runtimeToolPreparation(mode);
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(result.validationCalls, ['symlink_selected', 'hardlink_selected'].includes(mode) ? 0 : 1);
    assert.equal(result.receipt, null);
    assert.equal(result.transport.length, 0);
    if (mode === 'partial_write') {
      assert.equal(result.work.kind, 'directory', 'partial preparation was deleted');
      assert.deepEqual(result.sourceCopy, result.before['SOURCE.json'].value);
      assert.equal(result.prepared['ynx-consensus-keycheck'].value.kind, 'file');
      assert.equal(result.prepared['ynx-consensus-keycheck'].mode, 0o600, 'partial copy became executable');
    } else {
      assert.deepEqual(result.work, result.oldWork);
      assert.ok(runtimeNames.every(name => result.prepared[name].value === null));
      if (mode === 'existing_directory') assert.equal(result.unknown, 'preserve prior attempt');
    }
  });
  const invalid = runtimeToolPreparation('fresh', 'ynx-bft-gatewayd');
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.validationCalls, 0);
  assert.equal(invalid.work, null);
});

test('actual runtime preparation original PQ caller prepares only its phase helper before any transport or local build', async t => {
  for (const [phase, binary] of [['legacy-verify-recovery', 'ynx-consensus-keycheck'], ['pq-inspect', 'ynx-consensus-pq-key-init'], ['pq-new-epoch', 'ynx-consensus-pq-key-init'], ['pq-approve-first-registration', 'ynx-comet']]) await t.test(phase, () => {
    const result = runtimeToolPreparation('fresh', binary, phase);
    assert.equal(result.status, 23, result.stderr);
    assert.equal(result.stdout, '');
    assert.deepEqual(result.transport, ['reserve'], 'caller reached copy, remote execution or another role');
    assert.equal(result.receipt.selectedTool, binary);
    assert.equal(result.receipt.copiedBinaryCount, 1);
    assert.equal(result.receipt.binaryExecuted, false);
    assert.deepEqual(result.toolEntries, ['SOURCE.json', binary].sort());
    assert.deepEqual(result.workEntries, ['runtime-tool-prepared.json', 'tool']);
    for (const name of runtimeNames) assert.equal(result.prepared[name].value?.kind ?? null, name === binary ? 'file' : null);
  });
});
