import test from 'node:test';
import assert from 'node:assert/strict';
import { selectNativeSources, createNativeLinkPlan, ownedUndefinedSymbols } from './native-macos-link-plan.mjs';
const sha = 'a'.repeat(64), nextSHA = 'b'.repeat(64), prefix = '/original/source';
function fixture() {
  const rows = [], SDKRows = [], own = new Map(), objects = [];
  for (let i = 0; i < 36; i++) {
    const key = i < 2 ? `apps/developer/desktop/macos/${i ? 'parent' : 'main'}.m`
      : i === 35 ? 'apps/wallet-desktop/native/custody.swift' : `packages/wallet-auth/native/source${i}.mm`;
    const row = { relativePath: key, path: prefix + '/' + key, bytes: 10, sha256: sha }; rows.push(row);
    if (i < 2) own.set(key, { path: '/own/' + key, bytes: 11, sha256: nextSHA });
    else if (i < 35) SDKRows.push({ captured: row, current: { path: '/current/' + key, bytes: i < 4 ? 12 : 10, sha256: i < 4 ? nextSHA : sha }, state: i < 4 ? 'CURRENT_SUCCESSOR_DIFF' : 'MATCH' });
    const object = { path: `/original/source${i}.o` };
    const argv = i === 35 ? ['/usr/bin/xcrun', 'swiftc', '-target', 'arm64-apple-macosx13.0', '-emit-object', row.path, '-o', object.path]
      : ['/usr/bin/clang++', '-mmacosx-version-min=13.0', '-I' + prefix + '/packages/wallet-auth/native', '-c', row.path, '-o', object.path];
    objects.push({ object, recordedCompileCommands: [{ name: 'compile-' + i, argv }] });
  }
  const archive = { path: prefix + '/apps/wallet-desktop/native/core.a', bytes: 20, sha256: sha };
  rows.push({ ...archive, relativePath: 'apps/wallet-desktop/native/core.a' });
  rows.push({ path: prefix + '/apps/wallet-desktop/native/warm.node', relativePath: 'apps/wallet-desktop/native/warm.node', bytes: 20, sha256: sha });
  const recipe = { capturedSourcePrefix: prefix, target: 'arm64-apple-macosx13.0', objectCount: 36, explicitObjects: objects,
    explicitArchives: [archive], strictUndefinedError: true, ownedUndefined: [],
    linkArgv: ['/usr/bin/xcrun', 'swiftc', '-target', 'arm64-apple-macosx13.0', ...objects.map(r => r.object.path), archive.path, '-Xlinker', '-undefined', '-Xlinker', 'error', '-o', '/original/App'] };
  const sdk = { SDKRows };
  return { rows, sdk, own, recipe };
}
function plan(f) { return createNativeLinkPlan({ recipe: f.recipe, inputs: selectNativeSources(f.rows, f.sdk, f.own), workRoot: '/new/build', binary: '/new/App', minimumOS: '15.0' }); }
test('rebases current SDK successors and own App, never captured binary inputs', () => {
  const f = fixture(), selected = selectNativeSources(f.rows, f.sdk, f.own), p = plan(f);
  assert.equal(selected.filter(r => r.origin === 'current-SDK').length, 33);
  assert.equal(selected.find(r => r.relativePath.endsWith('source2.mm')).sha256, nextSHA);
  assert.equal(selected.find(r => r.relativePath.endsWith('main.m')).sha256, nextSHA);
  assert.equal(selected.some(r => r.relativePath.endsWith('.node')), false);
  assert.equal(p.commands.length, 36); assert.equal(p.capturedObjectsReused, false);
  assert.ok(p.linkArgv.includes('/new/build/objects/source0.o'));
  assert.ok(!p.linkArgv.some(arg => arg.startsWith('/original/')));
  assert.ok(p.commands[0].argv.includes('-mmacosx-version-min=15.0'));
  assert.ok(p.commands[0].argv.includes('-Werror=unguarded-availability'));
  assert.ok(p.commands[0].argv.includes('-Werror=unguarded-availability-new'));
  assert.ok(p.commands[35].argv.includes('arm64-apple-macosx15.0'));
  assert.equal(p.RootAdmission, false);
});
test('missing SDK mapping, input drift and unsafe paths refuse rather than warm fallback', () => {
  const f = fixture(); f.sdk.SDKRows.pop(); assert.throws(() => plan(f), /Unmapped/);
  const drift = fixture(); drift.sdk.SDKRows[0].captured = { ...drift.sdk.SDKRows[0].captured, sha256: nextSHA };
  assert.throws(() => plan(drift), /Unmapped/);
  const bad = fixture(); bad.rows.push({ relativePath: '../escape', path: '/escape', bytes: 1, sha256: sha });
  assert.throws(() => plan(bad), /Unsafe/);
});
test('rejects NAPI, undefined lookup, extra warm objects and unknown tool inputs', () => {
  const napi = fixture(); napi.recipe.explicitObjects[0].object.path = '/original/original-auth-identity-node.mm.o';
  assert.throws(() => plan(napi), /NAPI/);
  const loose = fixture(); loose.recipe.linkArgv[loose.recipe.linkArgv.indexOf('error')] = 'dynamic_lookup';
  assert.throws(() => plan(loose), /Strict/);
  const warm = fixture(); warm.recipe.linkArgv.splice(4, 0, '/original/untracked.o');
  assert.throws(() => plan(warm), /Unmapped/);
  const escaped = fixture(); escaped.recipe.explicitObjects[0].recordedCompileCommands[0].argv[5] = '/outside/input.m';
  assert.throws(() => plan(escaped), /Unmapped/);
  const include = fixture(); include.recipe.explicitObjects[0].recordedCompileCommands[0].argv[2] = '-I/outside';
  assert.throws(() => plan(include), /Unmapped/);
});
test('Core mismatch and a deployment-target downgrade refuse', () => {
  const f = fixture(); f.recipe.explicitArchives[0] = { ...f.recipe.explicitArchives[0], sha256: nextSHA };
  assert.throws(() => plan(f), /Core/);
  const good = fixture();
  assert.throws(() => createNativeLinkPlan({ recipe: good.recipe, inputs: selectNativeSources(good.rows, good.sdk, good.own), workRoot: '/new/build', binary: '/new/App', minimumOS: '12.0' }), /deployment/);
});
test('post-link owned and NAPI imports cannot hide among system undefined symbols', () => {
  assert.deepEqual(ownedUndefinedSymbols(' _objc_msgSend\n _OBJC_CLASS_$_NSObject\n'), []);
  assert.deepEqual(ownedUndefinedSymbols(' _OBJC_CLASS_$_YNXParent\n _ynx_core\n _napi_call_function\n'),
    ['_OBJC_CLASS_$_YNXParent', '_ynx_core', '_napi_call_function']);
});
