const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const compiled = esbuild.transformSync(fs.readFileSync(path.join(__dirname, 'i18nProvider.tsx'), 'utf8'),
  { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;

function fixture(store) {
  const effects = [], changes = [];
  let context;
  const react = {
    createContext: () => ({ Provider: {} }), useContext: () => context,
    useState: value => [value, next => changes.push(next)],
    useEffect: callback => effects.push(callback), useMemo: callback => callback(),
    useRef: value => ({ current: value }),
  };
  const modules = {
    react,
    'react/jsx-runtime': { jsx: (_type, props) => { context = props.value; return props; } },
    'react-native': { I18nManager: { isRTL: false, allowRTL() {}, forceRTL() {} } },
    'expo-secure-store': store,
    'expo-localization': { getLocales: () => [{ languageTag: 'en-US' }] },
    './i18n': { locales: ['en', 'zh-Hans', 'ja'], setActiveLocale() {},
      systemLocale: () => 'en', translate: value => value },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports,
    require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } });
  module.exports.I18nProvider({ children: null });
  const cleanup = effects.map(callback => callback());
  return { context, changes, unmount: () => cleanup.forEach(stop => stop?.()) };
}

test('late startup language cannot overwrite the explicit selection', async () => {
  const read = deferred();
  const f = fixture({ getItemAsync: () => read.promise, async setItemAsync() {}, async deleteItemAsync() {} });
  await f.context.setLocale('zh-Hans');
  read.resolve('ja'); await flush();
  assert.deepEqual(f.changes, ['zh-Hans']);
  f.unmount();
});

test('rapid selections persist in order and only the newest updates the view', async () => {
  const first = deferred(), writes = [];
  let stored = 'en';
  const f = fixture({ async getItemAsync() { return null; },
    async setItemAsync(_key, value) { writes.push(value); if (value === 'zh-Hans') await first.promise; stored = value; },
    async deleteItemAsync() { stored = null; } });
  await flush(); f.changes.length = 0;
  const older = f.context.setLocale('zh-Hans');
  const newer = f.context.setLocale('ja');
  await flush(); assert.deepEqual(writes, ['zh-Hans']);
  first.resolve(); await older; await newer;
  assert.deepEqual(writes, ['zh-Hans', 'ja']);
  assert.equal(stored, 'ja'); assert.deepEqual(f.changes, ['ja']);
  f.unmount();
});

test('failed persistence does not poison the next choice or system-language reset', async () => {
  let fail = true, deletes = 0;
  const f = fixture({ async getItemAsync() { throw new Error('READ_UNAVAILABLE'); },
    async setItemAsync() { if (fail) throw new Error('WRITE_UNAVAILABLE'); },
    async deleteItemAsync() { deletes++; } });
  await assert.rejects(f.context.setLocale('zh-Hans'), /WRITE_UNAVAILABLE/);
  fail = false; await f.context.setLocale('ja'); await f.context.setLocale(null);
  assert.deepEqual(f.changes, ['ja', 'en']); assert.equal(deletes, 1);
  f.unmount();
});

test('unmount fences pending hydration and pending choice view updates', async () => {
  const read = deferred(), write = deferred();
  const f = fixture({ getItemAsync: () => read.promise, setItemAsync: () => write.promise, async deleteItemAsync() {} });
  const choice = f.context.setLocale('zh-Hans');
  await flush(); f.unmount(); read.resolve('ja'); write.resolve();
  await choice; await flush(); assert.deepEqual(f.changes, []);
});
