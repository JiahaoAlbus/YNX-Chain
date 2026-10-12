import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, writeFile, mkdir, readdir, rm, symlink, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { packageLanguagePack, mapTranslations, LIMITS } from './package-language-pack.mjs';
// An explicit retained input, not a scan of user profiles or a registry request.
const installed = process.env.YNX_RETAINED_ZH_LANGUAGE_PACK || '/Users/huangjiahao/.vscode/extensions/ms-ceintl.vscode-language-pack-zh-hans-1.131.2026090407';
const require = createRequire(new URL('../runtime/theia/package.json', import.meta.url));
require('reflect-metadata');
const { Localization } = require('@theia/core/lib/common/i18n/localization');
const { LocalizationProvider } = require('@theia/core/lib/node/i18n/localization-provider');
const { nls } = require('@theia/core/lib/common/nls');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ynx-language-pack-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), target = join(root, 'plugin'); await mkdir(source);
  const manifest = JSON.parse(await readFile(join(installed, 'package.json')));
  manifest.contributes.localizations[0].translations = [{ id: 'vscode', path: './translations/main.i18n.json' }];
  await mkdir(join(source, 'translations'));
  await writeFile(join(source, 'package.json'), JSON.stringify(manifest));
  await writeFile(join(source, 'LICENSE.md'), await readFile(join(installed, 'LICENSE.md')));
  await writeFile(join(source, 'translations/main.i18n.json'), JSON.stringify({ contents: { 'vs/workbench/fixture': { hello: '你好' } } }));
  return { root, source, target, manifest, save: () => writeFile(join(source, 'package.json'), JSON.stringify(manifest)) };
}
test('actual retained official Chinese resources stage unchanged and match the real Theia language contract', async t => {
  const f = await fixture(t), receipt = await packageLanguagePack(await realpath(installed), f.target);
  const original = JSON.parse(await readFile(join(installed, 'package.json'))), staged = JSON.parse(await readFile(join(f.target, 'package.json')));
  assert.deepEqual(staged, original); assert.equal(receipt.extensionId, 'ms-ceintl.vscode-language-pack-zh-hans');
  assert.equal(receipt.files.length, 97); assert.equal(receipt.installedOrActivated, false); assert.equal(receipt.executableCodeCopied, false);
  const expected = [...original.contributes.localizations[0].translations.map(x => x.path.replace(/^\.\//, '')), 'LICENSE.md', 'package.json'].sort();
  assert.deepEqual(receipt.files.map(x => x.path).sort(), expected);
  for (const file of receipt.files) {
    const output = await readFile(join(f.target, file.path)); assert.equal(sha(output), file.sha256); assert.equal(output.length, file.bytes);
    assert.deepEqual(output, await readFile(join(installed, file.path)));
  }
  const translations = Object.create(null);
  for (const entry of original.contributes.localizations[0].translations) {
    const data = JSON.parse(await readFile(join(f.target, entry.path)));
    const mapped = mapTranslations(entry.id, data); Object.assign(translations, mapped);
    const expectedMapping = Object.create(null);
    for (const [scope, entries] of Object.entries(data.contents)) for (const [key, value] of Object.entries(entries))
      expectedMapping[`${entry.id}/${Localization.transformKey(scope)}/${key}`] = value;
    assert.deepEqual(mapped, expectedMapping);
  }
  const provider = new LocalizationProvider(); provider.addLocalizations({ languageId: 'zh-cn', languagePack: true, getTranslations: async () => translations });
  assert.equal(provider.getAvailableLanguages()[0].languageId, 'zh-cn');
  const localization = await provider.loadLocalization('zh-cn'); assert.equal(localization.languagePack, true);
  for (const label of ['File', 'Edit', 'Configure Display Language', 'Reload Window']) {
    const key = nls.getDefaultKey(label); assert.ok(key);
    assert.match(Localization.localize(localization, key, label, []), /[\u3400-\u9fff]/);
  }
  assert.equal(sha(Buffer.from(JSON.stringify(receipt.files))), receipt.sourceSha256);
});
test('data-only output excludes host executable files and preserves the original identity and license', async t => {
  const f = await fixture(t); await writeFile(join(f.source, 'host-code.js'), 'throw Error("must never run")');
  const receipt = await packageLanguagePack(f.source, f.target);
  assert.deepEqual((await readdir(f.target)).sort(), ['LICENSE.md', 'language-pack-inputs.json', 'package.json', 'translations']);
  assert.equal(receipt.lifecycleScriptsExecuted, false);
  assert.deepEqual(await readFile(join(f.target, 'LICENSE.md')), await readFile(join(f.source, 'LICENSE.md')));
});
for (const mode of ['escape', 'symlink file', 'symlink directory', 'corrupt JSON', 'nonstring translation', 'executable manifest', 'missing license', 'too large']) {
  test(`reject ${mode} before publishing any plugin`, async t => {
    const f = await fixture(t), resource = join(f.source, 'translations/main.i18n.json');
    if (mode === 'escape') { f.manifest.contributes.localizations[0].translations[0].path = '../outside.json'; await f.save(); }
    if (mode === 'symlink file') { await rm(resource); await writeFile(join(f.root, 'outside.json'), '{"contents":{}}'); await symlink(join(f.root, 'outside.json'), resource); }
    if (mode === 'symlink directory') { await rm(join(f.source, 'translations'), { recursive: true }); await mkdir(join(f.root, 'outside')); await symlink(join(f.root, 'outside'), join(f.source, 'translations')); }
    if (mode === 'corrupt JSON') await writeFile(resource, '{unfinished');
    if (mode === 'nonstring translation') await writeFile(resource, '{"contents":{"scope":{"key":{"malformed":true}}}}');
    if (mode === 'executable manifest') { f.manifest.main = './host-code.js'; await f.save(); }
    if (mode === 'missing license') await rm(join(f.source, 'LICENSE.md'));
    if (mode === 'too large') await truncate(resource, LIMITS.fileBytes + 1);
    await assert.rejects(packageLanguagePack(f.source, f.target));
    assert.ok(!(await readdir(f.root)).includes('plugin'));
    assert.ok(!(await readdir(f.root)).some(name => name.startsWith('.language-pack-')));
  });
}
test('existing destinations and symlink roots are rejected without modifying existing user data', async t => {
  const f = await fixture(t); await mkdir(f.target); await writeFile(join(f.target, 'user.txt'), 'keep');
  await assert.rejects(packageLanguagePack(f.source, f.target), /exists/); assert.equal(await readFile(join(f.target, 'user.txt'), 'utf8'), 'keep');
  const alias = join(f.root, 'alias'); await symlink(f.source, alias);
  await assert.rejects(packageLanguagePack(alias, join(f.root, 'fresh')), /canonical/);
  await assert.rejects(packageLanguagePack(undefined, f.target), /explicit/);
});
test('declared resource inventory has its own finite count bound', async t => {
  const f = await fixture(t);
  f.manifest.contributes.localizations[0].translations = Array.from({ length: LIMITS.files - 1 }, (_, i) => ({ id: i ? `extension${i}` : 'vscode', path: `translations/${i}.json` }));
  await f.save(); await assert.rejects(packageLanguagePack(f.source, f.target), /resource count/);
  assert.ok(!(await readdir(f.root)).includes('plugin'));
});
test('total source bytes are bounded independently of each valid translation file', async t => {
  const f = await fixture(t), translations = [];
  const json = JSON.stringify({ contents: { scope: { message: '中'.repeat(2_400_000) } } });
  assert.ok(Buffer.byteLength(json) < LIMITS.fileBytes);
  for (let i = 0; i < 5; i++) {
    const path = `translations/large${i}.json`; translations.push({ id: i ? `extension${i}` : 'vscode', path });
    await writeFile(join(f.source, path), json);
  }
  f.manifest.contributes.localizations[0].translations = translations; await f.save();
  await assert.rejects(packageLanguagePack(f.source, f.target), /byte bound/);
  assert.ok(!(await readdir(f.root)).includes('plugin'));
});
