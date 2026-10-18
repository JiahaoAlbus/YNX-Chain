import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  const role = 'singapore';
  const remoteDir = join(remote, 'opt/ynx-chain/consensus-candidates', release, role);
  const remoteArchive = join(remote, 'tmp', `${release}-${role}.tar.gz`);
  const localStage = join(work, 'roles', role);
  const localArchive = join(work, `${release}-${role}.tar.gz`);
  const marker = join(remoteDir, 'unknown-original-marker');
  const oldArchive = Buffer.from('original UNKNOWN archive bytes\0\xff', 'latin1');
  try {
    for (const path of [join(remote, 'tmp'), join(remote, 'opt/ynx-chain/consensus-candidates'), join(remote, 'var/lib/ynx-chain/consensus-candidate'), join(work, 'bin'), join(work, 'roles'), join(packageRoot, 'roles', role, 'scripts')]) mkdirSync(path, { recursive: true, mode: 0o700 });
    const executable = (path, body) => writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o700 });
    for (const binary of ['ynx-abci', 'cometbft']) executable(join(work, 'bin', binary), 'exit 0');
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
      '  "$@"',
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
    return { status: result.status, stderr: result.stderr, before, release: savedPath(remoteDir), archive: savedPath(remoteArchive), localArchive: savedPath(localArchive), oldArchive, marker: existsSync(marker) ? readFileSync(marker, 'utf8') : null, staged: savedPath(join(remoteDir, 'role/role-manifest.json')), localMarker: existsSync(join(localStage, 'old')) ? readFileSync(join(localStage, 'old'), 'utf8') : null, copied: savedPath(join(directory, 'copy-observed')), copyCount: trace.split('\n').filter(line => line === `${role} ops copy`).length, trace, events: existsSync(join(directory, 'events')) ? readFileSync(join(directory, 'events'), 'utf8').trim().split('\n') : [] };
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
  const body = source.match(/^work_root=.*\n[\s\S]*?(?=^echo "building production candidate binaries)/m)?.[0];
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
