import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWorkspaceFileJournalApi, decodeOperations } = require('../../ynx-workbench/lib/workspace-file-journal-protocol');
async function fixture(t) {
  const root = await fs.mkdtemp('/private/tmp/ynx-journal-protocol-');
  const workspace = root + '/project', profile = root + '/profile', projectId = randomUUID();
  await fs.mkdir(workspace, { mode: 0o700 }); await fs.mkdir(profile, { mode: 0o700 });
  const pending = profile + '/.binding-' + randomUUID();
  await fs.writeFile(pending, JSON.stringify({ schemaVersion: 1, projectId, workspace, profile }), { mode: 0o600 });
  await fs.link(pending, profile + '/ynx-local-project.json');
  const api = createWorkspaceFileJournalApi({ YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: workspace,
    YNX_LOCAL_PROFILE: profile, YNX_LOCAL_PROJECT_ID: projectId, THEIA_CONFIG_DIR: profile });
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  return { root, workspace, profile, projectId, api };
}
test('JSON transport preserves binary and metadata through project-bound prepare/apply/undo/redo', async t => {
  const f = await fixture(t), raw = Buffer.from([255, 254, 0, 128, 65]);
  const request = JSON.parse(JSON.stringify([{ type: 'create', path: 'created', bytesBase64: raw.toString('base64'), mode: 0o640 }]));
  const tx = await f.api.prepare(request);
  const description = await f.api.describe(tx.id);
  assert.equal(description.projectId, f.projectId);
  assert.deepEqual(description.before, {});
  assert.deepEqual(description.after.created, { type: 'file', mode: 0o640, sha256: createHash('sha256').update(raw).digest('hex'), size: raw.length });
  assert.equal(JSON.stringify(description).includes('bytesBase64'), false);
  await f.api.apply(tx.id); assert.deepEqual(await fs.readFile(f.workspace + '/created'), raw);
  await f.api.undo(tx.id); await assert.rejects(fs.stat(f.workspace + '/created'), { code: 'ENOENT' });
  await f.api.redo(tx.id); assert.deepEqual(await fs.readFile(f.workspace + '/created'), raw);
  assert.equal((await f.api.inspect(tx.id)).status, 'applied');
});
test('transport rejects malformed contents and caller-supplied roots before any project mutation', async t => {
  const f = await fixture(t);
  for (const operation of [
    { type: 'write', path: 'file' }, { type: 'create', path: 'file', bytesBase64: 'YQ' },
    { type: 'create', path: 'file', bytesBase64: '!!!' }, { type: 'delete', path: 'file', bytesBase64: '' },
    { type: 'create', path: 'file', directory: 'yes' }, { type: 'create', path: 'file', mode: 0o4777 },
    { type: 'create', path: 'file', workspace: f.profile },
  ]) assert.throws(() => decodeOperations([operation]), { code: 'JOURNAL_PROTOCOL' });
  assert.deepEqual(await fs.readdir(f.workspace), []);
  await assert.rejects(f.api.prepare([{ type: 'create', path: f.profile + '/secret' }]));
  assert.deepEqual(await fs.readdir(f.workspace), []);
});
test('foreign journal IDs and changed project bindings cannot describe or restore another project', async t => {
  const first = await fixture(t), second = await fixture(t);
  const tx = await first.api.prepare([{ type: 'create', path: 'first' }]);
  await assert.rejects(second.api.describe(tx.id), { code: 'ENOENT' });
  await assert.rejects(second.api.apply(tx.id), { code: 'ENOENT' });
  await fs.writeFile(first.profile + '/ynx-local-project.json', JSON.stringify({ schemaVersion: 1, projectId: second.projectId, workspace: first.workspace, profile: first.profile }));
  await assert.rejects(first.api.describe(tx.id), { code: 'JOURNAL_UNBOUND' });
  assert.deepEqual(await fs.readdir(first.workspace), []);
  assert.deepEqual(await fs.readdir(second.workspace), []);
});
