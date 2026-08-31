import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// This runs a copied production executor against only a temporary test root.
// jq is real; curl/systemctl/file/readlink/stat/realpath/cp/mv are controlled
// wrappers. Nothing can address the production /opt/ynx tree.
const root = mkdtempSync(join(tmpdir(), 'finance-shell-fixture-'));
const shell = (bin, args, options = {}) => execFileSync(bin, args, { encoding: 'utf8', ...options }).trim();
const sha = path => shell('/sbin/sha256sum', [path]).split(/\s+/)[0];
const bytes = path => Number(shell('/usr/bin/wc', ['-c', path]).trim().split(/\s+/)[0]);
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
const tuple = path => shell('/opt/homebrew/bin/gstat', ['-Lc', '%u:%g:%a:%h', path]);
const fullTuple = path => shell('/opt/homebrew/bin/gstat', ['-Lc', '%d:%i:%u:%g:%a:%h', path]);
const phase1DirectoryTuple = path => shell('/opt/homebrew/bin/gstat', ['-Lc', '%d:%i:%u:%g:%a:%h:%s:%F', path]);
const retainedDirectoryIdentity = path => shell('/opt/homebrew/bin/gstat', ['-Lc', '%d:%i:%u:%g:%a:%F', path]);
const stateTuple = path => shell('/opt/homebrew/bin/gstat', ['-Lc', '%d:%i:%u:%g:%a:%h', path]);
const receipt = (url, body) => ({ url, status: '200', bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') });
const shaBuffer = value => createHash('sha256').update(value).digest('hex');

function wrapper(dir, name, body) { const path = join(dir, name); write(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`); chmodSync(path, 0o755); }
function makeWrappers(dir) {
  wrapper(dir, 'stat', 'exec /opt/homebrew/bin/gstat "$@"'); wrapper(dir, 'cp', 'exec /opt/homebrew/bin/gcp "$@"'); wrapper(dir, 'mv', 'target=${!#}\nif [[ -n "${FINANCE_FIXTURE_FAIL_MOVE_TARGET:-}" && "$target" == "$FINANCE_FIXTURE_FAIL_MOVE_TARGET" ]]; then if [[ "${FINANCE_FIXTURE_SUBSTITUTE_RELEASE_CONTAINER:-}" == 1 ]]; then /bin/rmdir "$FINANCE_FIXTURE_RELEASE_CONTAINER"; /bin/ln -s "$FINANCE_FIXTURE_FOREIGN_TARGET" "$FINANCE_FIXTURE_RELEASE_CONTAINER"; fi; exit 73; fi\nexec /opt/homebrew/bin/gmv "$@"'); wrapper(dir, 'mkdir', 'for arg in "$@"; do [[ -n "${FINANCE_FIXTURE_FAIL_MKDIR_PATH:-}" && "$arg" == "$FINANCE_FIXTURE_FAIL_MKDIR_PATH" ]] && exit 73; done\n/bin/mkdir "$@"\nfor arg in "$@"; do if [[ -n "${FINANCE_FIXTURE_RELEASE_CONTAINER:-}" && "$arg" == "$FINANCE_FIXTURE_RELEASE_CONTAINER" ]]; then case "${FINANCE_FIXTURE_RELEASE_CREATE_MODE:-}" in foreign) printf foreign > "$arg/foreign";; symlink) /bin/rmdir "$arg"; /bin/ln -s "$FINANCE_FIXTURE_FOREIGN_TARGET" "$arg";; esac; fi; if [[ -n "${FINANCE_FIXTURE_CONTAINER_PATH:-}" && "$arg" == "$FINANCE_FIXTURE_CONTAINER_PATH" ]]; then case "${FINANCE_FIXTURE_CONTAINER_CREATE_MODE:-}" in foreign) printf foreign > "$arg/foreign";; symlink) /bin/rmdir "$arg"; /bin/ln -s "$FINANCE_FIXTURE_FOREIGN_TARGET" "$arg";; esac; fi; done'); wrapper(dir, 'chown', 'target=${!#}\nif [[ -n "${FINANCE_FIXTURE_SUBSTITUTE_CONTAINER_ON_CHOWN:-}" && "$target" == "$FINANCE_FIXTURE_SUBSTITUTE_CONTAINER_ON_CHOWN" && ! -e "${FINANCE_FIXTURE_SUBSTITUTE_CONTAINER_MARKER:-}" ]]; then /opt/homebrew/bin/gstat -Lc "%d:%i:%h:%F" "$target" > "$FINANCE_FIXTURE_SUBSTITUTE_CONTAINER_MARKER"; /bin/rmdir "$target"; /bin/mkdir "$target"; fi\nexec /opt/homebrew/bin/gchown "$@"'); wrapper(dir, 'chmod', 'exec /opt/homebrew/bin/gchmod "$@"'); wrapper(dir, 'tar', 'args=()\nfor arg in "$@"; do [[ "$arg" == --warning=no-unknown-keyword ]] || args+=("$arg"); done\nexec /usr/bin/tar "${args[@]}"'); wrapper(dir, 'readlink', 'if [[ "${1:-}" == -f ]]; then shift; fi\nexec /usr/bin/readlink "$1"');
  wrapper(dir, 'realpath', 'if [[ "${1:-}" == -e ]]; then shift; fi\ntest -e "$1"\nprintf "%s\\n" "$1"'); wrapper(dir, 'file', 'printf "%s: ELF 64-bit LSB executable, x86-64\\n" "$1"');
  wrapper(dir, 'runuser', '[[ "${FINANCE_FIXTURE_DENY_SERVICE_ACCESS:-}" != 1 ]] || exit 77\n[[ "$1" == -u ]] && shift 2\n[[ "$1" == -- ]] && shift\nexec "$@"');
  wrapper(dir, 'sha256sum', 'if [[ "${FINANCE_FIXTURE_SUBSTITUTE_STATE_ON_HASH:-}" == 1 && "$1" == "$FINANCE_FIXTURE_STATE_PATH" && ! -e "$FINANCE_FIXTURE_SUBSTITUTE_MARKER" ]]; then /sbin/sha256sum "$1"; : > "$FINANCE_FIXTURE_SUBSTITUTE_MARKER"; printf substituted > "$1"; exit 0; fi\nexec /sbin/sha256sum "$@"');
  wrapper(dir, 'systemctl', 'state="$FINANCE_FIXTURE_SERVICE"\nread -r active pid restarts < "$state"\ncase "$1" in\n is-active) [[ "$active" == active ]] ;;\n show) case "$3" in MainPID) printf "%s\\n" "$pid";; NRestarts) printf "%s\\n" "$restarts";; *) exit 64;; esac ;;\n restart) case "${FINANCE_FIXTURE_CANDIDATE_STATE_MODE:-none}" in file) printf candidate-state > "$FINANCE_FIXTURE_STATE_PATH";; symlink) ln -s "$FINANCE_FIXTURE_SYMLINK_TARGET" "$FINANCE_FIXTURE_STATE_PATH";; esac; printf "active %s %s\\n" "$((pid + 1))" "$restarts" > "$state" ;;\n stop) printf "inactive %s %s\\n" "$pid" "$restarts" > "$state" ;;\n start) printf "active %s %s\\n" "$pid" "$restarts" > "$state" ;;\n *) exit 64;; esac');
  wrapper(dir, 'curl', 'out= url=\nwhile (($#)); do case "$1" in -o) out=$2; shift 2;; -w|--max-time) shift 2;; --silent|--show-error) shift;; *) url=$1; shift;; esac; done\ncase "$url" in\n https://old/*) body="$FINANCE_FIXTURE_RESPONSES/old-${url##*/}";;\n https://candidate/*) if [[ "${FINANCE_FIXTURE_SUBSTITUTE_RELEASE_ON_CURL:-}" == 1 && ! -e "$FINANCE_FIXTURE_SUBSTITUTE_MARKER" ]]; then : > "$FINANCE_FIXTURE_SUBSTITUTE_MARKER"; /bin/rm -rf "$FINANCE_FIXTURE_RELEASE_PATH"; /bin/ln -s "$FINANCE_FIXTURE_FOREIGN_TARGET" "$FINANCE_FIXTURE_RELEASE_PATH"; fi; body="$FINANCE_FIXTURE_RESPONSES/candidate-${url##*/}";;\n *) exit 64;; esac\ncat "$body" > "$out"\nprintf 200');
}
function writeLease(fixture, failure, absent, id = 'fixture-lease') {
  const r = fixture.root; const p = fixture.paths;
  const oldHealth = receipt('https://old/health', 'old-health'); const oldVersion = receipt('https://old/version', 'old-version'); const oldPublicHealth = receipt('https://old/public-health', 'old-public-health'); const oldPublicVersion = receipt('https://old/public-version', 'old-public-version');
  const candidateHealth = receipt('https://candidate/health', 'new-health'); const candidateVersion = receipt('https://candidate/version', 'new-version'); const candidatePublicHealth = receipt('https://candidate/public-health', 'new-public-health'); const candidatePublicVersion = receipt('https://candidate/public-version', 'new-public-version'); const candidateAsset = receipt('https://candidate/app.js', 'new-asset');
  const parents = Object.fromEntries(['stage', 'backup', 'release'].map(name => [name, { path: p.parents[name], tuple: tuple(p.parents[name]) }]));
  const state = absent ? { path: p.state, absent: true } : { path: p.state, absent: false, tuple: stateTuple(p.state), restoredTuple: tuple(p.state), bytes: bytes(p.state), sha256: sha(p.state) };
  const releaseParentTuple = shell('/opt/homebrew/bin/gstat', ['-Lc', '%u:%g', p.parents.release]).split(':');
  const stageParentTuple = shell('/opt/homebrew/bin/gstat', ['-Lc', '%u:%g', p.parents.stage]).split(':');
  const backupParentTuple = shell('/opt/homebrew/bin/gstat', ['-Lc', '%u:%g', p.parents.backup]).split(':');
  const lease = { lease: { signed: true, kind: 'FINANCE_ROLLBACK_FIRST_PRODUCTION_DEPLOYMENT', id }, paths: { stage: p.stage, stageContainer: { path: p.stageContainer, uid: Number(stageParentTuple[0]), gid: Number(stageParentTuple[1]), mode: 700 }, backup: p.backup, backupContainer: { path: p.backupContainer, uid: Number(backupParentTuple[0]), gid: Number(backupParentTuple[1]), mode: 700 }, release: p.release, releaseContainer: { path: p.releaseContainer, uid: Number(releaseParentTuple[0]), gid: Number(releaseParentTuple[1]), mode: 750 }, parents, basenames: { archive: basename(p.archive), newEnv: basename(p.newEnv), stage: basename(p.stage), backup: basename(p.backup), release: basename(p.release) } }, fresh: { currentLink: p.current, activeRelease: p.old, binary: { path: join(p.old, 'ynx-finance'), sha256: sha(join(p.old, 'ynx-finance')) }, env: { path: p.env, sha256: sha(p.env) }, unit: { path: p.unit, sha256: sha(p.unit) }, caddy: { path: p.caddy, sha256: sha(p.caddy) }, service: { name: 'ynx-finance-fixture', pid: 101, nrestarts: 7, user: 'ynx', gid: Number(releaseParentTuple[1]), releaseContainerOwnerUid: Number(releaseParentTuple[0]) }, state, verifier: { loopbackHealth: oldHealth, loopbackVersion: oldVersion, publicHealth: oldPublicHealth, publicVersion: oldPublicVersion } }, candidate: { carrier: { id: basename(p.carrier), path: p.carrier, tuple: phase1DirectoryTuple(p.carrier) }, archive: { path: p.archive, bytes: bytes(p.archive), sha256: sha(p.archive) }, binary: { bytes: bytes(join(p.candidate, 'ynx-finance')), sha256: sha(join(p.candidate, 'ynx-finance')) }, env: { path: p.newEnv, sha256: sha(p.newEnv) }, sourceCommit: '7824af677dd052d20321431381523ab302614d98', verifier: { loopbackHealth: candidateHealth, loopbackVersion: candidateVersion, publicHealth: candidatePublicHealth, publicVersion: candidatePublicVersion }, assets: [{ ...candidateAsset, relativePath: 'web/app.js' }] } };
  if (failure) lease.candidate.verifier.loopbackHealth.sha256 = '0'.repeat(64);
  write(p.lease, `${JSON.stringify(lease)}\n`);
}
function makeFixture(failure, { absent = false, id = 'fixture-lease' } = {}) {
  const dir = mkdtempSync(join(root, 'run-')); const ynx = join(dir, 'opt', 'ynx');
  const parents = Object.fromEntries(['stage', 'backup', 'release'].map(name => [name, join(ynx, 'parents', name)])); for (const parent of Object.values(parents)) mkdirSync(parent, { recursive: true });
  const carrier = join(ynx, 'stage', 'finance', 'p0228-finance-phase1-20260822T234100Z');
  const p = { parents, carrier, old: join(ynx, 'releases', 'old'), current: join(ynx, 'finance-current'), env: join(ynx, 'etc', 'finance.env'), unit: join(ynx, 'etc', 'finance.service'), caddy: join(ynx, 'etc', 'Caddyfile'), state: join(ynx, 'var', 'state.json'), archive: join(carrier, 'candidate.tgz'), newEnv: join(carrier, 'finance.env'), targetWeb: join(ynx, 'releases', 'finance', 'ynx-finance-fixture', 'web'), stageContainer: join(parents.stage, id), stage: join(parents.stage, id, 'stage'), backupContainer: join(parents.backup, id), backup: join(parents.backup, id, 'backup'), releaseContainer: join(parents.release, id), release: join(parents.release, id, 'release'), lease: join(ynx, 'leases', 'finance', 'fixture.json'), responses: join(dir, 'responses'), service: join(dir, 'service.state') };
  for (const path of [p.archive, p.newEnv]) mkdirSync(dirname(path), { recursive: true }); write(join(p.old, 'ynx-finance'), 'old-bin'); chmodSync(join(p.old, 'ynx-finance'), 0o755); write(join(p.old, 'web', 'app.js'), 'old-asset'); write(p.env, 'SECRET=kept-local\nYNX_FINANCE_WEB_DIR=old\nOTHER=value\n'); write(p.unit, 'old-unit'); write(p.caddy, 'old-caddy'); if (!absent) write(p.state, 'old-state'); else mkdirSync(dirname(p.state), { recursive: true }); symlinkSync(p.old, p.current); write(p.service, 'active 101 7\n');
  const archiveRoot = join(dir, 'archive', basename(p.release)); write(join(archiveRoot, 'ynx-finance'), 'new-bin'); chmodSync(join(archiveRoot, 'ynx-finance'), 0o755); write(join(archiveRoot, 'web', 'app.js'), 'new-asset'); shell('/usr/bin/tar', ['-czf', p.archive, '-C', dirname(archiveRoot), basename(archiveRoot)]); p.candidate = archiveRoot;
  for (const [name, body] of Object.entries({ 'old-health': 'old-health', 'old-version': 'old-version', 'old-public-health': 'old-public-health', 'old-public-version': 'old-public-version', 'candidate-health': failure ? 'wrong-health' : 'new-health', 'candidate-version': 'new-version', 'candidate-public-health': 'new-public-health', 'candidate-public-version': 'new-public-version', 'candidate-app.js': 'new-asset' })) write(join(p.responses, name), body);
  const bin = join(dir, 'bin'); mkdirSync(bin); makeWrappers(bin); const generator = join(dir, 'generator.sh'); writeFileSync(generator, readFileSync(new URL('./finance-candidate-env-generator.sh', import.meta.url), 'utf8').replaceAll('/opt/ynx', ynx).replaceAll('/etc/ynx', join(ynx, 'etc'))); chmodSync(generator, 0o755); const generatorResult = spawnSync('/bin/bash', [generator, p.env, p.newEnv, p.targetWeb], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' }); assert.equal(generatorResult.status, 0, generatorResult.stderr); assert.equal(readFileSync(p.newEnv, 'utf8'), `SECRET=kept-local\nYNX_FINANCE_WEB_DIR=${p.targetWeb}\nOTHER=value\n`, 'exactly one deterministic replacement'); assert.equal(generatorResult.stdout.includes('SECRET='), false, 'generator output has no env secret'); assert.ok(generatorResult.stdout.includes(`bytes=${bytes(p.newEnv)}`) && generatorResult.stdout.includes(`sha256=${sha(p.newEnv)}`) && generatorResult.stdout.includes(`tuple=${tuple(p.newEnv)}`), 'exact candidate receipt'); const copied = join(dir, 'executor.sh'); writeFileSync(copied, readFileSync(new URL('./finance-production-rollback-first.sh', import.meta.url), 'utf8').replaceAll('/opt/ynx', ynx)); chmodSync(copied, 0o755); const fixture = { root: dir, paths: p, bin, copied, generator, absent }; writeLease(fixture, failure, absent, id); return fixture;
}
function execute(failure, { absent = false, candidateState = 'none', substitute = false, envMismatch = false } = {}) {
  const fixture = makeFixture(failure, { absent }); const env = { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, FINANCE_FIXTURE_SERVICE: fixture.paths.service, FINANCE_FIXTURE_RESPONSES: fixture.paths.responses, FINANCE_FIXTURE_STATE_PATH: fixture.paths.state, FINANCE_FIXTURE_CANDIDATE_STATE_MODE: candidateState, FINANCE_FIXTURE_SYMLINK_TARGET: fixture.paths.old, FINANCE_FIXTURE_SUBSTITUTE_STATE_ON_HASH: substitute ? '1' : '', FINANCE_FIXTURE_SUBSTITUTE_MARKER: join(fixture.root, 'substitute-marker') };
  if (envMismatch) write(fixture.paths.newEnv, 'YNX_FINANCE_WEB_DIR=tampered\n');
  const result = spawnSync('/bin/bash', [fixture.copied, 'deploy', fixture.paths.lease], { env, encoding: 'utf8' });
  if (failure) { assert.notEqual(result.status, 0, 'candidate verifier must fail'); if (envMismatch) { assert.match(result.stdout, /^phase=prewrite$/m, 'prewrite failure emits a phase receipt'); assert.match(result.stdout, /^failureClass=PREWRITE_CANDIDATE_INTEGRITY$/m, 'prewrite receipt identifies the last no-write phase'); assert.match(result.stdout, /^failureExitStatus=1$/m, 'prewrite receipt retains the failure status'); assert.equal(result.stdout.includes('SECRET='), false, 'prewrite receipt does not expose env data'); assert.equal(lstatSync(fixture.paths.stage, { throwIfNoEntry: false }), undefined, 'prewrite integrity failure occurs before staging write'); assert.equal(lstatSync(fixture.paths.stageContainer, { throwIfNoEntry: false }), undefined, 'prewrite integrity failure occurs before stage-container write'); assert.equal(lstatSync(fixture.paths.backup, { throwIfNoEntry: false }), undefined, 'prewrite integrity failure occurs before backup write'); assert.equal(lstatSync(fixture.paths.backupContainer, { throwIfNoEntry: false }), undefined, 'prewrite integrity failure occurs before backup-container write'); } if (candidateState === 'file' && !substitute) { assert.match(result.stdout, /^phase=CANDIDATE_VERIFY$/m, 'post-restart verifier emits the owned phase after rollback'); assert.match(result.stdout, /^failureClass=POSTWRITE_CANDIDATE_VERIFY$/m, 'post-restart receipt names candidate verification'); assert.match(result.stdout, /^failureExitStatus=1$/m, 'post-restart receipt retains the failure status'); assert.equal(result.stdout.includes('SECRET='), false, 'post-restart receipt does not expose env data'); assert.equal(readlinkSync(fixture.paths.current), fixture.paths.old, 'old symlink restored'); assert.equal(readFileSync(fixture.paths.env, 'utf8'), 'SECRET=kept-local\nYNX_FINANCE_WEB_DIR=old\nOTHER=value\n', 'old env restored'); assert.equal(lstatSync(fixture.paths.release, { throwIfNoEntry: false }), undefined, 'exact candidate release removed after failed verification'); assert.equal(lstatSync(fixture.paths.releaseContainer, { throwIfNoEntry: false }), undefined, 'exact empty release container removed after failed verification'); for (const path of [fixture.paths.stage, fixture.paths.stageContainer, fixture.paths.backup, fixture.paths.backupContainer]) assert.equal(lstatSync(path, { throwIfNoEntry: false }), undefined, `automatic rollback removes ${basename(path)}`); if (absent) { assert.equal(lstatSync(fixture.paths.state, { throwIfNoEntry: false }), undefined, 'absent state restored'); assert.equal(lstatSync(`${fixture.paths.current}.next`, { throwIfNoEntry: false }), undefined, 'no next residue'); assert.equal(lstatSync(`${fixture.paths.current}.rollback`, { throwIfNoEntry: false }), undefined, 'no rollback residue'); } else assert.equal(readFileSync(fixture.paths.state, 'utf8'), 'old-state', 'old state restored'); assert.equal(readFileSync(fixture.paths.unit, 'utf8'), 'old-unit', 'unit unchanged'); assert.equal(readFileSync(fixture.paths.caddy, 'utf8'), 'old-caddy', 'caddy unchanged'); assert.equal(readFileSync(fixture.paths.service, 'utf8').startsWith('active '), true, 'old service active'); } else assert.notEqual(result.status, 0, 'substitution and symlink fail closed'); } else { assert.equal(result.status, 0, `${result.stdout}${result.stderr}`); assert.equal(readlinkSync(fixture.paths.current), fixture.paths.release, 'candidate symlink selected'); assert.equal(readFileSync(fixture.paths.service, 'utf8'), 'active 102 7\n', 'manual restart preserves NRestarts'); assert.equal(lstatSync(fixture.paths.stage, { throwIfNoEntry: false }), undefined, 'success removes stage leaf'); assert.equal(lstatSync(fixture.paths.stageContainer, { throwIfNoEntry: false }), undefined, 'success removes empty stage container'); assert.ok(lstatSync(fixture.paths.backup).isDirectory(), 'success retains exact backup leaf'); assert.ok(lstatSync(fixture.paths.backupContainer).isDirectory(), 'success retains exact backup container'); }
}
function serviceTraversalFixture(denied = false) {
  const fixture = makeFixture(false); const p = fixture.paths;
  const env = { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, FINANCE_FIXTURE_SERVICE: p.service, FINANCE_FIXTURE_RESPONSES: p.responses, FINANCE_FIXTURE_STATE_PATH: p.state, FINANCE_FIXTURE_CANDIDATE_STATE_MODE: 'none', FINANCE_FIXTURE_SYMLINK_TARGET: p.old, FINANCE_FIXTURE_DENY_SERVICE_ACCESS: denied ? '1' : '' };
  const result = spawnSync('/bin/bash', [fixture.copied, 'deploy', p.lease], { env, encoding: 'utf8' });
  if (denied) {
    assert.notEqual(result.status, 0, 'root:root 0750-style service traversal denial fails before switch');
    assert.match(result.stdout, /^phase=SERVICE_USER_ACCESS$/m, 'service-user denial emits the owned access phase after cleanup');
    assert.match(result.stdout, /^failureClass=POSTWRITE_SERVICE_USER_ACCESS$/m, 'service-user denial names the postwrite failure');
    assert.match(result.stdout, /^failureExitStatus=77$/m, 'service-user denial retains the fixture access-denial status');
    assert.equal(result.stdout.includes('SECRET='), false, 'service-user receipt does not expose env data');
    assert.equal(readlinkSync(p.current), p.old, 'denied traversal preserves old current');
    assert.equal(lstatSync(p.releaseContainer, { throwIfNoEntry: false }), undefined, 'denied traversal cleans the exact empty release container');
    assert.equal(lstatSync(p.stage, { throwIfNoEntry: false }), undefined, 'denied traversal cleans the exact staged residue');
    assert.equal(lstatSync(p.stageContainer, { throwIfNoEntry: false }), undefined, 'denied traversal cleans the exact stage container');
    assert.equal(lstatSync(p.backup, { throwIfNoEntry: false }), undefined, 'denied traversal cleans the exact backup residue');
    assert.equal(lstatSync(p.backupContainer, { throwIfNoEntry: false }), undefined, 'denied traversal cleans the exact backup container');
    return;
  }
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  const expected = JSON.parse(readFileSync(p.lease, 'utf8')).paths.releaseContainer;
  assert.match(tuple(p.releaseContainer), new RegExp(`^${expected.uid}:${expected.gid}:${expected.mode}:`), 'root:ynx 0750-style signed owner/group/mode is rechecked');
  assert.equal(readlinkSync(p.current), p.release, 'positive service traversal selects candidate');
}
function releaseContainerNonNoopGidFixture() {
  const fixture = makeFixture(false); const p = fixture.paths; const lease = JSON.parse(readFileSync(p.lease, 'utf8'));
  const currentGid = Number(shell('/opt/homebrew/bin/gstat', ['-Lc', '%g', p.parents.release]));
  const alternateGid = shell('/usr/bin/id', ['-G']).split(/\s+/).map(Number).find(gid => gid !== currentGid);
  assert.notEqual(alternateGid, undefined, 'fixture host exposes a real alternate supplementary gid');
  lease.paths.releaseContainer.gid = alternateGid; lease.fresh.service.gid = alternateGid;
  write(p.lease, `${JSON.stringify(lease)}\n`);
  const env = { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, FINANCE_FIXTURE_SERVICE: p.service, FINANCE_FIXTURE_RESPONSES: p.responses, FINANCE_FIXTURE_STATE_PATH: p.state, FINANCE_FIXTURE_CANDIDATE_STATE_MODE: 'none', FINANCE_FIXTURE_SYMLINK_TARGET: p.old };
  const result = spawnSync('/bin/bash', [fixture.copied, 'deploy', p.lease], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(Number(shell('/opt/homebrew/bin/gstat', ['-Lc', '%g', p.releaseContainer])), alternateGid, 'release container accepts a real non-noop gid transition');
  assert.equal(readlinkSync(p.current), p.release, 'non-noop gid transition reaches the signed candidate');
}
function ownershipBoundarySubstitutionFixture(name) {
  const fixture = makeFixture(false); const p = fixture.paths; const container = p[`${name}Container`]; const marker = join(fixture.root, `${name}-preownership-identity`);
  const env = { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, FINANCE_FIXTURE_SERVICE: p.service, FINANCE_FIXTURE_RESPONSES: p.responses, FINANCE_FIXTURE_STATE_PATH: p.state, FINANCE_FIXTURE_CANDIDATE_STATE_MODE: 'none', FINANCE_FIXTURE_SYMLINK_TARGET: p.old, FINANCE_FIXTURE_SUBSTITUTE_CONTAINER_ON_CHOWN: container, FINANCE_FIXTURE_SUBSTITUTE_CONTAINER_MARKER: marker };
  const result = spawnSync('/bin/bash', [fixture.copied, 'deploy', p.lease], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${name} ownership-boundary inode replacement fails closed`);
  assert.equal(readlinkSync(p.current), p.old, `${name} ownership-boundary replacement preserves old current`);
  assert.ok(lstatSync(container).isDirectory(), `${name} replacement container is preserved`);
  const priorIdentity = readFileSync(marker, 'utf8').trim();
  const currentIdentity = shell('/opt/homebrew/bin/gstat', ['-Lc', '%d:%i:%h:%F', container]);
  assert.notEqual(currentIdentity, priorIdentity, `${name} fixture performed a real inode substitution`);
}
function releaseContainerFixture(kind) {
  const fixture = makeFixture(false); const p = fixture.paths;
  const foreignTarget = join(fixture.root, 'foreign-release-target'); mkdirSync(foreignTarget); write(join(foreignTarget, 'sentinel'), 'keep');
  const env = { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, FINANCE_FIXTURE_SERVICE: p.service, FINANCE_FIXTURE_RESPONSES: p.responses, FINANCE_FIXTURE_STATE_PATH: p.state, FINANCE_FIXTURE_CANDIDATE_STATE_MODE: 'none', FINANCE_FIXTURE_SYMLINK_TARGET: p.old, FINANCE_FIXTURE_RELEASE_CONTAINER: p.releaseContainer, FINANCE_FIXTURE_FOREIGN_TARGET: foreignTarget };
  if (kind === 'missing-parent') rmSync(p.parents.release, { recursive: true });
  if (kind === 'foreign') env.FINANCE_FIXTURE_RELEASE_CREATE_MODE = 'foreign';
  if (kind === 'symlink') env.FINANCE_FIXTURE_RELEASE_CREATE_MODE = 'symlink';
  if (kind === 'cleanup') env.FINANCE_FIXTURE_FAIL_MOVE_TARGET = p.release;
  if (kind === 'substitution') { env.FINANCE_FIXTURE_FAIL_MOVE_TARGET = p.release; env.FINANCE_FIXTURE_SUBSTITUTE_RELEASE_CONTAINER = '1'; }
  const result = spawnSync('/bin/bash', [fixture.copied, 'deploy', p.lease], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${kind} must fail closed`);
  assert.equal(readlinkSync(p.current), p.old, `${kind} preserves old current`);
  if (kind === 'missing-parent' || kind === 'cleanup') assert.equal(lstatSync(p.releaseContainer, { throwIfNoEntry: false }), undefined, `${kind} leaves no owned release container`);
  if (kind === 'foreign') { assert.ok(lstatSync(p.releaseContainer).isDirectory(), 'foreign non-empty directory preserved'); assert.equal(readFileSync(join(p.releaseContainer, 'foreign'), 'utf8'), 'foreign'); }
  if (kind === 'symlink' || kind === 'substitution') { assert.ok(lstatSync(p.releaseContainer).isSymbolicLink(), `${kind} symlink preserved`); assert.equal(readFileSync(join(foreignTarget, 'sentinel'), 'utf8'), 'keep'); }
}
function stagingContainerFixture(name, kind) {
  const fixture = makeFixture(false); const p = fixture.paths; const container = p[`${name}Container`]; const leaf = p[name];
  const foreignTarget = join(fixture.root, `${name}-${kind}-foreign`); mkdirSync(foreignTarget); write(join(foreignTarget, 'sentinel'), 'keep');
  const env = { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, FINANCE_FIXTURE_SERVICE: p.service, FINANCE_FIXTURE_RESPONSES: p.responses, FINANCE_FIXTURE_STATE_PATH: p.state, FINANCE_FIXTURE_CANDIDATE_STATE_MODE: 'none', FINANCE_FIXTURE_SYMLINK_TARGET: p.old, FINANCE_FIXTURE_CONTAINER_PATH: container, FINANCE_FIXTURE_FOREIGN_TARGET: foreignTarget };
  if (kind === 'missing-parent') rmSync(p.parents[name], { recursive: true });
  if (kind === 'foreign-prewrite') { mkdirSync(container); write(join(container, 'foreign'), 'foreign'); }
  if (kind === 'symlink-prewrite') symlinkSync(foreignTarget, container);
  if (kind === 'foreign-postcreate') env.FINANCE_FIXTURE_CONTAINER_CREATE_MODE = 'foreign';
  if (kind === 'symlink-postcreate') env.FINANCE_FIXTURE_CONTAINER_CREATE_MODE = 'symlink';
  if (kind === 'leaf-failure') env.FINANCE_FIXTURE_FAIL_MKDIR_PATH = leaf;
  const result = spawnSync('/bin/bash', [fixture.copied, 'deploy', p.lease], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${name} ${kind} fails closed`);
  assert.equal(readlinkSync(p.current), p.old, `${name} ${kind} preserves old current`);
  if (kind === 'missing-parent' || kind === 'leaf-failure') assert.equal(lstatSync(container, { throwIfNoEntry: false }), undefined, `${name} exact empty container absent or cleaned`);
  if (kind.includes('foreign')) { assert.ok(lstatSync(container).isDirectory(), `${name} foreign container preserved`); assert.equal(readFileSync(join(container, 'foreign'), 'utf8'), 'foreign'); }
  if (kind.includes('symlink')) { assert.ok(lstatSync(container).isSymbolicLink(), `${name} substituted symlink preserved`); assert.equal(readFileSync(join(foreignTarget, 'sentinel'), 'utf8'), 'keep'); }
}
function releasePostMoveSubstitutionFixture() {
  const fixture = makeFixture(true); const p = fixture.paths;
  const foreignTarget = join(fixture.root, 'post-move-foreign-release'); mkdirSync(foreignTarget); write(join(foreignTarget, 'sentinel'), 'keep');
  const env = { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, FINANCE_FIXTURE_SERVICE: p.service, FINANCE_FIXTURE_RESPONSES: p.responses, FINANCE_FIXTURE_STATE_PATH: p.state, FINANCE_FIXTURE_CANDIDATE_STATE_MODE: 'file', FINANCE_FIXTURE_SYMLINK_TARGET: p.old, FINANCE_FIXTURE_RELEASE_CONTAINER: p.releaseContainer, FINANCE_FIXTURE_RELEASE_PATH: p.release, FINANCE_FIXTURE_FOREIGN_TARGET: foreignTarget, FINANCE_FIXTURE_SUBSTITUTE_RELEASE_ON_CURL: '1', FINANCE_FIXTURE_SUBSTITUTE_MARKER: join(fixture.root, 'release-substituted') };
  const result = spawnSync('/bin/bash', [fixture.copied, 'deploy', p.lease], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'post-move substitution fails closed');
  assert.equal(readlinkSync(p.current), p.old, 'post-move substitution restores old current');
  assert.ok(lstatSync(p.release).isSymbolicLink(), 'unowned substituted release preserved');
  assert.equal(readFileSync(join(foreignTarget, 'sentinel'), 'utf8'), 'keep', 'substitution target preserved');
  assert.ok(lstatSync(p.releaseContainer).isDirectory(), 'non-empty release container preserved');
}
function manualRollbackFixture(kind = 'success') {
  const id = 'p0999-finance-phase3-20260823T000000Z'; const fixture = makeFixture(false, { id }); const p = fixture.paths;
  const env = { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, FINANCE_FIXTURE_SERVICE: p.service, FINANCE_FIXTURE_RESPONSES: p.responses, FINANCE_FIXTURE_STATE_PATH: p.state, FINANCE_FIXTURE_CANDIDATE_STATE_MODE: 'none', FINANCE_FIXTURE_SYMLINK_TARGET: p.old };
  const deployed = spawnSync('/bin/bash', [fixture.copied, 'deploy', p.lease], { env, encoding: 'utf8' });
  assert.equal(deployed.status, 0, `${deployed.stdout}${deployed.stderr}`);
  const receipt = Object.fromEntries(deployed.stdout.trim().split('\n').filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.equal(receipt.releaseContainer, p.releaseContainer); assert.equal(receipt.release, p.release);
  for (const key of ['backupContainerIdentityTuple', 'backupContainerTuple', 'backupContainerInventorySha256', 'backupTuple', 'backupIdentityTuple', 'backupInventorySha256', 'candidateServicePid', 'candidateServiceNRestarts']) assert.ok(receipt[key], `deploy receipt directly emits ${key}`);
  const rollbackLease = JSON.parse(readFileSync(p.lease, 'utf8')); rollbackLease.lease.kind = 'FINANCE_ROLLBACK_FIRST_PRODUCTION_MANUAL_ROLLBACK'; rollbackLease.success = { parents: { stage: { tuple: receipt.stageParentTuple }, backup: { tuple: receipt.backupParentTuple }, release: { tuple: receipt.releaseParentTuple } }, releaseContainer: { identityTuple: receipt.releaseContainerIdentityTuple, emptyTuple: receipt.releaseContainerEmptyTuple, tuple: receipt.releaseContainerTuple }, release: { tuple: receipt.releaseTuple, inventorySha256: receipt.releaseInventorySha256 }, backupContainer: { identityTuple: receipt.backupContainerIdentityTuple, tuple: receipt.backupContainerTuple, inventorySha256: receipt.backupContainerInventorySha256 }, backup: { tuple: receipt.backupTuple, identityTuple: receipt.backupIdentityTuple, inventorySha256: receipt.backupInventorySha256 }, service: { pid: Number(receipt.candidateServicePid), nrestarts: Number(receipt.candidateServiceNRestarts) } };
  const rollbackBytes = Buffer.from(`${JSON.stringify(rollbackLease)}\n`); const financeParent = dirname(p.lease); const installedExecutor = join(financeParent, `${id}.executor.sh`); cpSync(fixture.copied, installedExecutor); chmodSync(installedExecutor, 0o700);
  const foreignTarget = join(fixture.root, `manual-${kind}-foreign`); mkdirSync(foreignTarget); write(join(foreignTarget, 'sentinel'), 'keep');
  if (kind === 'foreign') write(join(p.release, 'foreign'), 'foreign');
  if (kind === 'substitution') { rmSync(p.release, { recursive: true }); symlinkSync(foreignTarget, p.release); }
  // This boundary represents a separately observed external/browser gate
  // failure after deploy success and before Central signs manual rollback.
  let rollbackBootstrap = readFileSync(new URL('./finance-phase3-stdin-manual-rollback-bootstrap.sh', import.meta.url), 'utf8').replaceAll('/opt/ynx', dirname(dirname(p.env))).replaceAll('stat -Lc', '/opt/homebrew/bin/gstat -Lc').replaceAll('mv -T --', '/bin/mv --');
  const foreignManualTarget = join(fixture.root, `manual-${kind}-transport-foreign`); mkdirSync(foreignManualTarget); write(join(foreignManualTarget, 'sentinel'), 'keep');
  if (kind === 'substitution') rollbackBootstrap = rollbackBootstrap.replace('/bin/mv -- "$pending" "$target"', '/bin/mv -- "$pending" "$target"; /bin/rm -f "$target"; /bin/ln -s "' + foreignManualTarget + '" "$target"');
  const rollbackArgs = [id, phase1DirectoryTuple(financeParent), installedExecutor, phase1DirectoryTuple(installedExecutor), sha(installedExecutor), String(rollbackBytes.length), shaBuffer(rollbackBytes), '600'];
  const rolledBack = spawnSync('/bin/bash', ['-c', rollbackBootstrap, 'manual', ...rollbackArgs], { input: rollbackBytes, env, encoding: 'utf8' });
  if (kind === 'success') {
    assert.equal(rolledBack.status, 0, `${rolledBack.stdout}${rolledBack.stderr}`);
    assert.equal(readlinkSync(p.current), p.old, 'separate manual rollback restores old current');
    assert.equal(readFileSync(p.env, 'utf8'), 'SECRET=kept-local\nYNX_FINANCE_WEB_DIR=old\nOTHER=value\n', 'separate manual rollback restores old env');
    assert.equal(lstatSync(p.release, { throwIfNoEntry: false }), undefined, 'manual rollback removes exact release');
    assert.equal(lstatSync(p.releaseContainer, { throwIfNoEntry: false }), undefined, 'manual rollback removes exact empty release container');
    assert.equal(lstatSync(p.backup, { throwIfNoEntry: false }), undefined, 'manual rollback removes exact backup leaf');
    assert.equal(lstatSync(p.backupContainer, { throwIfNoEntry: false }), undefined, 'manual rollback removes exact empty backup container');
  } else {
    assert.notEqual(rolledBack.status, 0, `manual rollback ${kind} fails closed`);
    assert.equal(readlinkSync(p.current), p.release, `manual rollback ${kind} does not mutate current before identity proof`);
    if (kind === 'foreign') assert.equal(readFileSync(join(p.release, 'foreign'), 'utf8'), 'foreign', 'foreign release content preserved');
    else { assert.ok(lstatSync(p.release).isSymbolicLink(), 'substituted release preserved'); assert.equal(readFileSync(join(foreignTarget, 'sentinel'), 'utf8'), 'keep'); assert.ok(lstatSync(join(financeParent, `${id}.manual-rollback.json`)).isSymbolicLink(), 'transport-substituted rollback target preserved'); assert.equal(readFileSync(join(foreignManualTarget, 'sentinel'), 'utf8'), 'keep'); }
  }
}
function generatorNegative(kind) {
  const fixture = makeFixture(false); const source = fixture.paths.env; if (kind === 'missing') write(source, 'SECRET=kept-local\n'); else write(source, 'YNX_FINANCE_WEB_DIR=one\nYNX_FINANCE_WEB_DIR=two\n');
  rmSync(fixture.paths.newEnv); const result = spawnSync('/bin/bash', [fixture.generator, source, fixture.paths.newEnv, fixture.paths.targetWeb], { env: { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}` }, encoding: 'utf8' }); assert.notEqual(result.status, 0, `${kind} must fail closed`); assert.equal(lstatSync(fixture.paths.newEnv, { throwIfNoEntry: false }), undefined, `${kind} leaves no candidate`); assert.equal(result.stdout.includes('SECRET='), false, 'negative generator output is secret-safe');
}
function phase1Fixture() {
  const newPhase1 = () => {
    const dir = mkdtempSync(join(root, 'phase1-')); const ynx = join(dir, 'opt', 'ynx'); const bin = join(dir, 'bin'); mkdirSync(ynx, { recursive: true }); mkdirSync(bin); makeWrappers(bin);
    const bootstrap = join(dir, 'bootstrap.sh'); writeFileSync(bootstrap, readFileSync(new URL('./finance-candidate-env-placement-bootstrap.sh', import.meta.url), 'utf8').replaceAll('/opt/ynx', ynx)); chmodSync(bootstrap, 0o755);
    return { dir, ynx, bin, bootstrap, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
  };
  const run = (fixture, id, extra = {}) => spawnSync('/bin/bash', [fixture.bootstrap, id, phase1DirectoryTuple(fixture.ynx)], { env: { ...fixture.env, ...extra }, encoding: 'utf8' });

  const success = newPhase1(); const result = run(success, 'phase1-run'); const carrier = join(success.ynx, 'stage', 'finance', 'phase1-run');
  assert.equal(result.status, 0, result.stderr); assert.ok(result.stdout.includes(`root=${success.ynx}`) && result.stdout.includes(`carrier=${carrier}`) && result.stdout.includes('carrierEmpty=true'), 'phase1 tuple receipt'); assert.ok(result.stdout.includes(':directory'), 'phase1 receipt binds directory type'); assert.ok(lstatSync(carrier).isDirectory(), 'phase1 retains carrier');
  for (const [label, path] of [['root', success.ynx], ['stageParent', join(success.ynx, 'stage')], ['stage', join(success.ynx, 'stage', 'finance')], ['leasesParent', join(success.ynx, 'leases')], ['leases', join(success.ynx, 'leases', 'finance-preparation')], ['carrier', carrier]]) assert.ok(result.stdout.includes(`${label}Tuple=${phase1DirectoryTuple(path)}`), `phase1 emits settled ${label} tuple after child creation`);
  assert.notEqual(run(success, '../bad').status, 0, 'traversal refused');

  for (const level of ['stage', 'stage/finance', 'leases', 'leases/finance-preparation', 'stage/finance/mkdir-failure']) {
    const mkdirFailure = newPhase1(); const failurePath = join(mkdirFailure.ynx, level);
    wrapper(mkdirFailure.bin, 'mkdir', 'for arg in "$@"; do [[ "$arg" == "${FINANCE_PHASE1_FAIL_MKDIR_PATH:-}" ]] && exit 73; done\nexec /bin/mkdir "$@"');
    assert.notEqual(run(mkdirFailure, 'mkdir-failure', { FINANCE_PHASE1_FAIL_MKDIR_PATH: failurePath }).status, 0, `partial mkdir failure fails at ${level}`);
    for (const path of [join(mkdirFailure.ynx, 'stage', 'finance'), join(mkdirFailure.ynx, 'stage'), join(mkdirFailure.ynx, 'leases', 'finance-preparation'), join(mkdirFailure.ynx, 'leases')]) assert.equal(lstatSync(path, { throwIfNoEntry: false }), undefined, `partial failure removes ${path} in reverse`);
  }

  const symlink = newPhase1(); const symlinkStageParent = join(symlink.ynx, 'stage'); const preservedTarget = join(symlink.dir, 'preserved'); mkdirSync(preservedTarget); write(join(preservedTarget, 'sentinel'), 'keep'); symlinkSync(preservedTarget, symlinkStageParent);
  assert.notEqual(run(symlink, 'symlink-refusal').status, 0, 'intermediate symlink refused'); assert.equal(readFileSync(join(preservedTarget, 'sentinel'), 'utf8'), 'keep', 'symlink target preserved'); assert.ok(lstatSync(symlinkStageParent).isSymbolicLink(), 'symlink preserved');

  const substituted = newPhase1(); const substitutedCarrier = join(substituted.ynx, 'stage', 'finance', 'substituted'); const substituteTarget = join(substituted.dir, 'substitute-target'); mkdirSync(substituteTarget); write(join(substituteTarget, 'sentinel'), 'keep');
  // The real bootstrap observes an attacker substitution before tuple capture.
  wrapper(substituted.bin, 'mkdir', '/bin/mkdir "$@"\nfor arg in "$@"; do if [[ "$arg" == "${FINANCE_PHASE1_SUBSTITUTE_PATH:-}" ]]; then /bin/rmdir "$arg"; /bin/ln -s "$FINANCE_PHASE1_SUBSTITUTE_TARGET" "$arg"; fi; done');
  assert.notEqual(run(substituted, 'substituted', { FINANCE_PHASE1_SUBSTITUTE_PATH: substitutedCarrier, FINANCE_PHASE1_SUBSTITUTE_TARGET: substituteTarget }).status, 0, 'post-create substitution refused'); assert.ok(lstatSync(substitutedCarrier).isSymbolicLink(), 'substituted symlink preserved'); assert.equal(readFileSync(join(substituteTarget, 'sentinel'), 'utf8'), 'keep', 'substitution target preserved');

  const sibling = newPhase1(); const siblingStage = join(sibling.ynx, 'stage', 'finance'); const siblingPath = join(siblingStage, 'unowned-sibling'); const siblingLeasesParent = join(sibling.ynx, 'leases');
  // Inject after the first created directory tuple is captured, then fail the
  // next mkdir: the trap must refuse to remove an unowned sibling.
  wrapper(sibling.bin, 'stat', 'if [[ "$*" == *"' + siblingStage + '"* && ! -e "' + siblingPath + '" ]]; then /bin/mkdir -p "' + siblingPath + '"; fi\nexec /opt/homebrew/bin/gstat "$@"');
  wrapper(sibling.bin, 'mkdir', 'for arg in "$@"; do [[ "$arg" == "${FINANCE_PHASE1_FAIL_MKDIR_PATH:-}" ]] && exit 73; done\nexec /bin/mkdir "$@"');
  assert.notEqual(run(sibling, 'sibling-refusal', { FINANCE_PHASE1_FAIL_MKDIR_PATH: siblingLeasesParent }).status, 0, 'unowned sibling blocks cleanup'); assert.ok(lstatSync(siblingPath).isDirectory(), 'unowned sibling preserved'); assert.ok(lstatSync(siblingStage).isDirectory(), 'parent preserved rather than deleting sibling'); assert.ok(lstatSync(join(sibling.ynx, 'stage')).isDirectory(), 'intermediate parent preserved rather than deleting sibling');
}
function preparationFixture() {
  const build = (id = 'prep-id') => {
    const fixture = makeFixture(false); const p = fixture.paths; const ynx = dirname(dirname(p.env)); const carrier = join(ynx, 'stage', 'finance', id); const leaseParent = join(ynx, 'leases', 'finance-preparation'); mkdirSync(carrier, { recursive: true }); mkdirSync(leaseParent, { recursive: true });
    const input = join(leaseParent, `${id}.archive.tgz`); cpSync(p.archive, input); const generator = join(leaseParent, `${id}.generator.sh`); write(generator, readFileSync(fixture.generator)); chmodSync(generator, 0o755); const preparation = join(leaseParent, `${id}.phase2b.sh`); writeFileSync(preparation, readFileSync(new URL('./finance-candidate-env-preparation.sh', import.meta.url), 'utf8').replaceAll('/opt/ynx', ynx).replaceAll('/etc/ynx', join(ynx, 'etc'))); chmodSync(preparation, 0o755);
    const tupleFile = path => shell('/opt/homebrew/bin/gstat', ['-Lc', '%d:%i:%u:%g:%a:%h:%s:%F', path]); const leasePath = join(leaseParent, `${id}.json`); write(leasePath, '{}\n');
    const lease = { lease: { signed: true, kind: 'FINANCE_PHASE2_CANDIDATE_ENV_PREPARATION', id }, phase1: { rootTuple: phase1DirectoryTuple(ynx), stageParentTuple: phase1DirectoryTuple(join(ynx, 'stage')), stageTuple: phase1DirectoryTuple(join(ynx, 'stage', 'finance')), leasesParentTuple: phase1DirectoryTuple(join(ynx, 'leases')), leaseParentTuple: phase1DirectoryTuple(leaseParent), carrier: { path: carrier, tuple: phase1DirectoryTuple(carrier) } }, objects: { archive: { path: input, tuple: tupleFile(input), sha256: sha(input), bytes: bytes(input) }, generator: { path: generator, tuple: tupleFile(generator), sha256: sha(generator), bytes: bytes(generator) }, executor: { path: preparation, tuple: tupleFile(preparation), sha256: sha(preparation), bytes: bytes(preparation) } }, fresh: { env: { sha256: sha(p.env), bytes: bytes(p.env) } }, requiredEnvKeys: ['YNX_FINANCE_WEB_DIR'], candidate: { releaseWebDir: p.targetWeb } }; write(leasePath, `${JSON.stringify(lease)}\n`); return { fixture, p, ynx, carrier, leaseParent, input, generator, preparation, leasePath, lease, env: { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}` } };
  };
  const good = build(); const result = spawnSync('/bin/bash', [good.preparation, good.leasePath], { env: good.env, encoding: 'utf8' }); if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`); assert.equal(result.stdout.includes('SECRET='), false, 'preparation output secret-safe'); assert.ok(result.stdout.includes(`candidateEnv=${join(good.carrier, 'finance.env')}`) && result.stdout.includes(`archiveTuple=`), 'preparation frozen tuples');
  const mismatch = build('hash-mismatch'); write(mismatch.generator, 'tampered'); assert.notEqual(spawnSync('/bin/bash', [mismatch.preparation, mismatch.leasePath], { env: mismatch.env, encoding: 'utf8' }).status, 0, 'hash mismatch fails closed'); assert.equal(lstatSync(join(mismatch.carrier, 'candidate.tgz'), { throwIfNoEntry: false }), undefined, 'terminal cleanup leaves no archive');
  const symlink = build('symlink'); rmSync(symlink.input); symlinkSync(symlink.p.old, symlink.input); assert.notEqual(spawnSync('/bin/bash', [symlink.preparation, symlink.leasePath], { env: symlink.env, encoding: 'utf8' }).status, 0, 'symlink input refused'); assert.ok(lstatSync(symlink.input).isSymbolicLink(), 'symlink preserved');
  const traversal = build('traversal'); traversal.lease.lease.id = '../traversal'; write(traversal.leasePath, `${JSON.stringify(traversal.lease)}\n`); assert.notEqual(spawnSync('/bin/bash', [traversal.preparation, traversal.leasePath], { env: traversal.env, encoding: 'utf8' }).status, 0, 'traversal id refused');
}
function crossStagePhase3Fixture() {
  const id = 'p0237-finance-phase3-20260823T060000Z';
  const fixture = makeFixture(false, { id }); const p = fixture.paths;
  const ynx = dirname(dirname(p.env)); const leasesParent = join(ynx, 'leases'); const deployParent = dirname(p.lease);
  const executorBytes = readFileSync(fixture.copied); const leaseBytes = readFileSync(p.lease);

  // Phase 2B left the immutable archive/env directly in the fixed P0-228
  // carrier. Phase 3 owns only its new deploy-parent children.
  const carrierBefore = phase1DirectoryTuple(p.carrier);
  // Phase3 consumes the pre-existing, Central-bound finance lease parent. It
  // must never recreate or remove that directory; only this lease's children
  // are eligible for placement/finalization.
  const deployParentBefore = phase1DirectoryTuple(deployParent);
  const deployParentIdentityBefore = retainedDirectoryIdentity(deployParent);
  const archiveBefore = { tuple: phase1DirectoryTuple(p.archive), bytes: bytes(p.archive), sha256: sha(p.archive) };
  const envBefore = { tuple: phase1DirectoryTuple(p.newEnv), bytes: bytes(p.newEnv), sha256: sha(p.newEnv) };
  for (const path of [p.stageContainer, p.stage, p.backupContainer, p.backup, p.releaseContainer, p.release]) assert.equal(lstatSync(path, { throwIfNoEntry: false }), undefined, `new lease path ${basename(path)} starts absent`);

  const bootstrap = readFileSync(new URL('./finance-phase3-stdin-deployment-bootstrap.sh', import.meta.url), 'utf8')
    .replaceAll('/opt/ynx', ynx)
    .replaceAll('stat -Lc', '/opt/homebrew/bin/gstat -Lc')
    .replaceAll('base64 -d', 'base64 -D')
    .replaceAll('mv -T --', '/bin/mv --');
  const args = [
    id, p.carrier, phase1DirectoryTuple(ynx), deployParentBefore, carrierBefore,
    archiveBefore.tuple, archiveBefore.sha256, String(archiveBefore.bytes),
    envBefore.tuple, envBefore.sha256, String(envBefore.bytes),
    executorBytes.toString('base64'), String(executorBytes.length), shaBuffer(executorBytes),
    String(leaseBytes.length), shaBuffer(leaseBytes)
  ];
  const env = { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}`, FINANCE_FIXTURE_SERVICE: p.service, FINANCE_FIXTURE_RESPONSES: p.responses, FINANCE_FIXTURE_STATE_PATH: p.state, FINANCE_FIXTURE_CANDIDATE_STATE_MODE: 'none', FINANCE_FIXTURE_SYMLINK_TARGET: p.old };
  const result = spawnSync('/bin/bash', ['-c', bootstrap, 'phase3', ...args], { input: leaseBytes, env, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.ok(result.stdout.includes('phase=3') && result.stdout.includes('releaseContainerTuple=') && result.stdout.includes('backupContainerTuple=') && result.stdout.includes('backupContainerInventorySha256=') && result.stdout.includes('backupTuple=') && result.stdout.includes('backupInventorySha256=') && result.stdout.includes('candidateServicePid=') && result.stdout.includes('candidateServiceNRestarts=') && result.stdout.includes(`lease=${join(leasesParent, 'finance', `${id}.json`)}`), 'exact bootstrap preserves real executor success receipts');
  assert.equal(readlinkSync(p.current), p.release, 'new lease-owned release selected');
  assert.equal(phase1DirectoryTuple(p.carrier), carrierBefore, 'fixed P0-228 carrier identity retained');
  // Regular lease children can change a directory's nlink/byte accounting;
  // its durable identity must nevertheless be unchanged, proving the parent
  // was neither recreated nor replaced.
  assert.equal(retainedDirectoryIdentity(deployParent), deployParentIdentityBefore, 'retained Finance lease parent identity unchanged');
  assert.deepEqual({ tuple: phase1DirectoryTuple(p.archive), bytes: bytes(p.archive), sha256: sha(p.archive) }, archiveBefore, 'archive retained byte-exact');
  assert.deepEqual({ tuple: phase1DirectoryTuple(p.newEnv), bytes: bytes(p.newEnv), sha256: sha(p.newEnv) }, envBefore, 'candidate env retained byte-exact');
  assert.ok(p.stage.includes(`/${id}/`) && p.backup.includes(`/${id}/`) && p.release.includes(`/${id}/`), 'new deployment lease owns only mutable paths');
  const installedExecutor = join(leasesParent, 'finance', `${id}.executor.sh`); const installedLease = join(leasesParent, 'finance', `${id}.json`);
  assert.equal(sha(installedExecutor), shaBuffer(executorBytes), 'installed executor exact');
  assert.equal(sha(installedLease), shaBuffer(leaseBytes), 'installed signed lease exact');
}
execute(false); execute(true, { candidateState: 'file' }); execute(true, { absent: true, candidateState: 'file' }); execute(true, { absent: true, candidateState: 'symlink' }); execute(true, { absent: true, candidateState: 'file', substitute: true }); execute(true, { envMismatch: true }); serviceTraversalFixture(true); serviceTraversalFixture(false); releaseContainerNonNoopGidFixture(); for (const name of ['stage', 'backup', 'release']) ownershipBoundarySubstitutionFixture(name); for (const name of ['stage', 'backup']) for (const kind of ['missing-parent', 'foreign-prewrite', 'symlink-prewrite', 'foreign-postcreate', 'symlink-postcreate', 'leaf-failure']) stagingContainerFixture(name, kind); releaseContainerFixture('missing-parent'); releaseContainerFixture('foreign'); releaseContainerFixture('symlink'); releaseContainerFixture('cleanup'); releaseContainerFixture('substitution'); releasePostMoveSubstitutionFixture(); manualRollbackFixture(); manualRollbackFixture('foreign'); manualRollbackFixture('substitution'); generatorNegative('missing'); generatorNegative('duplicate'); phase1Fixture(); preparationFixture(); crossStagePhase3Fixture(); console.log('finance production actual-shell fixture: pass');
