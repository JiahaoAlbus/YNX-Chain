const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const esbuild = require('esbuild');

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness() {
  const picker = deferred(), stage = deferred(), random = deferred();
  const effects = [], refs = [], states = [];
  let listener, background;
  const calls = { alerts: [], stage: [], files: [], originals: 0 };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const index = states.length; states.push(initial); return [initial, v => { states[index] = typeof v === 'function' ? v(states[index]) : v; }]; },
    useRef: current => { const ref = { current }; refs.push(ref); return ref; },
    useEffect: fn => { effects.push(fn()); }
  };
  const client = {
    appearanceContext: () => null,
    listen: fn => { listener = fn; return () => {}; },
    lock: () => listener({ type: 'locked' }),
    stageFile: uri => { calls.stage.push(uri); return stage.promise; },
    file: async (...args) => { calls.files.push(args); },
    originals: async () => { calls.originals++; return []; }
  };
  const stubs = {
    react: React,
    'react-native': { Alert: { alert: (...args) => calls.alerts.push(args) }, AppState: { addEventListener: (_, fn) => { background = fn; return { remove() {} }; } }, StyleSheet: { create: v => v }, ...Object.fromEntries(['Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(k => [k, k])) },
    'expo-crypto': { getRandomBytesAsync: () => random.promise },
    'expo-image-picker': { launchImageLibraryAsync: () => picker.promise },
    './NativeMatrixReceivedAttachment': { NativeMatrixReceivedAttachment: 'Attachment' },
    './ChatAppearanceSettings': { ChatAppearanceSettings: 'Appearance', NativeChatWallpaper: 'Wallpaper', useNativeChatAppearance: () => ({}) }
  };
  const input = process.env.SOCIAL_NATIVE_PICKER_SOURCE || path.join(__dirname, 'NativeMatrixWorkspace.tsx');
  const source = esbuild.transformSync(fs.readFileSync(input, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'transform' }).code;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => { assert.ok(name in stubs, name); return stubs[name]; }, Promise, Array, Error });
  // Render the real component with its normal restored-state UI available.
  const originalState = React.useState; let index = 0;
  React.useState = value => originalState(index++ === 3 ? true : value);
  const tree = module.exports.NativeMatrixWorkspace({ client, personId: 'qa-person', onClose() {} });
  function find(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Pressable' && JSON.stringify(node.children).includes('Choose image')) return node;
    for (const child of (Array.isArray(node) ? node : node.children || [])) { const found = find(child); if (found) return found; }
  }
  const button = find(tree); assert.ok(button, 'actual image chooser rendered');
  return { calls, picker, stage, random, start: () => button.props.onPress(), lock: () => background('background'), unmount: () => effects.forEach(fn => fn?.()) };
}
const selected = { canceled: false, assets: [{ uri: 'file:///qa-image.png', mimeType: 'image/png' }] };
test('background lock during picker prevents a stale confirmation', async () => {
  const h = harness(); h.start(); h.lock(); h.picker.resolve(selected); await flush();
  assert.equal(h.calls.alerts.length, 0); assert.equal(h.calls.stage.length, 0); assert.equal(h.calls.files.length, 0);
});
test('lock after confirmation prevents late staged image send', async () => {
  const h = harness(); h.start(); h.picker.resolve(selected); await flush();
  h.calls.alerts[0][2].find(b => b.text === 'Send image').onPress(); await flush();
  assert.equal(h.calls.stage.length, 1); h.lock(); h.stage.resolve('file:///staged.png'); h.random.resolve(new Uint8Array(16)); await flush();
  assert.equal(h.calls.files.length, 0); assert.equal(h.calls.originals, 0);
});
test('unmount during nonce creation prevents send', async () => {
  const h = harness(); h.start(); h.picker.resolve(selected); await flush();
  h.calls.alerts[0][2].find(b => b.text === 'Send image').onPress(); h.stage.resolve('file:///staged.png'); await flush();
  h.unmount(); h.random.resolve(new Uint8Array(16)); await flush(); assert.equal(h.calls.files.length, 0);
});
test('unchanged lifetime sends only the confirmed original staged image', async () => {
  const h = harness(); h.start(); h.picker.resolve(selected); await flush();
  h.calls.alerts[0][2].find(b => b.text === 'Send image').onPress(); h.stage.resolve('file:///staged.png'); h.random.resolve(new Uint8Array(16)); await flush();
  assert.equal(h.calls.files.length, 1); assert.equal(h.calls.files[0][1], 'file:///staged.png'); assert.equal(h.calls.originals, 1);
});
