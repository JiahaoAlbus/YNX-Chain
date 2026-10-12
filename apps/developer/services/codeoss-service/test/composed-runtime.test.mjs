import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { composedTreeDigest, verifyComposedRuntime } from '../src/composed-runtime.mjs';

test('reviewed composed artifact detects changed executable content and manifest before admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-composed-pin-'));
  await mkdir(join(root, 'lib/backend'), { recursive: true });
  await mkdir(join(root, 'lib/frontend'), { recursive: true });
  await writeFile(join(root, 'lib/backend/main.js'), 'process.exit(0);');
  await writeFile(join(root, 'lib/frontend/index.html'), '<html></html>');
  await writeFile(join(root, 'package-lock.json'), '{}');
  const manifest = { kind: 'ynx-theia', version: '1.76.0', architecture: 'linux-x64', entry: 'lib/backend/main.js', frontend: 'lib/frontend/index.html',
    lockSha256: createHash('sha256').update('{}').digest('hex'), treeSha256: await composedTreeDigest(root) };
  const bytes = JSON.stringify(manifest);
  await writeFile(join(root, 'YNX-COMPOSED-RUNTIME.json'), bytes);
  const pin = { kind: manifest.kind, version: manifest.version, architecture: manifest.architecture,
    lockSha256: manifest.lockSha256, treeSha256: manifest.treeSha256, manifestSha256: createHash('sha256').update(bytes).digest('hex') };
  assert.deepEqual(await verifyComposedRuntime(root, pin), manifest);
  await writeFile(join(root, 'lib/backend/main.js'), 'require("node:fs").readFileSync("/other-owner");');
  await assert.rejects(verifyComposedRuntime(root, pin), { code: 'core_artifact_invalid' });
  assert.equal(await readFile(join(root, 'YNX-COMPOSED-RUNTIME.json'), 'utf8'), bytes);
  await writeFile(join(root, 'lib/backend/main.js'), 'process.exit(0);');
  await symlink('/tmp', join(root, 'outside'));
  await assert.rejects(verifyComposedRuntime(root, pin), { code: 'core_artifact_invalid' });
});
