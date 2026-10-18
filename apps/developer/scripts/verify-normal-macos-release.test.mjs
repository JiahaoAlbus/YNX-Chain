import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { wholeInventory, assertSameInventory, safeCoreArchiveListing } from './verify-normal-macos-release.mjs';
test('whole readback detects bytes/modes/link target changes even with same entry counts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-whole-readback-'));
  try {
    await mkdir(join(root, 'dir')); const file = join(root, 'dir/file'); await writeFile(file, 'first');
    await symlink('dir/file', join(root, 'alias'));
    const original = await wholeInventory(root); assertSameInventory(await wholeInventory(root), original, 'control');
    await writeFile(file, 'other'); const changedBytes = await wholeInventory(root);
    assert.equal(changedBytes.length, original.length); assert.throws(() => assertSameInventory(changedBytes, original, 'bytes'), /differs/);
    await writeFile(file, 'first'); await chmod(file, 0o755);
    const changedMode = await wholeInventory(root); assert.equal(changedMode.length, original.length);
    assert.throws(() => assertSameInventory(changedMode, original, 'mode'), /differs/);
    await chmod(file, original.find(p => p.path === 'dir/file').mode);
    await rm(join(root, 'alias')); await symlink('dir', join(root, 'alias'));
    const changedLink = await wholeInventory(root); assert.equal(changedLink.length, original.length);
    assert.throws(() => assertSameInventory(changedLink, original, 'link'), /differs/);
    await symlink('../outside', join(root, 'escape')); await assert.rejects(wholeInventory(root), /escapes/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('core readback refuses traversal, symlink/device entries and empty archive before extraction', () => {
  safeCoreArchiveListing(['./', './file'], ['drwx', '-rw']);
  for (const [names, details] of [[[], []], [['../file'], ['-rw']], [['/abs'], ['-rw']], [['./link'], ['lrwx']], [['./device'], ['crw']]])
    assert.throws(() => safeCoreArchiveListing(names, details), /unsupported/);
});
