import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { LocalizationProvider, LazyLocalization } = require('@theia/core/lib/node/i18n/localization-provider');
const { nls } = require('@theia/core/lib/common/nls');
const path = fileURLToPath(new URL('../../ynx-workbench/lib/ynx-localization.js', import.meta.url));
const owned = new Module(path); owned.paths = require.resolve.paths('@theia/core'); owned._compile(readFileSync(path, 'utf8'), path);
const { registerYnxLocalizations, EN_DEFAULTS, TRANSLATIONS } = owned.exports;
test('actual LocalizationProvider owns Chinese YNX keys without advertising a standalone full language pack', async t => {
  const provider = new LocalizationProvider(), registration = registerYnxLocalizations(provider); t.after(() => registration.dispose());
  assert.deepEqual(provider.getAvailableLanguages(), []);
  assert.deepEqual(provider.getAvailableLanguages(true), [{ languageId: 'zh-cn', languageName: 'Chinese (Simplified)', localizedLanguageName: '简体中文', languagePack: false }]);
  const result = await provider.loadLocalization('zh-cn'); assert.equal(result.languagePack, false);
  assert.equal(Object.keys(result.translations).length, 25);
  for (const key of Object.keys(EN_DEFAULTS)) assert.equal(result.translations[key], TRANSLATIONS[key]);
  assert.ok(Object.isFrozen(EN_DEFAULTS)); assert.ok(Object.isFrozen(TRANSLATIONS));
});
test('actual nls resolves command/warning/buttons/controls/aria keys in Chinese and defaults to English without a locale', async t => {
  const provider = new LocalizationProvider(), registration = registerYnxLocalizations(provider), previous = nls.localization;
  t.after(() => { nls.localization = previous; registration.dispose(); });
  nls.localization = await provider.loadLocalization('zh-cn');
  for (const [key, english] of Object.entries(EN_DEFAULTS)) {
    assert.ok(key.startsWith('ynx/workbench/')); assert.match(nls.localize(key, english), /[\u3400-\u9fff]/);
    assert.equal(nls.localize(key, english), TRANSLATIONS[key]);
  }
  nls.localization = undefined;
  for (const [key, english] of Object.entries(EN_DEFAULTS)) assert.equal(nls.localize(key, english), english);
  nls.localization = await provider.loadLocalization('fr');
  assert.equal(nls.localize('ynx/workbench/openFolder', EN_DEFAULTS['ynx/workbench/openFolder']), 'Open Folder…');
});
test('host language-pack registration merges alongside YNX keys and disposing YNX translations preserves the host', async () => {
  const provider = new LocalizationProvider(), ynx = registerYnxLocalizations(provider);
  const host = provider.addLocalizations(LazyLocalization.fromLocalization({ languageId: 'zh-cn', languagePack: true, translations: { 'vscode/fileActions.contribution/filesCategory': '文件' } }));
  const combined = await provider.loadLocalization('zh-cn'); assert.equal(combined.languagePack, true);
  assert.equal(combined.translations['ynx/workbench/openFolder'], '打开文件夹…');
  assert.equal(combined.translations['vscode/fileActions.contribution/filesCategory'], '文件');
  assert.equal(provider.getAvailableLanguages()[0].languageId, 'zh-cn');
  ynx.dispose(); const remaining = await provider.loadLocalization('zh-cn'); assert.equal(remaining.languagePack, true);
  assert.equal(remaining.translations['ynx/workbench/openFolder'], undefined);
  assert.equal(remaining.translations['vscode/fileActions.contribution/filesCategory'], '文件');
  host.dispose(); assert.deepEqual(provider.getAvailableLanguages(), []);
});
