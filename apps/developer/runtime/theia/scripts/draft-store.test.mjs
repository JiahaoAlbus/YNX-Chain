import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import storeModule from '../../ynx-workbench/lib/draft-store.js';
const { DraftRecoveryStore, MAX_DRAFT } = storeModule;
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-draft-store-')));
  const workspace = join(root, 'workspace'), profile = join(root, 'profile'), other = join(root, 'other');
  for (const path of [workspace, profile, other]) await mkdir(path, { mode: 0o700 });
  const path = join(workspace, '用户合约.js'), uri = pathToFileURL(path).toString(), original = 'export const balance = 42;\n';
  await writeFile(path, original, { mode: 0o600 });
  const store = new DraftRecoveryStore({ workspace, profile });
  const baseHash = (await store.getBaseline(uri, original)).hash;
  return { root, workspace, profile, other, path, uri, original, baseHash, store, archive: join(profile, 'ynx-draft-recovery-v1') };
}
test('a real external local folder recovers only under its exact persistent profile binding', async () => {
  const f = await fixture(), profile = join(f.other, 'local-profile'); await mkdir(profile, { mode: 0o700 });
  const projectId = 'cccccccc-cccc-cccc-cccc-cccccccccccc', file = join(profile, 'ynx-local-project.json');
  await writeFile(file, JSON.stringify({schemaVersion:1,projectId,workspace:f.workspace,profile}), {mode:0o600});
  const store = new DraftRecoveryStore({workspace:f.workspace,profile,localProjectId:projectId});
  await store.upsert({uri:f.uri,baseHash:f.baseHash,text:'local unsaved draft'});
  const reopened = new DraftRecoveryStore({workspace:f.workspace,profile,localProjectId:projectId});
  assert.equal((await reopened.list()).entries[0].text,'local unsaved draft');
  assert.equal(await readFile(f.path,'utf8'),f.original);
  await writeFile(file,JSON.stringify({schemaVersion:1,projectId,workspace:f.other,profile}));
  await assert.rejects(store.upsert({uri:f.uri,baseHash:f.baseHash,text:'wrong binding'}),{code:'RECOVERY_SCOPE'});
  await assert.rejects(new DraftRecoveryStore({workspace:f.workspace,profile,localProjectId:projectId}).scope(),{code:'RECOVERY_UNBOUND'});
});
test('new store instance recovers latest fsynced draft without touching saved Unicode file', async () => {
  const f = await fixture();
  await f.store.upsert({ uri: f.uri, baseHash: f.baseHash, text: 'draft one' });
  await f.store.upsert({ uri: f.uri, baseHash: f.baseHash, text: 'draft two 用户' });
  const reopened = new DraftRecoveryStore({ workspace: f.workspace, profile: f.profile });
  assert.equal((await reopened.list()).entries[0].text, 'draft two 用户');
  assert.equal(await readFile(f.path, 'utf8'), f.original);
  assert.equal((await stat(join(f.archive, 'a.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.archive, 'b.json'))).mode & 0o777, 0o600);
});
test('foreign profile, escaping/symlink target and oversized text fail without collateral writes', async () => {
  const f = await fixture(), foreign = join(f.other, 'foreign.js'); await writeFile(foreign, 'foreign saved');
  await symlink(f.other, join(f.workspace, 'alias'));
  for (const uri of [pathToFileURL(foreign).toString(), pathToFileURL(join(f.workspace, 'alias/foreign.js')).toString(), pathToFileURL(join(f.profile, 'private.json')).toString()])
    await assert.rejects(f.store.upsert({ uri, baseHash: null, text: 'forged' }), { code: 'RECOVERY_SCOPE' });
  await assert.rejects(f.store.upsert({ uri: f.uri, baseHash: f.baseHash, text: 'x'.repeat(MAX_DRAFT + 1) }), { code: 'RECOVERY_LIMIT' });
  assert.equal(await readFile(foreign, 'utf8'), 'foreign saved');
  assert.deepEqual((await f.store.list()).entries, []);
  assert.equal((await new DraftRecoveryStore({ workspace: f.workspace, profile: f.workspace }).list()).status, 'unavailable');
});
test('own settings and untitled documents are scoped backups, other profile contents are rejected', async () => {
  const f = await fixture(), path = join(f.profile, 'settings.json'), text = '{"editor.fontSize":17}'; await writeFile(path, text);
  const uri = pathToFileURL(path).toString(), baseHash = (await f.store.getBaseline(uri, text)).hash;
  await f.store.upsert({ uri, baseHash, text: '{"editor.fontSize":18}' });
  await f.store.upsert({ uri: 'untitled:Untitled-1', baseHash: null, text: 'unsaved contract' });
  assert.equal((await f.store.list()).entries.length, 2);
  assert.equal(await readFile(path, 'utf8'), text);
});
test('own shortcut drafts survive reopening and a shortcut symlink cannot back up another project', async () => {
  const f = await fixture(), path = join(f.profile, 'keybindings.json'), text = '[]';
  await writeFile(path, text);
  const uri = pathToFileURL(path).toString(), baseHash = (await f.store.getBaseline(uri, text)).hash;
  await f.store.upsert({ uri, baseHash, text: '[{"key":"f6","command":"workbench.action.debug.selectandstart"}]' });
  const reopened = new DraftRecoveryStore({ workspace: f.workspace, profile: f.profile });
  assert.equal((await reopened.list()).entries[0].uri, uri);
  assert.equal(await readFile(path, 'utf8'), text);
  const foreign = join(f.other, 'foreign.json'); await writeFile(foreign, 'foreign shortcut data');
  const linked = await fixture(); await symlink(foreign, join(linked.profile, 'keybindings.json'));
  await assert.rejects(linked.store.upsert({ uri: pathToFileURL(join(linked.profile, 'keybindings.json')).toString(), baseHash: null, text: 'forged' }), { code: 'RECOVERY_SCOPE' });
  assert.equal(await readFile(foreign, 'utf8'), 'foreign shortcut data');
});
test('corrupt latest slot restores older data read-only and preserves damaged bytes', async () => {
  const f = await fixture(); await f.store.upsert({ uri: f.uri, baseHash: f.baseHash, text: 'older checkpoint' }); await f.store.upsert({ uri: f.uri, baseHash: f.baseHash, text: 'latest checkpoint' });
  const path = join(f.archive, 'b.json'), damaged = '{partial'; await writeFile(path, damaged);
  const reopened = new DraftRecoveryStore({ workspace: f.workspace, profile: f.profile });
  const recovered = await reopened.list(); assert.equal(recovered.status, 'read-only'); assert.equal(recovered.entries[0].text, 'older checkpoint');
  await assert.rejects(reopened.upsert({ uri: f.uri, baseHash: f.baseHash, text: 'replacement' }), { code: 'RECOVERY_DAMAGED' });
  assert.equal(await readFile(path, 'utf8'), damaged);
});
test('completed interrupted atomic snapshot is recoverable but retained for review', async () => {
  const f = await fixture(); await f.store.upsert({ uri: f.uri, baseHash: f.baseHash, text: 'committed' });
  const data = { schema: 1, workspaceHash: hash(f.workspace), generation: 2, entries: [{ uri: f.uri, baseHash: f.baseHash, text: 'complete pending checkpoint' }] };
  const bytes = JSON.stringify({ data, sha256: hash(JSON.stringify(data)) }), path = join(f.archive, '.pending-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); await writeFile(path, bytes);
  const result = await f.store.list(); assert.equal(result.status, 'read-only'); assert.equal(result.entries[0].text, 'complete pending checkpoint');
  await assert.rejects(f.store.remove(f.uri), { code: 'RECOVERY_DAMAGED' }); assert.equal(await readFile(path, 'utf8'), bytes);
});
test('serialized concurrent drafts survive reopening; explicit clean removal stays removed', async () => {
  const f = await fixture();
  await Promise.all(Array.from({ length: 8 }, (_, index) => f.store.upsert({ uri: `untitled:Draft-${index}`, baseHash: null, text: String(index) })));
  assert.equal((await f.store.list()).entries.length, 8);
  await f.store.remove('untitled:Draft-3');
  const reopened = new DraftRecoveryStore({ workspace: f.workspace, profile: f.profile });
  assert.equal((await reopened.list()).entries.length, 7); assert.ok(!(await reopened.list()).entries.some(entry => entry.uri === 'untitled:Draft-3'));
});
