import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {guides, guideLocales, guideLocale} from '../web/guide-translations.js';

test('all twelve guide languages resolve without treating Traditional Chinese as Simplified', () => {
  assert.equal(new Set(guideLocales).size, 12);
  for (const locale of guideLocales) assert.equal(guideLocale(locale), locale);
  assert.equal(guideLocale('zh-TW'), 'zh-Hant');
  assert.equal(guideLocale('zh-Hant-HK'), 'zh-Hant');
  assert.equal(guideLocale('ar-SA'), 'ar');
  assert.equal(guideLocale('ja-JP'), 'ja');
  assert.equal(guideLocale('unknown'), 'en');
  for (const guide of Object.values(guides)) {
    assert.equal(guide.headings.length, 5);
    assert.equal(guide.paragraphs.length, 5);
    assert.ok(guide.paragraphs.every((text) => text.length > 50));
  }
});

test('guide picker renders translated articles and reverses direction for Arabic only', async () => {
  const script = await readFile(new URL('../web/help.js', import.meta.url), 'utf8');
  const element = () => ({dataset: {}, children: [], append(...children) { this.children.push(...children); }, addEventListener() {}});
  const picker = element();
  const main = element();
  const root = {};
  const existing = [{dataset: {language: 'en'}}, {dataset: {language: 'zh-Hans'}}];
  const context = vm.createContext({guides, guideLocale,
    navigator: {language: 'ar-SA'}, localStorage: {getItem: () => null, setItem() {}},
    document: {documentElement: root, createElement: element,
      querySelector: (selector) => selector === '#language' ? picker : main,
      querySelectorAll: () => [...existing, ...main.children],
    },
  });
  vm.runInContext(script.replace(/^import .*;\n/, ''), context);
  assert.equal(root.dir, 'rtl');
  assert.equal(root.lang, 'ar');
  assert.equal(main.children.length, 10);
  assert.equal(main.children.filter((article) => !article.hidden)[0].lang, 'ar');
  vm.runInContext("selectLanguage('ja')", context);
  assert.equal(root.dir, 'ltr');
  assert.equal(root.lang, 'ja');
  assert.equal(main.children.filter((article) => !article.hidden)[0].lang, 'ja');
});
