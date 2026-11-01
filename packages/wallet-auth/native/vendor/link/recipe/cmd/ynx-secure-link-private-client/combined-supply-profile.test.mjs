import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CORE_SUPPLY_PROFILES, selectCoreSupplyProfile, verifyCoreSupplyBytes, verifyCombinedSupplyResult} from './combined-supply-profile.mjs';

const command = 'cmd/ynx-artifact-release-cabi';
const pin = (name, bytes) => ({path: name, bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  gitBlob: createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')});

// PUBLIC in-memory declarations only. They exercise the producer gate without
// compiling, running Go, reading owner sources, or asserting a real Git supply.
function fixture(id = 'core17/47') {
  const selected = CORE_SUPPLY_PROFILES.find(row => row.id === id);
  const sourceBytes = new Map(selected.sourcePaths.map(name => {
    let text = name.endsWith('.go') ? 'package ' + (name.startsWith(command + '/') ? 'main' : name.split('/').at(-2)) + '\n' : 'PUBLIC original bytes\n';
    if (name === command + '/core.go') text += 'func main() {}\n';
    if (name.endsWith('.go')) for (const binding of selected.bindings.filter(row => row.bridge === name)) text += '//export ' + binding.symbol + '\nfunc ' + binding.symbol + '() {}\n';
    if (name.endsWith('.h')) text = selected.bindings.filter(row => row.header === name).map(row => 'int32_t ' + row.symbol + '(void);').join('\n') + '\n';
    return [name, Buffer.from(text)];
  }));
  const sources = [...sourceBytes].map(([name, bytes]) => pin(name, bytes));
  const byPath = new Map(sources.map(row => [row.path, row]));
  const descriptorBytes = new Map(selected.modulePaths.map(name => [name, sourceBytes.get(name) ?? Buffer.from('PUBLIC original ' + name + '\n')]));
  const core = {version: 'YNX-CORE-MACOS-SINGLE-GO-IMAGE-PUBLIC-SOURCE-SUPPLY/v1',
    source: {commit: selected.commit, tree: selected.tree, module: 'github.com/JiahaoAlbus/YNX-Chain', go: '1.26.10'},
    LINKReadOnlyComposition: {sourceCommit: '8df4139adb14c68d93e0a55a56851399d46059ac'}, sources,
    exports: selected.bindings.map(row => ({symbol: row.symbol, ...Object.fromEntries(['bridge', 'header', 'implementation'].map(kind => [kind, {...byPath.get(row[kind])}]))})),
    moduleContext: {sourceCommit: selected.commit, sourceTree: selected.tree, originalReplace: 'github.com/cometbft/cometbft => ./third_party/cometbft', stubModule: false,
      descriptors: [...descriptorBytes].map(([name, bytes]) => ({...pin(name, bytes), repositoryPath: name}))},
    productionPackageClosure: Object.fromEntries(selected.packagePaths.map(name => {
      const paths = selected.sourcePaths.filter(row => row.startsWith(name + '/') && row.endsWith('.go'));
      return [name, {paths, goFiles: paths.length}];
    })),
    actualCounts: {sourceLeaves: sources.length, productionGo: sources.filter(row => row.path.endsWith('.go')).length,
      handHeaders: selected.headers.length, exportedSymbols: selected.coreExports, cgoTranslationUnits: selected.bridges.length, cgoTranslationUnitPaths: [...selected.bridges]},
  };
  return {core, selected, sourceBytes, descriptorBytes};
}
function verify(f) {return verifyCoreSupplyBytes(f.core, selectCoreSupplyProfile(f.core), f.sourceBytes, f.descriptorBytes);}
function replace(f, name, text) {
  const bytes = Buffer.from(text), replacement = pin(name, bytes);
  f.sourceBytes.set(name, bytes);
  Object.assign(f.core.sources.find(row => row.path === name), replacement);
  for (const row of f.core.exports) for (const kind of ['bridge', 'header', 'implementation']) if (row[kind].path === name) Object.assign(row[kind], replacement);
}

test('only original Core15/45 and supplied Core17/47 select complete named profiles', () => {
  for (const [id, leaves, headers, count] of [['core15/45', 68, 13, 15], ['core17/47', 76, 15, 17]]) {
    const f = fixture(id), result = verify(f);
    assert.equal(result.profile, id); assert.equal(result.sourceLeaves, leaves); assert.equal(result.handHeaders, headers); assert.equal(result.coreExports, count);
    assert.equal(result.totalExports, count + 30); assert.equal(result.descriptors, 4);
  }
});

test('original Core15 metadata has no later actualCounts block; Core17 must retain it', () => {
  const old = fixture('core15/45'); delete old.core.actualCounts;
  assert.equal(verify(old).sourceLeaves, 68);
  old.core.sources.pop();
  assert.throws(() => selectCoreSupplyProfile(old.core), /closed unique Core source paths/);
  const current = fixture(); delete current.core.actualCounts;
  assert.throws(() => selectCoreSupplyProfile(current.core), /declared source\/header\/export counts/);
});

test('Core17 requires both new exact ABIs, all eight additional source leaves, and original mandatory headers', () => {
  const f = fixture(), old = fixture('core15/45');
  assert.deepEqual(f.selected.symbols.filter(name => !old.selected.symbols.includes(name)), ['YNXAccountMigrationAuthorizationSignV1', 'YNXProductPairPendingOriginalQuerySignV1']);
  const added = f.selected.sourcePaths.filter(name => !old.selected.sourcePaths.includes(name));
  assert.equal(added.length, 8);
  assert.ok(added.includes('internal/ynxauth/migration_signing.go'));
  assert.ok(added.includes('internal/ynxbatch/product_pair_pending_original_query.go'));
  for (const name of [...added, command + '/tx_batch.h', command + '/account_initial.h']) {
    const missing = fixture(); missing.core.sources = missing.core.sources.filter(row => row.path !== name);
    assert.throws(() => selectCoreSupplyProfile(missing.core), /closed unique Core source paths/);
  }
});

test('missing, extra, duplicate and same-count renamed Core17 export identities refuse', () => {
  for (const mutation of [
    rows => rows.pop(), rows => rows.push({...rows[0], symbol: 'YNXUnlistedSignV1'}),
    rows => {rows[16] = {...rows[0]};}, rows => {rows[16].symbol = 'YNXProductPairPendingOriginalQuerySignV2';},
  ]) {const f = fixture(); mutation(f.core.exports); assert.throws(() => selectCoreSupplyProfile(f.core), /closed unique Core export identities/);}
});

test('wrong commit, wrong tree, mixed Core15 identity and arbitrary same-count version refuse', () => {
  for (const mutation of [
    c => {c.source.commit = '0'.repeat(40);}, c => {c.source.tree = '0'.repeat(40);},
    c => {c.source.commit = CORE_SUPPLY_PROFILES[0].commit; c.source.tree = CORE_SUPPLY_PROFILES[0].tree;},
  ]) {const f = fixture(); mutation(f.core); assert.throws(() => selectCoreSupplyProfile(f.core), /identity required|Core export identities/);}
  const old = fixture('core15/45'); old.core.source.tree = CORE_SUPPLY_PROFILES[1].tree;
  assert.throws(() => selectCoreSupplyProfile(old.core), /commit\/tree identity/);
});

test('same-count substitute, duplicate and arbitrary unlisted source paths refuse', () => {
  for (const mutation of [
    rows => {rows[0] = {...rows[0], path: command + '/unlisted.h'};},
    rows => {rows[1] = {...rows[0]};}, rows => rows.push({...rows[0], path: 'internal/ynxbatch/unlisted.go'}),
  ]) {const f = fixture(); mutation(f.core.sources); assert.throws(() => selectCoreSupplyProfile(f.core), /closed unique Core source paths/);}
});

test('new export bridge, header and private implementation identity cannot be remapped', () => {
  for (const kind of ['bridge', 'header', 'implementation']) {
    const f = fixture(), row = f.core.exports.find(row => row.symbol === 'YNXProductPairPendingOriginalQuerySignV1');
    row[kind] = {...f.core.exports[0][kind]};
    assert.throws(() => selectCoreSupplyProfile(f.core), /fixed .* identity\/pin required/);
  }
});

test('export reference pins and declared complete profile counts must match source inventory', () => {
  for (const mutation of [
    c => {c.exports[16].bridge.sha256 = '0'.repeat(64);},
    c => {c.actualCounts.handHeaders = 14;}, c => {c.actualCounts.exportedSymbols = 16;},
    c => {c.actualCounts.cgoTranslationUnitPaths.pop();},
  ]) {const f = fixture(); mutation(f.core); assert.throws(() => selectCoreSupplyProfile(f.core), /fixed|counts|cgo translation/);}
});

test('all four descriptors retain the same source identity and replacement context', () => {
  for (const mutation of [
    c => c.moduleContext.descriptors.pop(), c => {c.moduleContext.descriptors[3] = {...c.moduleContext.descriptors[2]};},
    c => {c.moduleContext.sourceCommit = '0'.repeat(40);}, c => {c.moduleContext.sourceTree = '0'.repeat(40);},
    c => {c.moduleContext.originalReplace = 'github.com/cometbft/cometbft => ./stub';},
    c => {c.moduleContext.descriptors[0].sha256 = '0'.repeat(64);},
  ]) {const f = fixture(); mutation(f.core); assert.throws(() => selectCoreSupplyProfile(f.core), /descriptor|module\/replacement context/);}
});

test('production package closure cannot omit or add a Go source or change its count', () => {
  for (const mutation of [
    c => c.productionPackageClosure['internal/ynxbatch'].paths.pop(),
    c => c.productionPackageClosure['internal/ynxbatch'].paths.push('internal/ynxbatch/unlisted.go'),
    c => {c.productionPackageClosure[command].goFiles--;}, c => {c.productionPackageClosure['internal/unlisted'] = {paths: [], goFiles: 0};},
  ]) {const f = fixture(); mutation(f.core); assert.throws(() => selectCoreSupplyProfile(f.core), /production|Go count/);}
});

test('hidden unlisted source export in an existing internal leaf refuses even with updated byte pins', () => {
  const f = fixture(), name = 'internal/ynxbatch/product_pair_pending_original_query.go';
  replace(f, name, f.sourceBytes.get(name) + '\n//export YNXUnlistedSignV1\nfunc YNXUnlistedSignV1() {}\n');
  assert.throws(() => verify(f), /actual source \/\/export declarations/);
});

test('missing, duplicate and moved actual Core17 export declarations refuse', () => {
  const name = command + '/pending_query_bridge.go';
  for (const mutation of [
    f => replace(f, name, 'package main\n'),
    f => replace(f, name, f.sourceBytes.get(name) + '\n//export YNXProductPairPendingOriginalQuerySignV1\n'),
    f => {replace(f, name, 'package main\n'); replace(f, command + '/pending_query_core.go', 'package main\n//export YNXProductPairPendingOriginalQuerySignV1\n');},
  ]) {const f = fixture(); mutation(f); assert.throws(() => verify(f), /actual source|wrong bridge/);}
});

test('missing, extra and moved hand-header prototypes refuse', () => {
  const name = command + '/product_pair_pending_original_query.h';
  for (const mutation of [
    f => replace(f, name, '/* missing prototype */\n'),
    f => replace(f, name, f.sourceBytes.get(name) + '\nint32_t YNXUnlistedSignV1(void);\n'),
    f => {replace(f, name, '/* moved */\n'); replace(f, command + '/account_initial.h', f.sourceBytes.get(command + '/account_initial.h') + '\nint32_t YNXProductPairPendingOriginalQuerySignV1(void);\n');},
  ]) {const f = fixture(); mutation(f); assert.throws(() => verify(f), /hand-header declarations|wrong header/);}
});

test('original byte verification rejects unchanged SHA metadata, forged SHA-only update and descriptor drift', () => {
  const f = fixture(), name = 'internal/ynxauth/policy.go';
  f.sourceBytes.set(name, Buffer.from('PUBLIC wrong old policy\n'));
  assert.throws(() => verify(f), /original bytes\/hash\/Git mismatch/);
  const row = f.core.sources.find(row => row.path === name), changed = pin(name, f.sourceBytes.get(name));
  row.bytes = changed.bytes; row.sha256 = changed.sha256; // The original Git blob still disagrees.
  assert.throws(() => verify(f), /original bytes\/hash\/Git mismatch/);
  const modules = fixture(); modules.descriptorBytes.set('third_party/cometbft/go.mod', Buffer.from('PUBLIC stub\n'));
  assert.throws(() => verify(modules), /original bytes\/hash\/Git mismatch/);
});

test('read inventories must be complete and the sole original main cannot be duplicated', () => {
  const f = fixture(); f.sourceBytes.delete(command + '/pending_query_core.go');
  assert.throws(() => verify(f), /read source paths/);
  const modules = fixture(); modules.descriptorBytes.delete('third_party/cometbft/go.sum');
  assert.throws(() => verify(modules), /read module paths/);
  const extra = fixture(), name = command + '/pending_query_core.go';
  replace(extra, name, extra.sourceBytes.get(name) + '\nfunc main() {}\n');
  assert.throws(() => verify(extra), /sole original Core main/);
});

test('post-symbol gate requires exact Core15/45 or Core17/47 and preserves LINK22/Product8 counts', () => {
  for (const selected of CORE_SUPPLY_PROFILES) {
    const good = () => ({coreExports: [...selected.symbols], linkExports: Array(22), productExports: Array(8), symbols: Array(selected.totalExports)});
    verifyCombinedSupplyResult(selected, good());
    for (const mutation of [r => r.coreExports.pop(), r => {r.coreExports[0] = 'YNXUnlistedSignV1';}, r => r.linkExports.pop(), r => r.productExports.pop(), r => r.symbols.pop()]) {
      const result = good(); mutation(result); assert.throws(() => verifyCombinedSupplyResult(selected, result), /strong Core export|complete Core/);
    }
  }
  assert.throws(() => verifyCombinedSupplyResult({...CORE_SUPPLY_PROFILES[1]}, {}), /approved named profile/);
});
