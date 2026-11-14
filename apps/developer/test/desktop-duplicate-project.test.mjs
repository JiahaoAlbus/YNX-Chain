import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageDesktopEntry } from '../scripts/package-desktop-entry.mjs';

test('desktop launcher preserves only the typed project-lock refusal as exit 73', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'ynx-duplicate-launcher-')),root=join(temporary,'Resources');
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const adapter = join(root, 'code/apps/developer/desktop');
  await mkdir(adapter, { recursive: true });
  await packageDesktopEntry(join(root,'server.mjs'));
  await writeFile(join(root, 'build-provenance.json'), JSON.stringify({
    schemaVersion: 1, productId: 'ynx-developer-v1', version: '0.2.0', sourceDirty: false,
    platform: `macos-${process.arch}`, sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), runtimeCheckpoint: 'a'.repeat(40),
  }));
  // PUBLIC unit controls isolate only startup exit/cleanup mapping; these are
  // not a Native/Wallet authority or an actual App acceptance fixture.
  const controls={
    'local-go-selection.mjs':'export async function createLocalGoSelectionStore(){return {async load(){return null;}};} export function attachNativeGoSelectionChannel(){}',
    'wallet-admission-startup.mjs':'export async function openBundledWalletAdmission(){return {close(){},async finishCleanup(){return {complete:true};}};}',
    'native-tools-client.mjs':'export function createNativeToolsClient(){return null;}',
    'admitted-local-project.mjs':'export function createAdmittedLocalProjectMapping(){return null;}',
  };
  for(const [name,body] of Object.entries(controls))await writeFile(join(adapter,name),body);
  for (const [code, expected] of [['YNX_LOCAL_PROJECT_ALREADY_OPEN', 73], ['UNRELATED_FAILURE', 1]]) {
    await writeFile(join(adapter, 'local-workbench.mjs'), `export async function localProjectContext(){return {id:'PUBLIC_LOCK_TEST',workspace:${JSON.stringify(root)}};} export async function startLocalWorkbench(){throw Object.assign(Error('project lock refusal'),{code:${JSON.stringify(code)}});}`);
    const result = spawnSync(process.execPath, [join(root, 'server.mjs')], {
      env: { ...process.env, YNX_DEVELOPER_DESKTOP_MODE: 'local-workbench',YNX_CODE_DESKTOP_SUPPORT_DIR:join(root,'PUBLIC-profile'),YNX_LOCAL_WORKSPACE:'' }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, expected, result.stderr);
    assert.match(result.stderr, /project lock refusal/);
    assert.equal(result.stdout, '');
  }
});
