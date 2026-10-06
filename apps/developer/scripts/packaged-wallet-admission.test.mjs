import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyPackagedLocalImports } from './verify-packaged-local-imports.mjs';

const developer = dirname(dirname(fileURLToPath(import.meta.url)));

test('actual package copy commands retain the startup and launcher admission dependency graph', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'ynx-admission-package-'));
  const app = join(fixture, 'Fixture.app');
  const root = join(app, 'Contents/Resources/code/apps/developer');
  const script = await readFile(join(developer, 'scripts/package-local-macos.sh'), 'utf8');
  try {
    for (const path of ['desktop', 'runtime/ynx-workbench/lib']) await mkdir(join(root, path), { recursive: true });
    const commands = script.split('\n').map(line => line.trim()).filter(line =>
      line.startsWith('cp desktop/') && line.endsWith('/desktop/"')
      || line.startsWith('cp runtime/ynx-workbench/lib/wallet-admission-channel.js ')
      || line.startsWith('cp runtime/ynx-workbench/package.json ')
      || line.startsWith('cp package.json package-lock.json ')
      || line.startsWith('cp -R services ') || line.startsWith('cp -R protocol '));
    assert.ok(commands.some(line => line.includes('wallet-admission-startup.mjs')));
    assert.ok(commands.some(line => line.includes('wallet-admission-channel.js')));
    for (const command of commands) execFileSync('/bin/bash', ['-c', command], { cwd: developer, env: { ...process.env, app }, stdio: 'pipe' });
    assert.ok((await verifyPackagedLocalImports(root)).relativeModules > 2);
    const channel = await import(pathToFileURL(join(root, 'runtime/ynx-workbench/lib/wallet-admission-channel.js')));
    assert.equal(typeof channel.default.serveAdmission, 'function');
    const startup = await import(pathToFileURL(join(root, 'desktop/wallet-admission-startup.mjs')));
    const admission = await startup.openBundledWalletAdmission();
    assert.throws(() => admission.assertCurrent({}), { code: 'WALLET_SERVICE_ADMISSION_NOT_SUPPLIED' });
    for (const path of ['desktop/wallet-admission-startup.mjs', 'runtime/ynx-workbench/lib/wallet-admission-channel.js', 'runtime/ynx-workbench/package.json']) {
      const file = join(root, path), retained = file + '.retained';
      await rename(file, retained);
      await assert.rejects(verifyPackagedLocalImports(root));
      await rename(retained, file);
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
