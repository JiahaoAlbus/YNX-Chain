import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

function runtimePreparation(mode) {
  const directory = mkdtempSync(join(tmpdir(), 'ynx-runtime-copy-'));
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
    const script = [
      'set -Eeuo pipefail',
      'source "$YNX_RUNTIME_SCRIPT"',
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
    const result = spawnSync('bash', ['-c', script], { cwd: directory, encoding: 'utf8', env: { ...process.env, YNX_RUNTIME_SCRIPT: join(root, relative), YNX_RUNTIME_BUNDLE: fixture.bundle, YNX_RUNTIME_COMMIT: fixture.commit, YNX_RUNTIME_MANIFEST: fixture.pin, YNX_RUNTIME_DESTINATION: destination, YNX_RUNTIME_TRACE: trace, YNX_RUNTIME_MODE: mode } });
    assert.equal(result.error, undefined);
    for (const name of entries) {
      const path = join(fixture.bundle, name);
      assert.deepEqual({ value: savedPath(path), mode: lstatSync(path).mode }, before[name], `preparation changed original ${name} bytes/mode`);
    }
    const copies = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').length : 0;
    const prepared = Object.fromEntries(runtimeNames.map(name => {
      const path = join(destination, name);
      return [name, { value: savedPath(path), mode: existsSync(path) ? lstatSync(path).mode & 0o777 : null }];
    }));
    return { status: result.status, stderr: result.stderr, copies, oldDestination, destination: savedPath(destination), prepared, before, marker: existsSync(join(destination, 'UNKNOWN')) ? readFileSync(join(destination, 'UNKNOWN'), 'utf8') : null };
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
