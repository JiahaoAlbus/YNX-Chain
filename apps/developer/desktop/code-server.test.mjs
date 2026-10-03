import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const sourceCommit = 'a'.repeat(40), sourceTree = 'b'.repeat(40);
const valid = { schemaVersion: 1, productId: 'ynx-developer-v1', version: '0.2.0', sourceDirty: false,
  platform: `macos-${process.arch}`, sourceCommit, sourceTree, runtimeCheckpoint: sourceCommit };
async function launch(record, inspect) {
  const root = await mkdtemp(join(tmpdir(), 'ynx-desktop-provenance-'));
  try {
    const gateway = join(root, 'code/apps/developer/services/gateway/src');
    await mkdir(gateway, { recursive: true });
    await copyFile(new URL('./code-server.mjs', import.meta.url), join(root, 'code-server.mjs'));
    if (record !== undefined) await writeFile(join(root, 'build-provenance.json'), JSON.stringify(record));
    // Exercise the actual launcher through its normal bundled gateway import.
    // This stub observes startup inputs; it does not claim native runtime health.
    await writeFile(join(gateway, 'server.mjs'), `console.log(JSON.stringify({sourceCommit:process.env.YNX_CODE_SOURCE_COMMIT,sourceTree:process.env.YNX_CODE_SOURCE_TREE,release:process.env.YNX_CODE_RELEASE,host:process.env.HOST}));`);
    const support = join(root, 'support');
    const result = spawnSync(process.execPath, [join(root, 'code-server.mjs')], { encoding: 'utf8', timeout: 10000,
      env: { ...process.env, YNX_CODE_DESKTOP_SUPPORT_DIR: support, YNX_CODE_SOURCE_COMMIT: 'c'.repeat(40),
        YNX_CODE_SOURCE_TREE: 'd'.repeat(40), YNX_CODE_RELEASE: 'spoofed' } });
    await inspect(result, support);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('actual bundled launcher binds source and release, overriding inherited labels', async () => {
  await launch(valid, async (result, support) => {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { sourceCommit, sourceTree, release: `0.2.0-testnet-preview-${sourceCommit.slice(0,12)}`, host: '127.0.0.1' });
    assert.match((await readFile(join(support, 'workspace-session.key'), 'utf8')).trim(), /^[a-f0-9]{64}$/);
  });
});
for (const [name, record] of [
  ['missing metadata', undefined], ['historical checkpoint', { ...valid, runtimeCheckpoint: 'c'.repeat(40) }],
  ['inexact commit', { ...valid, sourceCommit: 'abc' }], ['inexact tree', { ...valid, sourceTree: null }],
  ['wrong product', { ...valid, productId: 'another-product' }], ['dirty source', { ...valid, sourceDirty: true }],
  ['wrong architecture', { ...valid, platform: 'linux-x64' }], ['wrong schema', { ...valid, schemaVersion: 2 }],
]) test(`${name} fails before creating user state`, async () => {
  await launch(record, async (result, support) => {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    await assert.rejects(access(support), { code: 'ENOENT' });
  });
});
