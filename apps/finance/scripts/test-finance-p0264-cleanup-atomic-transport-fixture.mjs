#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const repo = process.cwd();
const commandSource = join(repo, 'apps/finance/scripts/finance-p0264-cleanup-literal-transport-command.sh');
const bootstrapSource = join(repo, 'apps/finance/scripts/finance-p0264-cleanup-atomic-transport-bootstrap.sh');
const builder = join(repo, 'apps/finance/scripts/build-finance-p0264-cleanup-atomic-carrier.mjs');
const id = 'p0264-finance-p0247-cleanup-20260823T110000Z';
const gstat = '/opt/homebrew/bin/gstat';
const digest = value => createHash('sha256').update(value).digest('hex');
const sha = path => digest(readFileSync(path));
const bytes = path => readFileSync(path).length;
const stat = path => execFileSync(gstat, ['-Lc', '%d:%i:%u:%g:%a:%h:%s:%F', path], { encoding: 'utf8' }).trim();

const commandText = readFileSync(commandSource, 'utf8');
assert.equal((commandText.match(/\/usr\/bin\/ssh/g) || []).length, 1, 'literal command contains one production SSH invocation');
assert.match(commandText, /if "\$ssh_bin"[\s\S]*transport_rc=0[\s\S]*else[\s\S]*transport_rc=\$\?/);
assert.match(commandText, /remote_quote\(\)/, 'remote argv must be shell-quoted as one SSH command');
assert.match(commandText, /terminal_receipt_valid\(\)/, 'zero SSH status requires a bound terminal receipt');
assert.doesNotMatch(commandText, /printf\s+"\$[^" ]+"/, 'printf format must always be literal');

function make({ cleanupRc = 0, mutateBootstrap, silentSsh = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ynx-p0264-atomic-')));
  const parent = join(root, 'opt/ynx/leases/finance'); mkdirSync(parent, { recursive: true, mode: 0o750 });
  const bin = join(root, 'bin'); mkdirSync(bin);
  const executor = join(root, 'executor.sh'); const signedLease = join(root, 'signed.json'); const carrier = join(root, 'carrier'); const bootstrap = join(root, 'bootstrap.sh');
  const events = join(root, 'events'); const stdout = join(root, 'stdout'); const stderr = join(root, 'stderr');
  writeFileSync(executor, `#!/bin/sh\nprintf 'cleanup-called\\n' >> ${JSON.stringify(events)}\nif test ${cleanupRc} = 0; then printf 'cleanup=P0247_RESIDUES_REMOVED\\n'; fi\nexit ${cleanupRc}\n`); chmodSync(executor, 0o700);
  writeFileSync(signedLease, `${JSON.stringify({ lease: { signed: true, kind: 'FINANCE_P0247_RESIDUE_CLEANUP_ONLY', id, p0247: { id: 'p0247-finance-phase3-20260823T073800Z' } } })}\n`); chmodSync(signedLease, 0o600);
  execFileSync(process.execPath, [builder, executor, signedLease, carrier]);
  let bootstrapText = readFileSync(bootstrapSource, 'utf8').replaceAll('/opt/ynx/leases/finance', parent).replaceAll('stat -Lc', `${gstat} -Lc`).replaceAll('mv -T --', '/bin/mv --').replaceAll('basename --', 'basename').replaceAll('rm -f --', '/opt/homebrew/bin/grm -f --').replaceAll('chmod 0700 --', 'chmod 0700').replaceAll('chmod 0600 --', 'chmod 0600');
  if (mutateBootstrap) bootstrapText = mutateBootstrap(bootstrapText, { root, parent, executor, signedLease });
  writeFileSync(bootstrap, bootstrapText); chmodSync(bootstrap, 0o700);
  writeFileSync(join(bin, 'base64'), '#!/bin/sh\nexec /opt/homebrew/bin/gbase64 "$@"\n'); chmodSync(join(bin, 'base64'), 0o755);
  writeFileSync(join(bin, 'stat'), `#!/bin/sh\nexec ${gstat} "$@"\n`); chmodSync(join(bin, 'stat'), 0o755);
  writeFileSync(join(bin, 'rm'), '#!/bin/sh\nexec /opt/homebrew/bin/grm "$@"\n'); chmodSync(join(bin, 'rm'), 0o755);
  writeFileSync(join(bin, 'jq'), '#!/bin/sh\nexec /usr/bin/jq "$@"\n'); chmodSync(join(bin, 'jq'), 0o755);
  const sudoStub = join(root, 'sudo-stub');
  writeFileSync(sudoStub, '#!/bin/bash\nset -eu\ntest "$1" = -n; shift\nexec "$@"\n'); chmodSync(sudoStub, 0o700);
  const sshStub = join(root, 'ssh-stub');
  writeFileSync(sshStub, silentSsh ? '#!/bin/bash\nexit 0\n' : '#!/bin/bash\nset -eu\nwhile [[ $# -gt 0 && "$1" != ubuntu@43.153.202.237 ]]; do shift; done\ntest "$1" = ubuntu@43.153.202.237; shift\ntest "$#" = 1\nexec /bin/bash -c "$1"\n'); chmodSync(sshStub, 0o700);
  const args = [carrier, bootstrap, String(bytes(bootstrap)), sha(bootstrap), id, stat(parent), sha(executor), sha(signedLease), sha(carrier), stdout, stderr];
  return { root, parent, executor, signedLease, carrier, bootstrap, events, stdout, stderr, sshStub, sudoStub, args, targetExecutor: join(parent, `${id}.executor.sh`), targetLease: join(parent, `${id}.json`) };
}
function run(f) {
  return spawnSync('bash', [commandSource, ...f.args], { encoding: 'utf8', env: { ...process.env, PATH: `${join(f.root, 'bin')}:${process.env.PATH}`, FINANCE_P0264_TRANSPORT_TEST_ROOT: '1', FINANCE_P0264_SSH_BIN: f.sshStub, FINANCE_P0264_SUDO_BIN: f.sudoStub, FINANCE_P0264_REMOTE_PARENT: f.parent } });
}
function controlsAbsent(f) { for (const path of [f.targetExecutor, f.targetLease, `${f.targetExecutor}.pending`, `${f.targetLease}.pending`]) assert.equal(existsSync(path), false, path); }
function close(f) { rmSync(f.root, { recursive: true, force: true }); }

{ const f = make(); const r = run(f); assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}\n${existsSync(f.stderr) ? readFileSync(f.stderr, 'utf8') : ''}`); assert.equal(readFileSync(f.events, 'utf8'), 'cleanup-called\n'); assert.equal(readFileSync(`${f.stdout}.status`, 'utf8'), '0\n'); const receipt = readFileSync(f.stdout, 'utf8'); assert.match(receipt, /^cleanup=P0247_RESIDUES_REMOVED$/m); assert.match(receipt, /^cleanupInvocationCount=1$/m); assert.match(receipt, /^controlObjectsFinalAbsent=true$/m); assert.equal(receipt.trim().split('\n').length, 6, 'only the signed terminal receipt is accepted'); assert.doesNotMatch(receipt, /"lease"/); controlsAbsent(f); close(f); }
{ const f = make({ silentSsh: true }); const r = run(f); assert.equal(r.status, 65, 'a silent zero SSH exit is not cleanup success'); assert.equal(readFileSync(`${f.stdout}.status`, 'utf8'), '65\n'); assert.equal(readFileSync(f.stdout, 'utf8'), ''); assert.equal(existsSync(f.events), false, 'silent transport never invokes cleanup'); controlsAbsent(f); close(f); }
{ const f = make({ cleanupRc: 73 }); const r = run(f); assert.equal(r.status, 73); assert.equal(readFileSync(f.events, 'utf8'), 'cleanup-called\n'); assert.equal(readFileSync(`${f.stdout}.status`, 'utf8'), '73\n'); controlsAbsent(f); close(f); }
{ const f = make(); writeFileSync(f.targetExecutor, 'foreign'); const r = run(f); assert.notEqual(r.status, 0); assert.equal(readFileSync(f.targetExecutor, 'utf8'), 'foreign'); assert.equal(existsSync(f.events), false); close(f); }
{ const f = make(); const bad = Buffer.from(readFileSync(f.carrier)); bad[bad.length - 5] ^= 1; writeFileSync(f.carrier, bad); f.args[8] = sha(f.carrier); const r = run(f); assert.notEqual(r.status, 0); controlsAbsent(f); assert.equal(existsSync(f.events), false); close(f); }
{ const f = make({ mutateBootstrap: (text, ctx) => { const replacement = join(ctx.root, 'replacement-executor'); writeFileSync(replacement, readFileSync(ctx.executor)); chmodSync(replacement, 0o700); const marker = '/bin/mv -- "$executor_pending" "$executor" || exit 65; executor_pending_created=false;'; assert.ok(text.includes(marker)); return text.replace(marker, `/bin/mv -- "$executor_pending" "$executor" || exit 65; /bin/mv -- ${JSON.stringify(replacement)} "$executor"; executor_pending_created=false;`); } }); const r = run(f); assert.notEqual(r.status, 0, 'same-byte same-mode new inode after rename must fail'); assert.ok(lstatSync(f.targetExecutor).isFile()); assert.equal(sha(f.targetExecutor), sha(f.executor)); assert.equal(existsSync(f.events), false); close(f); }
{ const f = make(); const replacementParent = join(f.root, 'foreign-parent'); mkdirSync(replacementParent); writeFileSync(join(replacementParent, 'sentinel'), 'keep'); rmSync(f.parent, { recursive: true }); symlinkSync(replacementParent, f.parent); const r = run(f); assert.notEqual(r.status, 0); assert.ok(lstatSync(f.parent).isSymbolicLink()); assert.equal(readFileSync(join(replacementParent, 'sentinel'), 'utf8'), 'keep'); close(f); }
console.log('finance P0-264 cleanup atomic transport command fixture: PASS');
