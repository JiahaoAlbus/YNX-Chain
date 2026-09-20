import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const runner = fileURLToPath(new URL('../weekly-v3-finance-wallet-integration.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
function repository() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-weekly-guard-'));
  const owner = path.join(temp, 'owner');
  const remote = path.join(temp, 'remote.git');
  fs.mkdirSync(owner);
  git(temp, 'init', '--bare', remote);
  git(owner, 'init', '-b', 'codex/fixture-guard');
  git(owner, 'config', 'user.name', 'Public Test Fixture');
  git(owner, 'config', 'user.email', 'fixture@example.invalid');
  git(owner, 'config', 'commit.gpgSign', 'false');
  fs.writeFileSync(path.join(owner, 'owned.txt'), 'synthetic baseline\n');
  git(owner, 'add', 'owned.txt');
  git(owner, 'commit', '-m', 'Synthetic runner guard baseline');
  git(owner, 'remote', 'add', 'origin', remote);
  git(owner, 'push', '-u', 'origin', 'HEAD');
  return {temp, owner, commit: git(owner, 'rev-parse', 'HEAD')};
}
function reject({owner, commit, temp}, expected) {
  const output = path.join(temp, 'must-not-exist.json');
  // A nonexistent Wallet ensures these negative cases never test real owners.
  const result = spawnSync(process.execPath, [runner, '--finance-worktree', owner, '--finance-commit', commit,
    '--wallet-worktree', path.join(temp, 'NO_REAL_WALLET'), '--wallet-commit', 'b'.repeat(40),
    '--output', output], {encoding: 'utf8', timeout: 10000});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, expected);
  assert.equal(fs.existsSync(output), false);
}
test('runner rejects wrong Finance commit before invoking an owner test', () => {
  const repo = repository();
  reject({...repo, commit: 'a'.repeat(40)}, /finance checkpoint mismatch/);
});
test('runner rejects tracked changes outside Finance web/internal paths', () => {
  const repo = repository();
  fs.appendFileSync(path.join(repo.owner, 'owned.txt'), 'dirty\n');
  reject(repo, /git diff --quiet/);
});
test('runner rejects untracked Finance implementation before testing', () => {
  const repo = repository();
  fs.writeFileSync(path.join(repo.owner, 'new-worker.go'), '// synthetic uncommitted worker\n');
  reject(repo, /finance untracked product source/);
});
test('runner rejects clean local commit that was not pushed', () => {
  const repo = repository();
  fs.appendFileSync(path.join(repo.owner, 'owned.txt'), 'local-only\n');
  git(repo.owner, 'commit', '-am', 'Unpublished synthetic checkpoint');
  repo.commit = git(repo.owner, 'rev-parse', 'HEAD');
  reject(repo, /finance checkpoint is not the exact published branch head/);
});
test('runner preserves existing evidence without starting owner tests', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ynx-weekly-evidence-guard-'));
  const output = path.join(temp, 'preserved.json');
  fs.writeFileSync(output, 'preserved historical evidence\n');
  const result = spawnSync(process.execPath, [runner, '--output', output], {encoding: 'utf8', timeout: 10000});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Evidence output already exists; no owner tests were started/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'preserved historical evidence\n');
});
