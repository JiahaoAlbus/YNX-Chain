import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, chmod, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { composedTreeDigest } from '../services/codeoss-service/src/composed-runtime.mjs';
import { prepareLocalRuntime } from '../desktop/local-workbench.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
test('compressed sealed payload uses the normal launcher and preserves modes, pins and corruption refusal', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-composed-compression-')));
  try {
    const source = join(root, 'source'), output = join(root, 'payload');
    await mkdir(join(source, 'lib/backend'), { recursive: true });
    await mkdir(join(source, 'lib/frontend'), { recursive: true });
    await writeFile(join(source, 'package-lock.json'), '{}');
    await writeFile(join(source, 'lib/backend/main.js'), '/* reviewed code */\n'.repeat(16384));
    await chmod(join(source, 'lib/backend/main.js'), 0o755);
    await writeFile(join(source, 'lib/frontend/index.html'), '<html></html>');
    const pin = { kind: 'ynx-theia', version: '1.76.0', architecture: `darwin-${process.arch}`, lockSha256: sha('{}'), treeSha256: await composedTreeDigest(source) };
    const manifest = { ...pin, entry: 'lib/backend/main.js', frontend: 'lib/frontend/index.html', nodeVersion: 'v24.19.0' };
    const raw = JSON.stringify(manifest);
    await writeFile(join(source, 'YNX-COMPOSED-RUNTIME.json'), raw);
    pin.manifestSha256 = sha(raw);
    const pinPath = join(root, 'pin.json'); await writeFile(pinPath, JSON.stringify(pin));
    const bundle = () => execFileSync(process.execPath, [fileURLToPath(new URL('./bundle-composed-core.mjs', import.meta.url)), source, pinPath, output], { env: { ...process.env, YNX_DEVELOPER_LOCAL_WORKBENCH_PAYLOAD: '1' }, stdio: 'pipe' });
    bundle();
    const archive = await readFile(join(output, 'workbench.tar'));
    assert.deepEqual([...archive.subarray(0, 2)], [0x1f, 0x8b], 'normal payload must be compressed before image staging');
    assert.ok(archive.length < 16384, 'small compressible control must avoid a full tar copy');
    const distribution = JSON.parse(await readFile(join(output, 'distribution.json')));
    assert.equal(distribution.archiveCompression, 'gzip');
    assert.equal(distribution.archiveSha256, sha(archive));
    assert.equal(distribution.roundTripTreeVerified, true);
    assert.deepEqual(distribution.runtimeArtifact, pin);
    const installed = await prepareLocalRuntime({ payload: output, supportRoot: join(root, 'support') });
    assert.equal(await composedTreeDigest(installed.root), pin.treeSha256);
    assert.equal((await stat(join(installed.root, 'lib/backend/main.js'))).mode & 0o777, 0o755);
    assert.throws(bundle, /Command failed/, 'never replace an existing payload');
    const corrupt = Buffer.from(archive); corrupt[corrupt.length - 1] ^= 1;
    await writeFile(join(output, 'workbench.tar'), corrupt);
    await assert.rejects(prepareLocalRuntime({ payload: output, supportRoot: join(root, 'support') }), /archive changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
