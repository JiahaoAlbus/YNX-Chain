import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { copyIdentityAdmissionSource, verifyIdentityAdmissionSource } from './package-identity-admission-source.mjs';

const developer = dirname(dirname(fileURLToPath(import.meta.url)));
test('source receiver uses precise lazy entry and running server location without authority overrides', async () => {
  const startup = await readFile(join(developer, 'desktop/wallet-admission-startup.mjs'), 'utf8');
  const server = await readFile(join(developer, 'desktop/code-server.mjs'), 'utf8');
  const receipt = await verifyIdentityAdmissionSource();
  assert.equal(receipt.files.filter(pin => pin.nullPath).length, 2);
  assert.match(startup, /from '\.\.\/vendor\/identity-admission\/scripts\/ynx-ide-service-admission-supplier\.mjs'/);
  assert.match(startup, /await openOriginalIDEServiceAdmissionSupplier\(runningBackendModuleURL\)/);
  assert.doesNotMatch(startup, /process\.env|from.*protected-startup|\/src\/|consumerProvenancePath/);
  assert.match(server, /await openBundledWalletAdmission\(import\.meta\.url\)/);
  const selection = await readFile(join(developer, 'vendor/identity-admission/scripts/original-ide-service-admission-native-selection.mjs'), 'utf8');
  assert.match(selection, /export const originalIDEServiceAdmissionStartupSelection=null;/);
});
test('fixed source producer rejects missing, altered, symlink and extra leaves without importing supplier', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'ynx-identity-source-'));
  const root = join(temporary, 'vendor/identity-admission');
  try {
    assert.equal((await copyIdentityAdmissionSource(root)).sourceLeaves, 36);
    await assert.rejects(copyIdentityAdmissionSource(root), { code: 'EEXIST' });
    const selected = join(root, 'scripts/original-ide-service-admission-native-selection.mjs');
    const bytes = await readFile(selected);
    await writeFile(selected, bytes.toString().replace('Selection=null', 'Selection=true'));
    await assert.rejects(verifyIdentityAdmissionSource(root));
    await writeFile(selected, bytes);
    await rename(selected, selected + '.retained');
    await assert.rejects(verifyIdentityAdmissionSource(root));
    await symlink(selected + '.retained', selected);
    await assert.rejects(verifyIdentityAdmissionSource(root));
    await rm(selected);
    await rename(selected + '.retained', selected);
    const extra = join(root, 'src/unreviewed.js');
    await writeFile(extra, 'throw new Error("unreviewed");');
    await assert.rejects(verifyIdentityAdmissionSource(root));
    await rm(extra);
    assert.equal((await verifyIdentityAdmissionSource(root)).files.length, 36);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
