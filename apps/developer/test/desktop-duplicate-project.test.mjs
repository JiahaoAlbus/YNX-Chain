import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('desktop launcher preserves only the typed project-lock refusal as exit 73', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-duplicate-launcher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const adapter = join(root, 'code/apps/developer/desktop');
  await mkdir(adapter, { recursive: true });
  await writeFile(join(root, 'server.mjs'), await readFile(new URL('../desktop/code-server.mjs', import.meta.url)));
  await writeFile(join(root, 'build-provenance.json'), JSON.stringify({
    schemaVersion: 1, productId: 'ynx-developer-v1', version: '0.2.0', sourceDirty: false,
    platform: `macos-${process.arch}`, sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), runtimeCheckpoint: 'a'.repeat(40),
  }));
  for (const [code, expected] of [['YNX_LOCAL_PROJECT_ALREADY_OPEN', 73], ['UNRELATED_FAILURE', 1]]) {
    await writeFile(join(adapter, 'local-workbench.mjs'), `export async function startLocalWorkbench(){throw Object.assign(Error('project lock refusal'),{code:${JSON.stringify(code)}});}`);
    const result = spawnSync(process.execPath, [join(root, 'server.mjs')], {
      env: { ...process.env, YNX_DEVELOPER_DESKTOP_MODE: 'local-workbench' }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, expected, result.stderr);
    assert.match(result.stderr, /project lock refusal/);
    assert.equal(result.stdout, '');
  }
});
