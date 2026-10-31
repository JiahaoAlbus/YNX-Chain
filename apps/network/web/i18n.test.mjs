import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { environment, settle, appSource, A, record } from './test-support.mjs';

const source = readFileSync(new URL('./i18n.js', import.meta.url), 'utf8');
const locales = ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'id'];
const storageKey = 'ynxNetworkLocale';
class Element {
  constructor(attrs = {}, value = '') { this.attrs = new Map(Object.entries(attrs)); this.value = value; this.textContent = ''; }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  set innerHTML(_) { throw new Error('Translations must never use HTML insertion'); }
}
function load({ saved, storageError = false, nodes = [], loading = false } = {}) {
  const writes = [], callbacks = new Map(), values = new Map([[storageKey, saved], ['unrelated', 'preserve']]);
  const localStorage = {
    getItem(key) { if (storageError) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (storageError) throw new Error('blocked'); writes.push([key, value]); values.set(key, value); },
  };
  const document = {
    documentElement: {}, readyState: loading ? 'loading' : 'complete',
    querySelectorAll(selector) { const attr = selector.slice(1, -1); return nodes.filter(node => node.attrs.has(attr)); },
    addEventListener(type, listener) { callbacks.set(type, listener); },
  };
  const window = { localStorage, document };
  // Catalog capture is test-only; the shipped API exposes no dictionary mutation surface.
  runInNewContext(source.replace('  // CATALOG_END', '  root.__testCatalog = catalog;\n  // CATALOG_END'), { window });
  return { I: window.NetworkI18n, catalog: window.__testCatalog, document, writes, values, callbacks };
}
function placeholderNames(value) { return [...String(value).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort(); }
function decodeLiteral(quote, body) {
  return runInNewContext(quote + body + quote, Object.create(null), { timeout: 100 });
}
function sourceKeys(name) {
  const value = readFileSync(new URL('./' + name, import.meta.url), 'utf8');
  if (name.endsWith('.html')) return [...value.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map(match => match[1]);
  return [...value.matchAll(/(['"])((?:\\.|(?!\1)[^\\])*?)\1/g)]
    .map(match => decodeLiteral(match[1], match[2]))
    .filter(key => /[\u3400-\u9fff]/u.test(key));
}

test('i18n exposes exactly the twelve approved locales and defaults to Simplified Chinese', () => {
  const { I, writes } = load();
  assert.deepEqual(Array.from(I.locales), locales);
  assert.equal(I.locale, 'zh-Hans');
  assert.equal(I.t('未配对'), '未配对');
  assert.equal(Object.isFrozen(I), true);
  assert.equal(Object.isFrozen(I.locales), true);
  assert.deepEqual(writes, []);
  for (const invalid of ['en-US', 'zh-CN', 'AR', 'ar-SA', '', null, undefined, {}, ['en'], '__proto__']) {
    assert.equal(I.setLocale(invalid), false);
    assert.equal(I.locale, 'zh-Hans');
  }
  assert.deepEqual(writes, []);
  assert.throws(() => { I.locale = 'en'; }, TypeError);
  assert.throws(() => { I.locales.push('xx'); }, error => error.name === 'TypeError');
});

test('i18n persists only the language preference and tolerates unavailable storage', () => {
  const persisted = load({ saved: 'fr' });
  assert.equal(persisted.I.locale, 'fr');
  assert.equal(persisted.I.setLocale('ar'), true);
  assert.deepEqual(persisted.writes, [[storageKey, 'ar']]);
  assert.equal(persisted.values.get('unrelated'), 'preserve');
  assert.equal(load({ saved: persisted.values.get(storageKey) }).I.locale, 'ar');
  for (const invalid of ['zh-CN', '<script>', 'ar-SA']) assert.equal(load({ saved: invalid }).I.locale, 'zh-Hans');
  const blocked = load({ storageError: true });
  assert.equal(blocked.I.locale, 'zh-Hans');
  assert.equal(blocked.I.setLocale('id'), true);
  assert.equal(blocked.I.t('未配对'), 'Belum dipasangkan');
});

test('i18n updates document language, Arabic RTL and accessible static labels using text only', () => {
  const label = new Element({ 'data-i18n': '未配对' });
  const aria = new Element({ 'data-i18n-aria-label': '主导航', 'aria-label': '主导航' });
  const title = new Element({ 'data-i18n-title': '设置', title: '设置' });
  const input = new Element({ 'data-i18n-placeholder': '一次性配对码' }, '001122-not-a-language-preference');
  const alt = new Element({ 'data-i18n-alt': '网络状态', alt: '网络状态' });
  const raw = new Element({}, '{"amount":9007199254740993,"status":"RPC_ONLY"}');
  raw.textContent = raw.value;
  const { I, document, callbacks } = load({ nodes: [label, aria, title, input, alt, raw], loading: true });
  assert.equal(document.documentElement.lang, 'zh-Hans');
  assert.equal(document.documentElement.dir, 'ltr');
  I.setLocale('ar');
  assert.equal(document.documentElement.lang, 'ar');
  assert.equal(document.documentElement.dir, 'rtl');
  assert.equal(label.textContent, 'غير مقترن');
  assert.equal(aria.getAttribute('aria-label'), I.t('主导航'));
  assert.equal(title.getAttribute('title'), I.t('设置'));
  assert.equal(input.getAttribute('placeholder'), I.t('一次性配对码'));
  assert.equal(alt.getAttribute('alt'), I.t('网络状态'));
  assert.equal(input.value, '001122-not-a-language-preference');
  assert.equal(raw.textContent, '{"amount":9007199254740993,"status":"RPC_ONLY"}');
  assert.equal(callbacks.has('DOMContentLoaded'), true);
  callbacks.get('DOMContentLoaded')();
  assert.equal(document.documentElement.dir, 'rtl');
  I.setLocale('ja');
  assert.equal(document.documentElement.lang, 'ja');
  assert.equal(document.documentElement.dir, 'ltr');
  assert.equal(label.textContent, '未ペアリング');
});

test('i18n subscriptions report actual locale changes and can be removed', () => {
  const { I } = load(), changes = [];
  const unsubscribe = I.subscribe(locale => changes.push(locale));
  I.subscribe(() => { throw new Error('listener failure must not block the next listener'); });
  const afterFailure = [];
  I.subscribe(locale => afterFailure.push(locale));
  assert.equal(I.setLocale('zh-Hans'), true);
  assert.equal(I.setLocale('xx'), false);
  assert.equal(I.setLocale('ko'), true);
  assert.equal(I.setLocale('ko'), true);
  unsubscribe();
  I.setLocale('ru');
  assert.deepEqual(changes, ['ko']);
  assert.deepEqual(afterFailure, ['ko', 'ru']);
  assert.throws(() => I.subscribe('not a function'), /function/);
});

test('all visible HTML and client-controller messages have explicit translations in every locale', () => {
  const { I, catalog } = load();
  const keys = new Set(['index.html', 'app.js', 'shell.js'].flatMap(sourceKeys));
  assert.ok(keys.size > 250, 'coverage must include the full static and dynamic client');
  const missing = [...keys].filter(key => !Object.hasOwn(catalog, key));
  assert.deepEqual(missing, [], 'missing visible message keys');
  for (const [key, entry] of Object.entries(catalog)) {
    assert.deepEqual(Object.keys(entry).sort(), [...locales].sort(), key);
    for (const locale of locales) {
      assert.equal(typeof entry[locale], 'string', locale + ': ' + key);
      assert.ok(entry[locale].length > 0, locale + ': empty ' + key);
      assert.deepEqual(placeholderNames(entry[locale]), placeholderNames(key), locale + ': placeholders ' + key);
      I.setLocale(locale);
      assert.equal(I.t(key), entry[locale], locale + ': explicit catalog lookup ' + key);
      // Non-CJK locales must not silently use Chinese source strings as a fallback.
      if (!['zh-Hans', 'zh-Hant', 'ja'].includes(locale)) assert.equal(/[\u3400-\u9fff]/u.test(entry[locale]), false, locale + ': untranslated Chinese ' + key);
    }
  }
  const warningKeys = [
    '未配对', '尚未配置', '不可用', '资源默认关闭', 'Wallet 尚未连接',
    '历史不是当前授权', '当前为 Testnet。Network 不保管私钥，资产操作须在 Wallet 中批准。',
    '网页配对不证明浏览器的 OS 身份，也不授予节点管理或 Wallet 权限。',
    '资金、账户与发票状态尚未验证；ABCI 成功不等于到账证明',
  ];
  for (const locale of ['zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'id']) {
    I.setLocale(locale);
    for (const key of warningKeys) assert.notEqual(I.t(key), catalog[key].en, locale + ': no English fallback for ' + key);
  }
});

test('i18n interpolates data verbatim without translating hashes, status codes or large numeric lexemes', () => {
  const { I } = load();
  const hash = '0x5469bfc2a41b76150b765122e4dc5e02c3bbe66886c24f46efe0dfd60edea5ac';
  const height = '9007199254740993';
  const raw = '{"amount":9007199254740993,"hash":"' + hash + '","literal":"{height}"}';
  for (const locale of locales) {
    I.setLocale(locale);
    assert.ok(I.t('独立检查点 · {source} · 高度 {height} · 信任期至 {until}', { source: hash, height, until: '2026-11-01T10:00:00Z' }).includes(height));
    assert.ok(I.t('历史记录 · {level}', { level: 'RPC_ONLY' }).endsWith('RPC_ONLY'));
    assert.ok(I.t('已解析的来源对象（不等同于原始字节）：\n{report}', { report: raw }).endsWith('\n' + raw));
    assert.equal(I.t(hash), hash);
    assert.equal(I.t(raw), raw);
    assert.equal(I.t('UNKNOWN_RPC_CODE'), 'UNKNOWN_RPC_CODE');
    assert.equal(I.t('{hash}/{height}', { hash, height }), hash + '/' + height);
    assert.equal(I.t('{known}/{missing}', { known: '<b>未配对</b>' }), '<b>未配对</b>/{missing}');
    assert.equal(I.t('{inherited}', Object.create({ inherited: 'do not use' })), '{inherited}');
    assert.equal(I.t('{missing}', null), '{missing}');
  }
});

test('actual receipt client rerenders locale without refetching or changing raw evidence and permissions', { timeout: 5000 }, async () => {
  const wiredSource = source + '\n' + appSource +
    '\ndocument.getElementById("lookup-button").addEventListener("test-locale",()=>{window.NetworkI18n.setLocale("ar");window.NetworkClient.rerenderLocale();});';
  const env = environment({ source: wiredSource });
  await settle();
  const lookup = env.emit('lookup-form', 'submit');
  const request = env.take('/api/client-receipt');
  const raw = '{ "amount": 9007199254740993, "hash": "' + A + '", "state":"RPC_ONLY" }';
  request.resolve(record(A, 'RPC_ONLY', { reportText: raw }));
  await lookup;
  await settle();
  assert.equal(env.node('raw-report').textContent, raw);
  assert.equal(env.node('level-tag').textContent, 'RPC_ONLY');
  assert.equal(env.node('meta-tx').textContent, A);
  const requestsBefore = env.requests.length;
  env.emit('lookup-button', 'test-locale');
  assert.equal(env.requests.length, requestsBefore, 'language change must not query or submit anything');
  assert.equal(env.node('raw-report').textContent, raw);
  assert.equal(env.node('level-tag').textContent, 'RPC_ONLY');
  assert.equal(env.node('meta-tx').textContent, A);
  assert.equal(env.node('tx-id').value, A);
  assert.match(env.node('funds-result').textContent, /[\u0600-\u06ff]/u);
  assert.equal(env.node('revoke').hidden, false);
  assert.equal(env.rows.some(row => row.classList.contains('reached')), false);
  assert.equal(env.node('evidence-meta').hidden, false);
  assert.equal(env.node('native-state').textContent.includes('NATIVE_UNAVAILABLE'), true);
});
