import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadOwnedEsbuild, verifyPackagedLocalImports } from './verify-packaged-local-imports.mjs';
// Test-only location for the actual retained workbench input; production CLI
// has no environment/tool-path option and always resolves its own workbench.
const workbench = process.env.YNX_QA_OWNED_WORKBENCH_ROOT || fileURLToPath(new URL('../runtime/theia/', import.meta.url));
const entries = ['local-workbench.mjs', 'wallet-admission-startup.mjs', 'local-go-selection.mjs', 'native-parent-control.mjs', 'original-service-pipe.mjs'];
test('actual locked esbuild builds the packaged relative graph without writing output or running entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-import-graph-'));
  try {
    await mkdir(join(root, 'desktop'));
    for (const name of entries) await writeFile(join(root, 'desktop', name), "import {value} from './shared.mjs'; throw Error('entry execution forbidden'); export {value};\n");
    await writeFile(join(root, 'desktop/shared.mjs'), 'export const value=42;\n');
    const result = await verifyPackagedLocalImports(root, workbench);
    assert.equal(result.relativeModules, 6);
    await assert.rejects(access(join(root, '.import-verification')), { code: 'ENOENT' });
    await rm(join(root, 'desktop/shared.mjs'));
    await assert.rejects(verifyPackagedLocalImports(root, workbench), /Could not resolve/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('tool declaration/lock mismatch and linked outside tool cannot replace the owned closure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-import-tool-'));
  try {
    const manifest = JSON.parse(await readFile(join(workbench, 'package.json')));
    const lock = JSON.parse(await readFile(join(workbench, 'package-lock.json')));
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
    const changed = structuredClone(lock); changed.packages['node_modules/esbuild'].version = '0.25.9';
    await writeFile(join(root, 'package-lock.json'), JSON.stringify(changed));
    await assert.rejects(loadOwnedEsbuild(root), /declaration\/lock differs/);
    await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
    await mkdir(join(root, 'node_modules')); await symlink(join(workbench, 'node_modules/esbuild'), join(root, 'node_modules/esbuild'));
    await assert.rejects(loadOwnedEsbuild(root), /outside the owned/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('ambient binary override is refused rather than executing another esbuild', async () => {
  const previous = process.env.ESBUILD_BINARY_PATH;
  try { process.env.ESBUILD_BINARY_PATH = '/PUBLIC/not-an-approved-tool'; await assert.rejects(loadOwnedEsbuild(workbench), /ambient esbuild binary/); }
  finally { if (previous === undefined) delete process.env.ESBUILD_BINARY_PATH; else process.env.ESBUILD_BINARY_PATH = previous; }
});
