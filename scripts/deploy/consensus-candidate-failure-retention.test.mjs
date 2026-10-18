import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const relative = 'scripts/deploy/deploy-consensus-candidate.sh';
const current = readFileSync(join(root, relative), 'utf8');
const original = execFileSync('git', ['show', `5294cb2d91ced414ee16edde39318de017404e53:${relative}`], { cwd: root, encoding: 'utf8' });

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
