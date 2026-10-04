import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const { WorkspaceFileJournal } = require('../../ynx-workbench/lib/workspace-file-journal.js');
const bytes = text => Buffer.from(text);
async function fixture(t, checkpoint) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'ynx-file-journal-'))), workspace = join(root, 'workspace'), profile = join(root, 'profile');
  await fs.mkdir(workspace, { mode: 0o700 }); await fs.mkdir(profile, { mode: 0o700 });
  const projectId = '12345678-1234-1234-1234-123456789abc';
  await fs.writeFile(join(profile, 'ynx-local-project.json'), JSON.stringify({ schemaVersion: 1, workspace, profile, projectId }), { mode: 0o600 });
  const env = { YNX_WORKSPACE_MODE: 'local', YNX_LOCAL_WORKSPACE: workspace, YNX_LOCAL_PROFILE: profile, THEIA_CONFIG_DIR: profile, YNX_LOCAL_PROJECT_ID: projectId };
  t.after(async () => { async function writable(path) { const stat = await fs.lstat(path); if (stat.isDirectory()) { await fs.chmod(path, 0o700); for (const name of await fs.readdir(path)) await writable(join(path, name)); } } await writable(root); await fs.rm(root, { recursive: true, force: true }); });
  return { root, workspace, profile, env, journal: new WorkspaceFileJournal(env, { checkpoint }), path: path => join(workspace, path) };
}
const tree = async root => { const result = {}; async function walk(dir, prefix = '') { for (const name of (await fs.readdir(dir)).sort()) { const key = prefix ? prefix + '/' + name : name, path = join(dir, name), stat = await fs.lstat(path); result[key] = { mode: stat.mode & 0o777, type: stat.isDirectory() ? 'directory' : 'file' }; if (stat.isDirectory()) await walk(path, key); else result[key].bytes = (await fs.readFile(path)).toString('base64'); } } await walk(root); return result; };

test('ordered mixed batch preserves binary, BOM, UTF16, modes, overwritten targets and directory chains through undo/redo', async t => {
  const f = await fixture(t); await fs.mkdir(f.path('folder'), { mode: 0o750 });
  const binary = Buffer.from([0, 255, 254, 128, 1]), utf16 = Buffer.concat([Buffer.from([255, 254]), Buffer.from('你好\r\n', 'utf16le')]);
  await fs.writeFile(f.path('folder/binary'), binary, { mode: 0o640 }); await fs.writeFile(f.path('target'), bytes('overwritten-target'), { mode: 0o600 });
  const before = await tree(f.workspace);
  const { id } = await f.journal.prepare([{ type: 'create', path: 'folder/utf16', bytes: utf16, mode: 0o640 }, { type: 'move', from: 'folder', to: 'renamed' }, { type: 'move', from: 'renamed/binary', to: 'target', overwrite: true }, { type: 'write', path: 'target', bytes: Buffer.from([239, 187, 191, 65]) }, { type: 'delete', path: 'renamed', recursive: true }]);
  assert.equal((await f.journal.apply(id)).status, 'applied'); const after = await tree(f.workspace);
  assert.deepEqual(await fs.readFile(f.path('target')), Buffer.from([239, 187, 191, 65]));
  assert.equal((await f.journal.undo(id)).status, 'undone'); assert.deepEqual(await tree(f.workspace), before);
  await f.journal.redo(id); assert.deepEqual(await tree(f.workspace), after);
  await f.journal.undo(id); assert.deepEqual(await tree(f.workspace), before);
});

test('ignore flags and missing/type constraints have explicit ordered semantics', async t => {
  const f = await fixture(t); await fs.writeFile(f.path('existing'), bytes('keep'));
  const { id } = await f.journal.prepare([{ type: 'create', path: 'existing', bytes: bytes('discard'), ignoreIfExists: true }, { type: 'delete', path: 'missing', ignoreIfNotExists: true }]);
  await f.journal.apply(id); assert.equal(await fs.readFile(f.path('existing'), 'utf8'), 'keep');
  for (const op of [{ type: 'delete', path: 'missing' }, { type: 'write', path: 'missing', bytes: bytes('x') }, { type: 'create', path: 'existing' }, { type: 'move', from: 'missing', to: 'new' }]) await assert.rejects(f.journal.prepare([op]));
});

for (const phase of ['before', 'after']) for (const step of [0, 1, 2]) test(`failure ${phase} step ${step} compensates reverse order without discarding data`, async t => {
  let armed = false; const f = await fixture(t, event => { if (armed && event.phase === phase && event.from === step) throw Error('injected step failure'); });
  await fs.writeFile(f.path('original'), bytes('raw'), { mode: 0o640 }); const before = await tree(f.workspace);
  const { id } = await f.journal.prepare([{ type: 'write', path: 'original', bytes: bytes('changed') }, { type: 'move', from: 'original', to: 'moved' }, { type: 'create', path: 'added', bytes: bytes('added') }]);
  armed = true; await assert.rejects(f.journal.apply(id), /injected/); assert.deepEqual(await tree(f.workspace), before); assert.equal((await f.journal.inspect(id)).status, 'compensated');
});

for (const phase of ['before', 'after']) test(`pending crash ${phase} mutation recovers exact before bytes without automatic replay`, async t => {
  let armed = false; const f = await fixture(t, event => { if (armed && event.phase === phase) throw Object.assign(Error('crash'), { code: 'JOURNAL_SIMULATED_CRASH' }); });
  await fs.writeFile(f.path('file'), bytes('original')); const before = await tree(f.workspace);
  const { id } = await f.journal.prepare([{ type: 'write', path: 'file', bytes: bytes('after') }]); armed = true;
  await assert.rejects(f.journal.apply(id), { code: 'JOURNAL_SIMULATED_CRASH' });
  const reopened = new WorkspaceFileJournal(f.env); assert.ok((await reopened.inspect(id)).pending); await assert.rejects(reopened.prepare([{ type: 'create', path: 'new' }]), { code: 'JOURNAL_PENDING' });
  await reopened.recover(id); assert.deepEqual(await tree(f.workspace), before); await reopened.redo(id); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'after');
});

test('external bytes, modes, and third-party paths block undo and preserve journal plus user data', async t => {
  for (const change of ['bytes', 'mode']) await t.test(change, async t => {
    const f = await fixture(t); await fs.writeFile(f.path('file'), bytes('original')); const { id } = await f.journal.prepare([{ type: 'write', path: 'file', bytes: bytes('after') }]); await f.journal.apply(id);
    if (change === 'bytes') await fs.writeFile(f.path('file'), bytes('third-party'));
    if (change === 'mode') await fs.chmod(f.path('file'), 0o600);
    if (change === 'path') await fs.writeFile(f.path('third-party'), bytes('private'));
    const changed = await tree(f.workspace); await assert.rejects(f.journal.undo(id), { code: 'JOURNAL_CHANGED' }); assert.deepEqual(await tree(f.workspace), changed); assert.equal((await f.journal.inspect(id)).status, 'applied');
  });
});

test('pending recovery refuses outside changes and corrupt private journal is retained', async t => {
  let armed = false; const f = await fixture(t, event => { if (armed && event.phase === 'after') throw Object.assign(Error('crash'), { code: 'JOURNAL_SIMULATED_CRASH' }); });
  await fs.writeFile(f.path('file'), bytes('original')); const { id } = await f.journal.prepare([{ type: 'write', path: 'file', bytes: bytes('after') }]); armed = true; await assert.rejects(f.journal.apply(id));
  await fs.writeFile(f.path('file'), bytes('outside')); const reopened = new WorkspaceFileJournal(f.env); await assert.rejects(reopened.recover(id), { code: 'JOURNAL_CHANGED' }); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'outside');
  const path = join(f.profile, 'ynx-workspace-file-journal-v1', id + '.json'); await fs.writeFile(path, '{corrupt', { mode: 0o600 }); await assert.rejects(reopened.inspect(id), { code: 'JOURNAL_CORRUPT' }); assert.equal(await fs.readFile(path, 'utf8'), '{corrupt');
});

test('symlinks, hardlinks, cross-provider/outside paths, binding changes and readonly writes are rejected', async t => {
  const f = await fixture(t); await fs.writeFile(f.path('file'), bytes('raw'), { mode: 0o444 });
  const { id } = await f.journal.prepare([{ type: 'write', path: 'file', bytes: bytes('new') }]); await assert.rejects(f.journal.apply(id), { code: 'JOURNAL_READONLY' }); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'raw');
  for (const path of ['../outside', 'https://host/file', f.profile + '/secret']) await assert.rejects(f.journal.prepare([{ type: 'create', path }]));
  await fs.symlink(f.profile, f.path('link')); await assert.rejects(f.journal.prepare([{ type: 'create', path: 'link/secret' }]), { code: 'JOURNAL_SCOPE' }); await fs.unlink(f.path('link'));
  await fs.link(f.path('file'), f.path('hard')); await assert.rejects(f.journal.prepare([{ type: 'write', path: 'hard', bytes: bytes('new') }]), { code: 'JOURNAL_SCOPE' }); await fs.unlink(f.path('hard'));
  await fs.writeFile(join(f.profile, 'ynx-local-project.json'), JSON.stringify({ schemaVersion: 1, projectId: f.env.YNX_LOCAL_PROJECT_ID, workspace: f.workspace, profile: '/other' })); await assert.rejects(f.journal.inspect(id), { code: 'JOURNAL_UNBOUND' });
});

for (const phase of ['journal-sync', 'journal-rename']) test(`journal ${phase} failure happens before workspace mutation and keeps retryable evidence`, async t => {
  let armed = false; const f = await fixture(t, e => { if (armed && e.phase === phase) throw Error('journal persistence failed'); });
  await fs.writeFile(f.path('file'), bytes('raw')); const { id } = await f.journal.prepare([{ type: 'write', path: 'file', bytes: bytes('changed') }]); armed = true;
  await assert.rejects(f.journal.apply(id), /journal persistence failed/); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'raw'); assert.ok(await f.journal.inspect(id));
});

test('large unrelated dependency trees and sibling symlinks are outside footprint; unrelated saves do not block undo', async t => {
  const f = await fixture(t); await fs.mkdir(f.path('node_modules')); const handle = await fs.open(f.path('node_modules/large'), 'w'); await handle.truncate(80 * 1024 * 1024); await handle.close();
  await fs.symlink(f.profile, f.path('unrelated-link')); await fs.writeFile(f.path('source'), bytes('old'));
  const { id } = await f.journal.prepare([{ type: 'write', path: 'source', bytes: bytes('new') }]); await f.journal.apply(id);
  await fs.writeFile(f.path('unrelated-save'), bytes('third-party bytes')); await f.journal.undo(id);
  assert.equal(await fs.readFile(f.path('source'), 'utf8'), 'old'); assert.equal(await fs.readFile(f.path('unrelated-save'), 'utf8'), 'third-party bytes');
  assert.equal((await fs.stat(f.path('node_modules/large'))).size, 80 * 1024 * 1024); assert.equal(await fs.readlink(f.path('unrelated-link')), f.profile);
});

test('blob journal deduplicates raw bytes across many snapshots and moved paths', async t => {
  const f = await fixture(t); const raw = Buffer.alloc(1024 * 1024, 128); await fs.writeFile(f.path('one'), raw);
  const operations = Array.from({ length: 20 }, (_, i) => ({ type: 'move', from: i % 2 ? 'two' : 'one', to: i % 2 ? 'one' : 'two' }));
  const { id } = await f.journal.prepare(operations); const path = join(f.profile, 'ynx-workspace-file-journal-v1', id + '.json');
  const envelope = JSON.parse(await fs.readFile(path, 'utf8')); assert.equal(Object.keys(envelope.data.blobs).length, 1); assert.ok((await fs.stat(path)).size < 2 * 1024 * 1024);
  await f.journal.apply(id); assert.deepEqual(await fs.readFile(f.path('one')), raw); await f.journal.undo(id); assert.deepEqual(await fs.readFile(f.path('one')), raw);
});

test('directory subtree added by third party blocks restore without overwriting it', async t => {
  const f = await fixture(t); await fs.mkdir(f.path('source')); await fs.writeFile(f.path('source/file'), bytes('original'));
  const { id } = await f.journal.prepare([{ type: 'move', from: 'source', to: 'target' }]); await f.journal.apply(id); await fs.writeFile(f.path('target/third-party'), bytes('unrelated private bytes'));
  await assert.rejects(f.journal.undo(id), { code: 'JOURNAL_CHANGED' }); assert.equal(await fs.readFile(f.path('target/third-party'), 'utf8'), 'unrelated private bytes'); assert.equal((await f.journal.inspect(id)).status, 'applied');
});

for (const phase of ['journal-sync', 'journal-rename']) test(`interrupted ${phase} pending archive is validated during explicit recovery`, async t => {
  let armed = false; const f = await fixture(t, e => { if (armed && e.phase === phase) throw Object.assign(Error('crash'), { code: 'JOURNAL_SIMULATED_CRASH' }); });
  await fs.writeFile(f.path('file'), bytes('before')); const { id } = await f.journal.prepare([{ type: 'write', path: 'file', bytes: bytes('after') }]); armed = true; await assert.rejects(f.journal.apply(id));
  assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'before'); const reopened = new WorkspaceFileJournal(f.env); await reopened.recover(id); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'before'); await reopened.redo(id); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'after');
});

test('a replaced workspace inode cannot reuse an old project journal across a reopened factory', async t => {
  const f = await fixture(t); await fs.writeFile(f.path('file'), bytes('before')); const { id } = await f.journal.prepare([{ type: 'write', path: 'file', bytes: bytes('after') }]);
  await fs.rename(f.workspace, f.workspace + '-original'); await fs.mkdir(f.workspace, { mode: 0o700 }); await fs.writeFile(f.path('file'), bytes('before'));
  await assert.rejects(new WorkspaceFileJournal(f.env).apply(id), { code: 'JOURNAL_CORRUPT' }); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'before');
});

test('real SIGKILL after persisted file replacement leaves recoverable pending intent', async t => {
  const f = await fixture(t); await fs.writeFile(f.path('file'), bytes('before')); const { id } = await f.journal.prepare([{ type: 'write', path: 'file', bytes: bytes('after') }]);
  const module = require.resolve('../../ynx-workbench/lib/workspace-file-journal.js');
  const script = `const {WorkspaceFileJournal}=require(${JSON.stringify(module)}); const j=new WorkspaceFileJournal(${JSON.stringify(f.env)},{checkpoint:e=>{if(e.phase==='after')process.kill(process.pid,'SIGKILL')}});j.apply(${JSON.stringify(id)}).catch(e=>{console.error(e);process.exitCode=1});`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] }); let errors = ''; child.stderr.on('data', data => { errors += data; });
  const [code, signal] = await once(child, 'close'); assert.equal(code, null, errors); assert.equal(signal, 'SIGKILL');
  assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'after');
  const reopened = new WorkspaceFileJournal(f.env); assert.ok((await reopened.inspect(id)).pending); await reopened.recover(id); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'before');
});

test('native rename control and journal move/overwrite preserve readonly directory trees without chmod', async t => {
  const f = await fixture(t); await fs.mkdir(f.path('folder')); await fs.writeFile(f.path('folder/file'), Buffer.from([255, 254, 0, 128]), { mode: 0o444 }); await fs.chmod(f.path('folder'), 0o555);
  await fs.rename(f.path('folder'), f.path('native-control')); await fs.rename(f.path('native-control'), f.path('folder'));
  assert.equal((await fs.stat(f.path('folder'))).mode & 0o777, 0o555); const sourceInode = (await fs.stat(f.path('folder'))).ino;
  await fs.mkdir(f.path('target')); await fs.writeFile(f.path('target/overwritten'), bytes('retained target'), { mode: 0o444 }); await fs.chmod(f.path('target'), 0o555);
  const before = await tree(f.workspace), targetInode = (await fs.stat(f.path('target'))).ino;
  const { id } = await f.journal.prepare([{ type: 'move', from: 'folder', to: 'target', overwrite: true }]);
  await f.journal.apply(id); assert.equal((await fs.stat(f.path('target'))).ino, sourceInode); assert.equal((await fs.stat(f.path('target'))).mode & 0o777, 0o555);
  await f.journal.undo(id); assert.deepEqual(await tree(f.workspace), before); assert.equal((await fs.stat(f.path('folder'))).ino, sourceInode); assert.equal((await fs.stat(f.path('target'))).ino, targetInode);
  await f.journal.redo(id); assert.equal((await fs.stat(f.path('target'))).ino, sourceInode); await f.journal.undo(id); assert.deepEqual(await tree(f.workspace), before);
});

test('readonly directory deletion and restoration move the intact tree through private stash', async t => {
  const f = await fixture(t); await fs.mkdir(f.path('folder')); await fs.writeFile(f.path('folder/file'), bytes('raw'), { mode: 0o444 }); await fs.chmod(f.path('folder'), 0o555);
  const before = await tree(f.workspace), inode = (await fs.stat(f.path('folder'))).ino;
  const { id } = await f.journal.prepare([{ type: 'delete', path: 'folder', recursive: true }]); await f.journal.apply(id); await assert.rejects(fs.stat(f.path('folder')), { code: 'ENOENT' });
  await f.journal.undo(id); assert.deepEqual(await tree(f.workspace), before); assert.equal((await fs.stat(f.path('folder'))).ino, inode);
  await f.journal.redo(id); await f.journal.undo(id); assert.deepEqual(await tree(f.workspace), before);
});

for (const label of ['backup-target', 'move-source']) for (const phase of ['native-before', 'native-after']) test(`readonly native move failure ${phase} ${label} compensates exact overwrite trees`, async t => {
  let armed = false; const f = await fixture(t, event => { if (armed && event.phase === phase && event.label === label) throw Error('native injected'); });
  for (const path of ['source', 'target']) { await fs.mkdir(f.path(path)); await fs.writeFile(f.path(path + '/file'), bytes(path), { mode: 0o444 }); await fs.chmod(f.path(path), 0o555); }
  const before = await tree(f.workspace), { id } = await f.journal.prepare([{ type: 'move', from: 'source', to: 'target', overwrite: true }]); armed = true;
  await assert.rejects(f.journal.apply(id), /native injected/); assert.deepEqual(await tree(f.workspace), before);
});

for (const label of ['backup-target', 'move-source']) test(`SIGKILL after native ${label} can recover readonly source and overwritten target`, async t => {
  const f = await fixture(t); for (const path of ['source', 'target']) { await fs.mkdir(f.path(path)); await fs.writeFile(f.path(path + '/file'), bytes(path), { mode: 0o444 }); await fs.chmod(f.path(path), 0o555); }
  const before = await tree(f.workspace), { id } = await f.journal.prepare([{ type: 'move', from: 'source', to: 'target', overwrite: true }]), module = require.resolve('../../ynx-workbench/lib/workspace-file-journal.js');
  const script = `const {WorkspaceFileJournal}=require(${JSON.stringify(module)});const j=new WorkspaceFileJournal(${JSON.stringify(f.env)},{checkpoint:e=>{if(e.phase==='native-after'&&e.label===${JSON.stringify(label)})process.kill(process.pid,'SIGKILL')}});j.apply(${JSON.stringify(id)}).catch(e=>{console.error(e);process.exitCode=1});`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] }); let errors = ''; child.stderr.on('data', chunk => { errors += chunk; }); const [code, signal] = await once(child, 'close'); assert.equal(code, null, errors); assert.equal(signal, 'SIGKILL');
  const reopened = new WorkspaceFileJournal(f.env); assert.ok((await reopened.inspect(id)).pending.primitive); await reopened.recover(id); assert.deepEqual(await tree(f.workspace), before); await reopened.redo(id); await reopened.undo(id); assert.deepEqual(await tree(f.workspace), before);
});

test('same-parent readonly stashes follow recorded ancestor rename/delete chains and reverse exactly', async t => {
  const f = await fixture(t); await fs.mkdir(f.path('parent')); await fs.mkdir(f.path('parent/readonly')); await fs.writeFile(f.path('parent/readonly/file'), bytes('raw'), { mode: 0o444 }); await fs.chmod(f.path('parent/readonly'), 0o555);
  const before = await tree(f.workspace), { id } = await f.journal.prepare([{ type: 'delete', path: 'parent/readonly', recursive: true }, { type: 'move', from: 'parent', to: 'renamed' }, { type: 'delete', path: 'renamed', recursive: true }]);
  await f.journal.apply(id); await f.journal.undo(id); assert.deepEqual(await tree(f.workspace), before); await f.journal.redo(id); await f.journal.undo(id); assert.deepEqual(await tree(f.workspace), before);
});

test('crash after ancestor move retains explicit moved stash locations for recovery', async t => {
  const f = await fixture(t); await fs.mkdir(f.path('parent')); await fs.mkdir(f.path('parent/readonly')); await fs.writeFile(f.path('parent/readonly/file'), bytes('raw'), { mode: 0o444 }); await fs.chmod(f.path('parent/readonly'), 0o555);
  const before = await tree(f.workspace), { id } = await f.journal.prepare([{ type: 'delete', path: 'parent/readonly', recursive: true }, { type: 'move', from: 'parent', to: 'renamed' }]), module = require.resolve('../../ynx-workbench/lib/workspace-file-journal.js');
  const script = `const {WorkspaceFileJournal}=require(${JSON.stringify(module)});const j=new WorkspaceFileJournal(${JSON.stringify(f.env)},{checkpoint:e=>{if(e.phase==='native-after'&&e.from===1)process.kill(process.pid,'SIGKILL')}});j.apply(${JSON.stringify(id)}).catch(e=>{console.error(e);process.exitCode=1});`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] }); let errors = ''; child.stderr.on('data', chunk => { errors += chunk; }); const [code, signal] = await once(child, 'close'); assert.equal(code, null, errors); assert.equal(signal, 'SIGKILL');
  const reopened = new WorkspaceFileJournal(f.env); await reopened.recover(id); assert.deepEqual(await tree(f.workspace), before);
});

test('external modification of a readonly overwrite stash blocks Undo and preserves the changed stash', async t => {
  const f = await fixture(t); for (const path of ['source', 'target']) { await fs.mkdir(f.path(path)); await fs.writeFile(f.path(path + '/file'), bytes(path), { mode: 0o444 }); await fs.chmod(f.path(path), 0o555); }
  const { id } = await f.journal.prepare([{ type: 'move', from: 'source', to: 'target', overwrite: true }]); await f.journal.apply(id);
  const archive = JSON.parse(await fs.readFile(join(f.profile, 'ynx-workspace-file-journal-v1', id + '.json'), 'utf8')), stash = archive.data.slots[0].paths[0];
  await fs.chmod(join(stash, 'file'), 0o644); await fs.writeFile(join(stash, 'file'), bytes('third-party stash bytes')); await assert.rejects(f.journal.undo(id), { code: 'JOURNAL_CHANGED' });
  assert.equal(await fs.readFile(join(stash, 'file'), 'utf8'), 'third-party stash bytes'); assert.equal(await fs.readFile(f.path('target/file'), 'utf8'), 'source');
});

test('actual driver-style retained pending binding link authorizes journal prepare/apply/undo', async t => {
  const f = await fixture(t), binding = join(f.profile, 'ynx-local-project.json'), pending = join(f.profile, '.binding-12345678-1234-1234-1234-123456789abc');
  const raw = await fs.readFile(binding); await fs.unlink(binding); await fs.writeFile(pending, Buffer.concat([raw, Buffer.from('\n')]), { flag: 'wx', mode: 0o600 }); await fs.link(pending, binding);
  assert.equal((await fs.stat(binding)).nlink, 2); assert.equal((await fs.stat(pending)).ino, (await fs.stat(binding)).ino);
  await fs.writeFile(f.path('file'), bytes('old')); const { id } = await f.journal.prepare([{ type: 'write', path: 'file', bytes: bytes('new') }]); await f.journal.apply(id); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'new'); await f.journal.undo(id); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'old');
  await fs.writeFile(pending, JSON.stringify({ schemaVersion: 1, projectId: f.env.YNX_LOCAL_PROJECT_ID, workspace: '/other', profile: f.profile })); await assert.rejects(f.journal.redo(id), { code: 'JOURNAL_UNBOUND' }); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'old');
});

test('unknown external binding hardlinks and extra links remain rejected', async t => {
  for (const kind of ['outside-only', 'driver-plus-outside']) await t.test(kind, async t => {
    const f = await fixture(t), binding = join(f.profile, 'ynx-local-project.json');
    if (kind === 'driver-plus-outside') await fs.link(binding, join(f.profile, '.binding-12345678-1234-1234-1234-123456789abc'));
    await fs.link(binding, join(f.root, 'outside-binding-peer')); await assert.rejects(f.journal.prepare([{ type: 'create', path: 'new' }]), { code: 'JOURNAL_SCOPE' });
    await assert.rejects(fs.stat(f.path('new')), { code: 'ENOENT' });
  });
});

test('driver binding exception does not allow linked journal archives or affected project files', async t => {
  const f = await fixture(t), binding = join(f.profile, 'ynx-local-project.json'); await fs.link(binding, join(f.profile, '.binding-12345678-1234-1234-1234-123456789abc'));
  await fs.writeFile(f.path('file'), bytes('raw')); const { id } = await f.journal.prepare([{ type: 'write', path: 'file', bytes: bytes('new') }]);
  const archive = join(f.profile, 'ynx-workspace-file-journal-v1', id + '.json'); await fs.link(archive, join(f.profile, 'linked-archive')); await assert.rejects(f.journal.apply(id), { code: 'JOURNAL_SCOPE' }); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'raw');
  await fs.unlink(join(f.profile, 'linked-archive')); await fs.link(f.path('file'), f.path('linked-user-file')); await assert.rejects(f.journal.apply(id), { code: 'JOURNAL_SCOPE' }); assert.equal(await fs.readFile(f.path('file'), 'utf8'), 'raw');
});

// Actual retained MonacoEditorModel -> Resource.save -> FileResource.doWrite.
// Only DOM/injection tokens are supplied; document/save/encoding implementations
// are unmodified. The file-service test bridge writes actual temporary raw bytes.
async function nativeSaveFixture(t, encoding = 'utf16le') {
  const { readFileSync } = await import('node:fs'), { runInNewContext } = await import('node:vm');
  const { randomUUID } = await import('node:crypto'); require('reflect-metadata');
  const { EncodingService } = require('../node_modules/@theia/core/lib/common/encoding-service.js'), encoder = new EncodingService();
  const [modelModule, textModule, uriModule, eventModule, defaultsModule, undoModule] = await Promise.all([
    import('../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/services/modelService.js'), import('../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/model/textModel.js'), import('../node_modules/@theia/monaco-editor-core/esm/vs/base/common/uri.js'), import('../node_modules/@theia/monaco-editor-core/esm/vs/base/common/event.js'), import('../node_modules/@theia/monaco-editor-core/esm/vs/editor/common/core/misc/textModelDefaults.js'), import('../node_modules/@theia/monaco-editor-core/esm/vs/platform/undoRedo/common/undoRedoService.js')]);
  const { ModelService } = modelModule, { TextModel } = textModule, { URI } = uriModule, { Event } = eventModule, { EDITOR_MODEL_DEFAULTS } = defaultsModule;
  const undoRedo = new undoModule.UndoRedoService({ prompt() { throw Error('No prompt'); } }, { warn() {}, error() {} });
  const tokenization = () => ({ dispose() {}, onDidChangeLanguage: Event.None, onDidChangeFontTokens: Event.None, _hasListeners: () => false, handleDidChangeContent() {}, handleDidChangeLanguage() {}, handleLanguageConfigurationServiceChange() {}, getLanguageId: () => 'plaintext' });
  const models = new ModelService({ onDidChangeConfiguration: Event.None, getValue: key => key === 'files.restoreUndoStack' ? true : key === 'editor' ? { ...EDITOR_MODEL_DEFAULTS, trimAutoWhitespace: false, detectIndentation: false } : undefined }, { getEOL: () => '\n' }, undoRedo, { createInstance: (ctor, ...args) => new ctor(...args, undoRedo, { requestRichLanguageFeatures() {} }, { onDidChange: Event.None }, { createInstance: () => tokenization() }) });
  const filename = require.resolve('../node_modules/@theia/monaco/lib/browser/monaco-editor-model.js'), hostRequire = createRequire(filename), exports = {}, modelToken = {}, languageToken = {}, listener = require('../node_modules/@theia/core/lib/common/listener.js');
  const load = name => {
    if (name === '@theia/monaco-editor-core') return { Uri: URI };
    if (name.includes('/standaloneServices')) return { StandaloneServices: { get: token => token === modelToken ? models : { createByFilepathOrFirstLine: () => 'plaintext' } } };
    if (name.endsWith('/languages/language')) return { ILanguageService: languageToken };
    if (name.endsWith('/services/model')) return { IModelService: modelToken };
    if (name.endsWith('/model/textModel')) return { TextModel };
    if (name === '@theia/core') return listener;
    if (name.endsWith('/browser/saveable')) return { SaveReason: { Manual: 1 } };
    return hostRequire(name);
  };
  runInNewContext(readFileSync(filename, 'utf8'), { require: load, exports, console, setTimeout, clearTimeout }, { filename });
  const fileName = require.resolve('../node_modules/@theia/filesystem/lib/browser/file-resource.js'), fileRequire = createRequire(fileName), fileExports = {};
  runInNewContext(readFileSync(fileName, 'utf8'), { require: name => {
    if (name === './file-service') return { FileService: class {}, TextFileOperationError: class extends Error {} };
    if (name === '@theia/core') return { nls: { localize: (_, text) => text } };
    if (name.endsWith('/browser/dialogs')) return { ConfirmDialog: class {} };
    if (name.endsWith('/browser/label-provider')) return { LabelProvider: class {} };
    if (name.endsWith('/filesystem-preferences')) return { FileSystemPreferences: {} };
    if (name.endsWith('/frontend-application-state')) return { FrontendApplicationStateService: class {} };
    return fileRequire(name);
  }, exports: fileExports, console }, { filename: fileName });
  const f = await fixture(t), raw = Buffer.from(encoder.encode('old\r\n', { encoding, hasBOM: true }).buffer); await fs.writeFile(f.path('old.txt'), raw, { mode: 0o640 });
  const { id } = await f.journal.prepare([{ type: 'move', from: 'old.txt', to: 'new.txt' }]); await f.journal.apply(id);
  const coreURI = require('../node_modules/@theia/core/lib/common/uri.js').default, uri = new coreURI('file://' + f.path('new.txt'));
  const version = async () => { const s = await fs.stat(f.path('new.txt')); return { etag: s.mtimeMs.toString(29) + s.size.toString(31), mtime: s.mtimeMs, encoding }; };
  let writes = 0, tokenResult, captureSpec, afterWriteHook; const phases = [];
  const fileService = { hasCapability: () => false, watch: () => ({ dispose() {} }), onDidFilesChange: () => ({ dispose() {} }), onDidRunOperation: () => ({ dispose() {} }), onDidChangeFileSystemProviderCapabilities: () => ({ dispose() {} }), onDidChangeFileSystemProviderReadOnlyMessage: () => ({ dispose() {} }),
    read: async () => ({ ...await version(), value: encoder.decode({ buffer: await fs.readFile(f.path('new.txt')) }, encoding) }),
    write: async (_, text, options) => { phases.push('native-write'); const before = await version(); assert.equal(options.etag, before.etag); assert.equal(options.mtime, before.mtime); const previous = await fs.readFile(f.path('new.txt')), resolved = await encoder.toResourceEncoding(options.encoding, { overwriteEncoding: options.overwriteEncoding, read: async count => new Uint8Array(previous.subarray(0, count)) }); await fs.writeFile(f.path('new.txt'), Buffer.from(encoder.encode(text, resolved).buffer)); writes++; await afterWriteHook?.(); return version(); },
  };
  const resource = new fileExports.FileResource(uri, fileService, { readOnly: false }); resource.readStream = undefined; const document = await new exports.MonacoEditorModel(resource, { asRange: range => range }, { asRange: range => range }).load();
  const originalSave = resource.saveContents.bind(resource), fenceId = randomUUID(); let taskId = randomUUID(), beforeWillSave;
  const modelCapture = () => ({ uri: document.uri, text: document.getText(), versionId: document.textEditorModel.getVersionId(), alternativeVersionId: document.textEditorModel.getAlternativeVersionId(), savedVersionId: document.bufferSavedVersionId, dirty: document.dirty, encoding: document.getEncoding(), bom: true, eol: document.textEditorModel.getEOL() });
  document.onModelWillSaveModel(() => { beforeWillSave = modelCapture(); });
  const saveAuthority = { validateCapture: async capture => JSON.stringify(capture.model) === JSON.stringify(modelCapture()) && ['etag', 'mtime', 'encoding'].every(key => capture.resourceVersion[key] === document.resourceVersion[key]) && capture.fenceId === fenceId && capture.taskId === taskId, writeText: async (_, text, options) => { await originalSave(text, options); return resource.version; } };
  const journal = new WorkspaceFileJournal(f.env, { encodingService: encoder, saveAuthority });
  resource.saveContents = async (text, options) => { taskId = randomUUID(); phases.push('captured-after-willSave'); assert.equal(text, document.getText()); captureSpec = { path: 'new.txt', model: modelCapture(), baseline: beforeWillSave, resourceVersion: options.version, overwriteEncoding: !!options.overwriteEncoding, fenceId, taskId }; tokenResult = await journal.prepareObservedSave(id, captureSpec); phases.push('journal-intent'); await journal.commitObservedSave(id, tokenResult.token); phases.push('journal-readback'); };
  document.onDidSaveModel(() => phases.push('native-didSave'));
  t.after(() => { document.dispose(); models.dispose(); });
  return { ...f, journal, document, resource, raw, id, phases, encoder, writes: () => writes, afterWrite: hook => { afterWriteHook = hook; }, token: () => tokenResult, spec: () => captureSpec, modelCapture, fenceId, taskId, version };
}

for (const encoding of ['utf16le', 'utf8bom']) test(`retained native Save pipeline ${encoding} records verified bytes and rename Undo preserves the normal saved text`, async t => {
  const h = await nativeSaveFixture(t, encoding);
  h.document.textEditorModel.setValue('preexisting dirty\r\n'); assert.equal(h.document.dirty, true);
  h.document.onModelWillSaveModel(async () => { h.phases.push('native-willSave'); h.document.textEditorModel.setValue('normal saved 你好\r\n'); });
  await h.document.save(); assert.equal(h.writes(), 1); assert.equal(h.document.dirty, false);
  assert.deepEqual(h.phases, ['native-willSave', 'captured-after-willSave', 'journal-intent', 'native-write', 'journal-readback', 'native-didSave']);
  const savedRaw = await fs.readFile(h.path('new.txt')); assert.notDeepEqual(savedRaw, h.raw);
  await h.journal.undo(h.id); assert.deepEqual(await fs.readFile(h.path('old.txt')), savedRaw); await h.journal.redo(h.id); assert.deepEqual(await fs.readFile(h.path('new.txt')), savedRaw);
  const archive = JSON.parse(await fs.readFile(join(h.profile, 'ynx-workspace-file-journal-v1', h.id + '.json'), 'utf8')).data;
  assert.equal(archive.observedSaves.length, 1); assert.deepEqual(Buffer.from(archive.blobs[archive.states[0]['old.txt'].blob], 'base64'), h.raw); assert.equal(archive.observedSaves[0].model.dirty, true); assert.equal(archive.observedSaves[0].baseline.text, 'preexisting dirty\r\n'); assert.equal(archive.observedSaves[0].baseline.dirty, true);
});

test('observed save rejects third-party raw changes before checkpoint and stale fenced model capture', async t => {
  const h = await nativeSaveFixture(t); h.document.textEditorModel.setValue('captured text\r\n');
  const spec = { path: 'new.txt', model: h.modelCapture(), resourceVersion: await h.version(), overwriteEncoding: false, fenceId: h.fenceId, taskId: h.taskId };
  h.document.textEditorModel.setValue('later typing\r\n'); await assert.rejects(h.journal.prepareObservedSave(h.id, spec), { code: 'JOURNAL_SAVE_CAPTURE' }); assert.equal(h.writes(), 0);
  spec.model = h.modelCapture(); await fs.writeFile(h.path('new.txt'), bytes('third-party')); await assert.rejects(h.journal.prepareObservedSave(h.id, spec), { code: 'JOURNAL_CHANGED' }); assert.equal(await fs.readFile(h.path('new.txt'), 'utf8'), 'third-party');
});

test('observed save cannot accept arbitrary after-hash receipts or run without native save authority', async t => {
  const h = await nativeSaveFixture(t); const spec = { path: 'new.txt', model: h.modelCapture(), resourceVersion: await h.version(), overwriteEncoding: false, fenceId: h.fenceId, taskId: h.taskId, afterHash: '0'.repeat(64) };
  await assert.rejects(h.journal.prepareObservedSave(h.id, spec), { code: 'JOURNAL_SAVE_CAPTURE' });
  await assert.rejects(new WorkspaceFileJournal(h.env).prepareObservedSave(h.id, spec), { code: 'JOURNAL_SAVE_NOT_INTEGRATED' }); assert.equal(h.writes(), 0);
});

test('typing after save checkpoint rejects write, and exact unperformed checkpoint can be cancelled', async t => {
  const h = await nativeSaveFixture(t); h.document.textEditorModel.setValue('checkpointed\r\n'); const spec = { path: 'new.txt', model: h.modelCapture(), resourceVersion: await h.version(), overwriteEncoding: false, fenceId: h.fenceId, taskId: h.taskId };
  const { token } = await h.journal.prepareObservedSave(h.id, spec); h.document.textEditorModel.setValue('typed later\r\n'); await assert.rejects(h.journal.commitObservedSave(h.id, token), { code: 'JOURNAL_SAVE_CAPTURE' }); assert.equal(h.writes(), 0); await h.journal.cancelObservedSave(h.id, token); await h.journal.undo(h.id); assert.deepEqual(await fs.readFile(h.path('old.txt')), h.raw);
});

test('external raw mutation after observed checkpoint cannot be committed or cancelled over user bytes', async t => {
  const h = await nativeSaveFixture(t); const spec = { path: 'new.txt', model: h.modelCapture(), resourceVersion: await h.version(), overwriteEncoding: false, fenceId: h.fenceId, taskId: h.taskId };
  const { token } = await h.journal.prepareObservedSave(h.id, spec); await fs.writeFile(h.path('new.txt'), bytes('third-party saved'));
  await assert.rejects(h.journal.commitObservedSave(h.id, token), { code: 'JOURNAL_CHANGED' }); await assert.rejects(h.journal.cancelObservedSave(h.id, token), { code: 'JOURNAL_CHANGED' }); assert.equal(h.writes(), 0); assert.equal(await fs.readFile(h.path('new.txt'), 'utf8'), 'third-party saved');
});

test('successive native saves retain original bytes while resource Undo/Redo moves the latest legitimate saved bytes', async t => {
  const h = await nativeSaveFixture(t); h.document.textEditorModel.setValue('first normal save\r\n'); await h.document.save(); h.document.textEditorModel.setValue('second normal save\r\n'); await h.document.save(); assert.equal(h.writes(), 2);
  const latest = await fs.readFile(h.path('new.txt')); await h.journal.undo(h.id); assert.deepEqual(await fs.readFile(h.path('old.txt')), latest); await h.journal.redo(h.id); assert.deepEqual(await fs.readFile(h.path('new.txt')), latest);
  const data = JSON.parse(await fs.readFile(join(h.profile, 'ynx-workspace-file-journal-v1', h.id + '.json'), 'utf8')).data; assert.equal(data.observedSaves.length, 2); assert.deepEqual(Buffer.from(data.blobs[data.states[0]['old.txt'].blob], 'base64'), h.raw);
});

test('native save error after its real write keeps pending lineage and prevents fabricated Undo or discarded saved bytes', async t => {
  const h = await nativeSaveFixture(t); h.document.textEditorModel.setValue('legitimate native bytes\r\n'); const spec = { path: 'new.txt', model: h.modelCapture(), resourceVersion: await h.version(), overwriteEncoding: false, fenceId: h.fenceId, taskId: h.taskId };
  const { token } = await h.journal.prepareObservedSave(h.id, spec); h.afterWrite(() => { throw Object.assign(Error('lost native write receipt'), { code: 'native_receipt_lost' }); });
  await assert.rejects(h.journal.commitObservedSave(h.id, token), { code: 'native_receipt_lost' }); const actual = await fs.readFile(h.path('new.txt'));
  assert.notDeepEqual(actual, h.raw); assert.equal((await h.journal.inspect(h.id)).savePending.phase, 'writing');
  await assert.rejects(h.journal.undo(h.id), { code: 'JOURNAL_SAVE_PENDING' }); await assert.rejects(h.journal.cancelObservedSave(h.id, token), { code: 'JOURNAL_CHANGED' }); assert.deepEqual(await fs.readFile(h.path('new.txt')), actual); assert.equal(h.writes(), 1);
});

test('raw write batch cannot be relabelled as rename Save lineage; original write Undo semantics remain', async t => {
  const h = await nativeSaveFixture(t); const { id } = await h.journal.prepare([{ type: 'write', path: 'new.txt', bytes: h.raw }]); await h.journal.apply(id); await h.document.sync();
  const spec = { path: 'new.txt', model: h.modelCapture(), resourceVersion: await h.version(), overwriteEncoding: false, fenceId: h.fenceId, taskId: h.taskId };
  await assert.rejects(h.journal.prepareObservedSave(id, spec), { code: 'JOURNAL_SAVE_SEMANTICS' }); assert.equal(h.writes(), 0); await h.journal.undo(id); assert.deepEqual(await fs.readFile(h.path('new.txt')), h.raw);
});

test('retained native inplace Save remains allowed for writable existing file in readonly parent without chmod', async t => {
  const h = await nativeSaveFixture(t); await fs.chmod(h.workspace, 0o555); h.document.textEditorModel.setValue('allowed inplace native save\r\n'); await h.document.save();
  assert.equal(h.writes(), 1); assert.equal(h.document.dirty, false); assert.equal((await fs.stat(h.workspace)).mode & 0o777, 0o555); assert.equal((await fs.stat(h.path('new.txt'))).mode & 0o777, 0o640);
  assert.equal(h.encoder.decode({ buffer: await fs.readFile(h.path('new.txt')) }, 'utf16le'), 'allowed inplace native save\r\n');
});
