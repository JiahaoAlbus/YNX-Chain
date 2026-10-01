import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBtrfsProjectStorage } from '../src/btrfs-storage.mjs';
test('valid historical Btrfs qgroup remains inspectable but cannot attest strict new project quota', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-btrfs-review-'))), parent = join(root, 'a'.repeat(64)), path = join(parent, 'b'.repeat(64)); await mkdir(parent, { mode: 0o700 }); await mkdir(path, { mode: 0o700 });
  const calls = [], storage = createBtrfsProjectStorage({ projectsRoot:root, run:async args => { calls.push(args); return { stdout:args[0] === 'subvolume' ? 'Subvolume ID: 256\n' : '0/256 42 42 1073741824 none\n', stderr:'' }; } });
  const quota = await storage.verify(path); assert.equal(quota.maxBytes,1073741824); assert.equal(quota.enforced,false); assert.equal(quota.hardIsolation,false); assert.equal(quota.reason,'nested_subvolume_escape_not_closed'); assert.equal(calls.length,2); assert.equal(calls.some(x=>x.includes('delete')||x.includes('limit')),false);
});
