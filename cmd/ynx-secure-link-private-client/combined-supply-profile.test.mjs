import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CORE_SUPPLY_PROFILES, normalizeCoreSupply, selectCoreSupplyProfile, verifyCoreSupplyBytes,
  verifyCombinedSupplyResult, verifyCoreCommandDependencyClosure, diagnoseSourceV2Golden,
  CORE19_C2_BINDING, verifyCore19C2Recipe, verifyCore19C2NeutralSymbols,
  selectCombinedGoToolchain, verifyCombinedGoEnvironment} from './combined-supply-profile.mjs';
import {shopRole, shopImportFile, shopImportPath} from './shop-legacy-archive-inputs.mjs';
import {linkRequiredSymbols, productTransportRequiredSymbols, shopRequiredSymbols,
  shopNativeRequiredSymbols, shopBorrowSymbols} from './combined-archive-symbols.mjs';

// Preserve the original fixture dialects; Core20 has its own independent suite.
const legacyProfiles = CORE_SUPPLY_PROFILES.filter(row => row.coreExports <= 19);
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
    if (selected.coreExports >= 18 && selected.cgoTranslationUnits.includes(name)) text += '/* static int public_control(void) { return 0; } */\nimport "C"\n';
    if (name === command + '/core.go') text += 'func main() {}\n';
    if (name.endsWith('.go')) for (const binding of selected.bindings.filter(row => row.bridge === name)) text += '//export ' + binding.symbol + '\nfunc ' + binding.symbol + '() {}\n';
    if (name.endsWith('.h')) text = selected.bindings.filter(row => row.header === name).map(row => 'int32_t ' + row.symbol + '(void);').join('\n') + '\n';
    if (name === command + '/auth_source_statement_v2.h') text = sourceV2Header + text;
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

const sourceV2Header = `#ifndef YNX_AUTH_SOURCE_STATEMENT_V2_H
#define YNX_AUTH_SOURCE_STATEMENT_V2_H
#define YNX_AUTH_SOURCE_STATEMENT_ABI_V1 1u
#define YNX_AUTH_SOURCE_STATEMENT_BODY_MAX_V2 65536u
#define YNX_AUTH_SOURCE_STATEMENT_MEMBER_MAX_V2 262144u
YNX_SOURCE_STATIC_ASSERT(sizeof(YNXAuthSourceStatementVerifyRequestV2)==176,"request176");
YNX_SOURCE_STATIC_ASSERT(offsetof(YNXAuthSourceStatementVerifyRequestV2,member)==16,"member16");
YNX_SOURCE_STATIC_ASSERT(offsetof(YNXAuthSourceStatementVerifyRequestV2,key_version)==128,"revision128");
YNX_SOURCE_STATIC_ASSERT(offsetof(YNXAuthSourceStatementVerifyRequestV2,enabled)==168,"enabled168");
#endif
`;
const core18Commit = 'f27e07df6dd96114135aceace20a9413bba94649';
const core18Tree = '448397a08ab167647f970934891d1336b81d15e0';
const foreignControls = command + '/source_statement_v2_foreign_controls.go';
const sourceV2HeaderPath = command + '/auth_source_statement_v2.h';
const core18Added = [sourceV2HeaderPath, command + '/source_statement_v2_bridge.go',
  command + '/source_statement_v2_core.go', foreignControls, 'internal/ynxbatch/auth_source_statement_v2.go',
  'internal/ynxbatch/resource_consent.go', 'internal/ynxresourceconsent/consent.go'];
const core18Math = new Set([...core18Added.filter(name => !name.endsWith('/resource_consent.go') && !name.endsWith('/consent.go')),
  command + '/registered_n1_verify_core.go']);
const publicRecord = (path, bytes, sha256) => ({path: '/PUBLIC/in-memory/' + path, bytes, sha256});

// This is the raw, numeric-v1 Core18 H shape, encoded locally. In particular it
// claims only a base plus frozen deltas, never a candidate Git commit. No test
// loads a supply, source, golden vector, or go-list output from an owner path.
function core18Fixture() {
  const f = fixture('core18/48');
  const rawPin = row => {
    const {gitBlob, ...rest} = row;
    const changed = row.path === command + '/registered_n1_verify_core.go';
    const previous = {bytes: 4188, gitBlob: 'c44f5850ab7b7afab142783c77dca522d55456c0',
      sha256: '4238f3ec2e1e231635bf82863941ef04e4d23f52d2a936db567c5dc0814cb3fc', mode: '100644'};
    const baseGit = core18Math.has(row.path) ? (changed ? previous : null) : {bytes: row.bytes, sha256: row.sha256, gitBlob};
    return {...rest, candidateGitBlob: gitBlob, candidateCommitClaimed: false,
      sourceOrigin: core18Math.has(row.path) ? 'FROZEN_CORE_MATH_DELTA' : 'BASE_GIT_OBJECT', baseGit};
  };
  const sources = f.core.sources.map(rawPin), byPath = new Map(sources.map(row => [row.path, row]));
  const headers = byPath.get(sourceV2HeaderPath);
  const raw = {version: 1, state: 'CORE18_PUBLIC_SOURCE_CARRIER_BASE_PLUS_FROZEN_DELTA_NO_ARCHIVE',
    sourceIdentity: {baseCommit: '06c787b2545364875b6f4e3668a6dadb084ea01b', baseTree: 'c5355ef1c0a22c7ed979901b937b532f37478cf2',
      candidateCommit: null, candidateTreeClaimed: false,
      combinedIntegrationPatch: publicRecord('core18-combined-integration.patch', 34500, '96a0078b16f6c4b95578f21fcf4fc828b5e7169a723016dd160812bf8d2198bd'),
      frozenMathH: publicRecord('math-H.json', 11628, 'fcb54edb382140c43795ae171a50de6bb6107722e65571db3e94cf772565f4c5'),
      fullSourceRoot: '/PUBLIC/in-memory/source',
      mathPatch: publicRecord('source-v2-portable-core.patch', 31445, '95a2209c64fb5b62221feabe498b25db406395873dc9080913131e34ff54cb65'),
      normalCIDelta: publicRecord('source-v2-normal-ci.patch', 3055, '03811d635c41d4d45c8c26adfc0e092d1c275c70b4440f548628d5bb562b7ede')},
    sources, exports: f.selected.bindings.map(row => ({symbol: row.symbol, machOSymbol: '_' + row.symbol,
      ...Object.fromEntries(['bridge', 'header', 'implementation'].map(kind => [kind, structuredClone(byPath.get(row[kind]))]))})),
    cgoTranslationUnits: [...f.selected.cgoTranslationUnits],
    delivery: {sources: '/PUBLIC/in-memory/carrier/src', sourceLeaves: 83, productionGo: 65, handHeaders: 16, includeGuards: 16,
      coreExports: 18, cgoExportBridgeUnits: 16, cgoTranslationUnits: 17, publicStaticCControlUnits: 1},
    moduleContext: {originalReplace: 'github.com/cometbft/cometbft => ./third_party/cometbft', stubModule: false,
      moduleChangedHere: false, changedSinceCore17: [], forkTree: '54e88e6aba735eaceeb2d00bb40731248c673bd7',
      descriptors: f.core.moduleContext.descriptors.map(row => ({...rawPin(row),
        carrierPath: '/PUBLIC/in-memory/carrier/module-context/' + row.repositoryPath}))},
    predecessor: {addedSources: [...core18Added], changedPriorSources: [command + '/registered_n1_verify_core.go'],
      removedSources: [], old15HeadersByteIdentical: true, old17ExportsRetained: true,
      old75ByteIdentical: true, old76AllRetained: true, archiveEvidenceInherited: false},
    singleRuntimeComposition: {doNotLinkTwoGoArchives: true, expectedCombinedCount: 48,
      newCoreSourceExportsObserved: 18, noNewMain: true, originalCommandPackage: command,
      unchangedLINKCountProvidedByRoot: 22, unchangedProductCountProvidedByRoot: 8,
      combinedCountActuallyMeasuredHere: false, old47ArchiveMayRepresentNewEntry: false,
      keepOriginalMain: {path: command + '/core.go', line: 1}},
    sourceV2GoldenNotSupplied: true,
    sourceV2Integration: {version: 1, domain: 'YNX/AUTH/SOURCE-ORIGINAL/V2', symbol: 'YNXAuthSourceStatementVerifyV2',
      bodyMaximum: 65536, memberMaximum: 262144, messageMaximum: 66267, requestBytes64Bit: 176, resultBytes64Bit: 32,
      fields8: ['domain UTF8', 'role UTF8', 'independently expected frame UTF8', 'network lowercase hex64 TEXT',
        'owner lowercase0x42 TEXT', 'keyVersion u64 decimal TEXT', 'issuedHeight u64 decimal TEXT', 'canonical bodyOriginal UTF8'],
      fixedPurposeByRole: {'1': 'AUTH-SOURCE-ENROLLMENT', '2': 'AUTH-SOURCE-PROFILE', '3': 'AUTH-SOURCE-CURRENT'},
      header: {path: sourceV2HeaderPath, bytes: headers.bytes, sha256: headers.sha256}},
    actualDependencyClosure: {CGO_ENABLED: 1, GOOS: 'darwin', GOARCH: 'arm64', compileOrTest: false,
      command: ['go', 'list', '-deps', '-json', './' + command, './internal/ynxresourceconsent'],
      coreCommandRecursivePackages: 4, unionPackages: 5, resourceConsentAlreadyImportedByCoreCommand: false,
      resourceConsentSeparateExplicitRoot: true, packages: Object.fromEntries(f.selected.packagePaths.map(name => {
        const paths = f.selected.sourcePaths.filter(path => path.startsWith(name + '/') && path.endsWith('.go'));
        return [name, {GoFiles: paths.filter(path => !f.selected.cgoTranslationUnits.includes(path)),
          CgoFiles: paths.filter(path => f.selected.cgoTranslationUnits.includes(path)), imports: []}];
      }))},
    effects: {GoCompiled: false, CryptoExecuted: false, archiveBuiltOrLinked: false, sourceAdmission: false,
      accountAuthorized: false, publicActivation: false, sourceCopiedOnly: true}};
  return {...f, core: raw};
}

function core19Fixture(id = 'core19/49') {
  const f = fixture(id), selected = f.selected;
  const raw = {schema: 'YNX-CORE19-EXACT-GIT-SOURCE/v1', commit: selected.commit, tree: selected.tree,
    sourceReadMethod: 'PUBLIC in-memory pins, not real Git supply', productionLeafCount: 88,
    originalCometForkTree: selected.preparedComposition?.forkTree ?? '54e88e6aba735eaceeb2d00bb40731248c673bd7', moduleContextIsDescriptorOnly: true,
    normalOriginalModuleAndForkRequired: true, goModReplaceNotRemovedOrStubbed: true, archiveIncluded: false, freshCIQualified: false,
    authority: {Root: false, Source: false},
    sources: f.core.sources.map(row => ({...row, repositoryPath: row.path, path: '/PUBLIC/core19/src/' + row.path, gitMode: '100644'})),
    moduleContext: f.core.moduleContext.descriptors.map(row => ({...row, path: '/PUBLIC/core19/module-context/' + row.repositoryPath, gitMode: '100644'})),
    productionClosure: {rootPackage: command, singleExplicitRoot: true, resourceConsentActuallyImported: true, blankImport: false,
      packageCount: 5, goFileCount: 69, headerCount: 17, productionLeafCount: 88, cgoTranslationUnitCount: 19, exportCount: 19, guardCount: 17,
      currentExactGitImportsIndependentlyRewalked: true, allPackageProductionFilesCheckedAgainstExactTree: true,
      freshGoListRun: false, freshGoTestRun: false, cgoTranslationUnits: [...selected.cgoTranslationUnits],
      exports: selected.bindings.map(row => ({symbol: row.symbol, source: row.bridge})),
      packages: Object.fromEntries(selected.packagePaths.map(name => [name, {importPath: 'github.com/JiahaoAlbus/YNX-Chain/' + name,
        productionGoFiles: selected.sourcePaths.filter(p => p.startsWith(name + '/') && p.endsWith('.go')),
        imports: name === command ? ['github.com/JiahaoAlbus/YNX-Chain/internal/ynxresourceconsent'] : [],
        actualPriorGoListSelectionUnchanged: true, exactGitTreeAllProductionGoFilesMatch: true}]))}};
  if (selected.preparedComposition) for (const expected of selected.preparedComposition.modules) {
    Object.assign(raw.moduleContext.find(row => row.repositoryPath === expected.repositoryPath), expected);
    const source = raw.sources.find(row => row.repositoryPath === expected.repositoryPath);
    if (source) Object.assign(source, {bytes: expected.bytes, sha256: expected.sha256, gitBlob: expected.gitBlob});
  }
  return {...f, core: raw};
}

function replaceRaw(f, name, text) {
  const bytes = Buffer.from(text), replacement = pin(name, bytes);
  f.sourceBytes.set(name, bytes);
  const update = row => {
    row.bytes = replacement.bytes; row.sha256 = replacement.sha256; row.candidateGitBlob = replacement.gitBlob;
    if (row.sourceOrigin === 'BASE_GIT_OBJECT') row.baseGit = {bytes: row.bytes, sha256: row.sha256, gitBlob: row.candidateGitBlob};
  };
  update(f.core.sources.find(row => row.path === name));
  for (const row of f.core.exports) for (const kind of ['bridge', 'header', 'implementation']) if (row[kind].path === name) update(row[kind]);
  if (name === sourceV2HeaderPath) Object.assign(f.core.sourceV2Integration.header, {bytes: bytes.length, sha256: replacement.sha256});
}

const modulePath = 'github.com/JiahaoAlbus/YNX-Chain/';
function dependencyRecords(selected) {
  return [...selected.normalPackagePaths.map(name => {
    const sources = selected.sourcePaths.filter(path => path.startsWith(name + '/') && path.endsWith('.go'));
    const imported = name === command ? ['internal/ynxauth', 'internal/ynxbatch', 'internal/accountaddress',
      ...(selected.resourceBackendImported ? ['internal/ynxresourceconsent'] : [])] :
      name === 'internal/ynxauth' || name === 'internal/ynxresourceconsent' ? ['internal/ynxbatch', 'internal/accountaddress'] : [];
    return {ImportPath: modulePath + name, Name: name === command ? 'main' : name.split('/').at(-1), DepOnly: name !== command,
      GoFiles: [...sources.filter(path => !selected.cgoTranslationUnits.includes(path)).map(path => path.split('/').at(-1)),
        ...(name === command ? ['link_transport_import.go'] : [])],
      CgoFiles: sources.filter(path => selected.cgoTranslationUnits.includes(path)).map(path => path.split('/').at(-1)),
      Imports: [...(name === command ? ['C', modulePath + 'internal/securelink'] : []), ...imported.map(path => modulePath + path)]};
  }), {ImportPath: modulePath + 'internal/securelink', Name: 'securelink', DepOnly: true, Imports: ['C']}];
}
const jsonSequence = records => records.map(row => JSON.stringify(row, null, 2)).join('\n\n');

// Independent public E8 encoder: field count and byte lengths are BE32, and the
// original UTF8 body is copied exactly. Member bytes are opaque public fixtures.
function publicE8(fields, count = fields.length) {
  const u32 = value => {const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes;};
  return Buffer.concat([u32(count), ...fields.flatMap(value => {
    const bytes = Buffer.from(value, 'utf8'); return [u32(bytes.length), bytes];
  })]);
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function updateGoldenVector(vector, fields) {
  const binding = vector.binding;
  const message = publicE8(fields ?? ['YNX/AUTH/SOURCE-ORIGINAL/V2', vector.role, vector.frame,
    binding.networkId, binding.owner, binding.keyVersion, binding.executionHeight, vector.bodyOriginal]);
  Object.assign(vector, {messageBase64url: message.toString('base64url'), messageBytes: message.length, messageSHA256: digest(message)});
}
function goldenFixture() {
  return {PUBLIC_ONLY: true, vectors: ['enrollment', 'profile', 'current'].map((role, i) => {
    const member = Buffer.from('PUBLIC opaque member for ' + role);
    const vector = {role, frame: 'PUBLIC independently admitted frame/' + role,
      binding: {networkId: 'ab'.repeat(32), owner: '0x' + '12'.repeat(20), keyVersion: '1', executionHeight: String(i + 1)},
      bodyOriginal: '{"public":true,"role":"' + role + '"}',
      memberBase64url: member.toString('base64url'), memberBytes: member.length, memberSHA256: digest(member)};
    updateGoldenVector(vector); return vector;
  })};
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

test('post-symbol gate requires every exact approved Core profile and preserves LINK22/Product8 counts', () => {
  for (const selected of legacyProfiles) {
    const good = () => ({coreExports: [...selected.symbols], linkExports: Array(22), productExports: Array(8), symbols: Array(selected.totalExports)});
    verifyCombinedSupplyResult(selected, good());
    for (const mutation of [r => r.coreExports.pop(), r => {r.coreExports[0] = 'YNXUnlistedSignV1';}, r => r.linkExports.pop(), r => r.productExports.pop(), r => r.symbols.pop()]) {
      const result = good(); mutation(result); assert.throws(() => verifyCombinedSupplyResult(selected, result), /strong Core export|complete Core/);
    }
  }
  assert.throws(() => verifyCombinedSupplyResult({...CORE_SUPPLY_PROFILES[1]}, {}), /approved named profile/);
});

test('Core18 raw base-plus-delta supply selects its fixed 83-leaf, 18-export profile', () => {
  const f = core18Fixture(), old = fixture();
  const result = verify(f);
  assert.equal(f.selected.id, 'core18/48');
  assert.equal(f.selected.commit, core18Commit); assert.equal(f.selected.tree, core18Tree);
  assert.deepEqual(f.selected.sourcePaths.filter(name => !old.selected.sourcePaths.includes(name)), [...core18Added].sort());
  assert.deepEqual(f.selected.symbols.filter(name => !old.selected.symbols.includes(name)), ['YNXAuthSourceStatementVerifyV2']);
  for (const [key, value] of Object.entries({profile: 'core18/48', coreExports: 18, totalExports: 48,
    sourceLeaves: 83, handHeaders: 16, descriptors: 4})) assert.equal(result[key], value);
  assert.equal(f.selected.bridges.length, 16); assert.equal(f.selected.cgoTranslationUnits.length, 17);
  assert.deepEqual(f.selected.nonExportCgoTranslationUnits, [foreignControls]);
});

test('normalization preserves the raw H identity and candidate pins without mutating them', () => {
  for (const id of ['core15/45', 'core17/47']) {
    const legacy = fixture(id); assert.equal(normalizeCoreSupply(legacy.core).supply, legacy.core);
  }
  const f = core18Fixture(), before = structuredClone(f.core);
  const {supply, provenance} = normalizeCoreSupply(f.core);
  assert.deepEqual(f.core, before); assert.notEqual(supply, f.core);
  assert.equal(supply.source.commit, core18Commit); assert.equal(supply.source.tree, core18Tree);
  assert.equal(provenance.rawSchemaVersion, 1); assert.equal(provenance.derivedViewOnly, true);
  assert.equal(provenance.actualCommit, core18Commit); assert.equal(provenance.actualTree, core18Tree);
  assert.equal(provenance.candidateCommitClaimed, false);
  assert.deepEqual(provenance.rawSourceIdentity, before.sourceIdentity);
  assert.notEqual(provenance.rawSourceIdentity, f.core.sourceIdentity);
  assert.deepEqual(provenance.sourceRowProvenance, before.sources.map(({path, sourceOrigin, candidateGitBlob, candidateCommitClaimed, baseGit}) =>
    ({path, sourceOrigin, candidateGitBlob, candidateCommitClaimed, baseGit})));
  for (const row of supply.sources) {
    const raw = before.sources.find(source => source.path === row.path);
    assert.equal(row.gitBlob, raw.candidateGitBlob);
    assert.equal(raw.gitBlob, undefined);
  }
});

test('Core18 base identity, frozen patches and math-H provenance cannot drift', () => {
  for (const mutation of [
    c => {c.sourceIdentity.baseCommit = '0'.repeat(40);}, c => {c.sourceIdentity.baseTree = '0'.repeat(40);},
    c => {c.sourceIdentity.candidateCommit = core18Commit;}, c => {c.sourceIdentity.candidateTreeClaimed = true;},
    ...['combinedIntegrationPatch', 'mathPatch', 'normalCIDelta', 'frozenMathH'].flatMap(key => [
      c => {c.sourceIdentity[key].sha256 = '0'.repeat(64);}, c => {c.sourceIdentity[key].bytes++;},
    ]),
  ]) {const f = core18Fixture(); mutation(f.core); assert.throws(() => normalizeCoreSupply(f.core));}
});

test('raw H cannot claim a post-commit dialect or resubmit a derived supply as original evidence', () => {
  for (const mutation of [
    c => {c.sourceIdentity.postCommit = core18Commit;}, c => {c.sourceIdentity.actualTree = core18Tree;},
    c => {c.postCommit = {commit: core18Commit, tree: core18Tree};}, c => {c.actualCommit = core18Commit;},
    c => {c.candidateCommit = core18Commit;}, c => {c.source = {commit: core18Commit, tree: core18Tree};},
    c => {c.actualCounts = {sourceLeaves: 83};}, c => {c.productionPackageClosure = {};},
  ]) {const f = core18Fixture(); mutation(f.core); assert.throws(() => selectCoreSupplyProfile(f.core));}
  const {supply} = normalizeCoreSupply(core18Fixture().core);
  assert.throws(() => selectCoreSupplyProfile(supply));
  for (const key of ['commit', 'tree']) {
    const forged = structuredClone(supply); forged.source[key] = '0'.repeat(40);
    assert.throws(() => selectCoreSupplyProfile(forged));
  }
});

test('Core18 raw row provenance and export-reference provenance remain bound to original pins', () => {
  for (const mutation of [
    c => {c.sources[0].candidateCommitClaimed = true;},
    c => {c.sources[0].baseGit.sha256 = '0'.repeat(64);},
    c => {c.sources.find(row => row.path === sourceV2HeaderPath).baseGit = {...c.sources[0].baseGit};},
    c => {c.sources.find(row => row.path === sourceV2HeaderPath).sourceOrigin = 'BASE_GIT_OBJECT';},
    c => {c.sources.find(row => row.path === command + '/registered_n1_verify_core.go').baseGit.gitBlob = '0'.repeat(40);},
    c => {c.exports[0].bridge.candidateCommitClaimed = true;},
    c => {c.exports[0].bridge.candidateGitBlob = '0'.repeat(40);},
  ]) {const f = core18Fixture(); mutation(f.core); assert.throws(() => selectCoreSupplyProfile(f.core));}
});

test('Core18 retains the non-export static C unit and rejects same-count source and cgo substitutions', () => {
  for (const mutation of [
    c => {c.sources = c.sources.filter(row => row.path !== foreignControls);},
    c => {c.sources.find(row => row.path === foreignControls).path = command + '/unlisted_foreign_controls.go';},
    c => {c.cgoTranslationUnits = c.cgoTranslationUnits.filter(path => path !== foreignControls);},
    c => {c.cgoTranslationUnits[c.cgoTranslationUnits.indexOf(foreignControls)] = command + '/source_statement_v2_core.go';},
    c => {c.delivery.cgoTranslationUnits = 16;}, c => {c.delivery.cgoExportBridgeUnits = 17;},
    c => {c.delivery.publicStaticCControlUnits = 0;},
  ]) {const f = core18Fixture(); mutation(f.core); assert.throws(() => selectCoreSupplyProfile(f.core));}
});

test('Core18 requires import C in the exact 17 units even when a substituted unit keeps the count', () => {
  for (const name of [foreignControls, command + '/source_statement_v2_bridge.go']) {
    const f = core18Fixture(); replaceRaw(f, name, f.sourceBytes.get(name).toString().replace('import "C"\n', ''));
    assert.throws(() => verify(f), /cgo|import C|translation/);
  }
  const swapped = core18Fixture();
  replaceRaw(swapped, foreignControls, swapped.sourceBytes.get(foreignControls).toString().replace('import "C"\n', ''));
  const replacement = command + '/source_statement_v2_core.go';
  replaceRaw(swapped, replacement, swapped.sourceBytes.get(replacement) + '\nimport "C"\n');
  assert.throws(() => verify(swapped), /cgo|import C|translation/);
});

test('Core18 rejects duplicate, extra and same-count replaced symbols including exports from static controls', () => {
  for (const mutation of [
    c => c.exports.pop(), c => c.exports.push({...c.exports[0], symbol: 'YNXUnlistedVerifyV2'}),
    c => {c.exports[17] = structuredClone(c.exports[0]);}, c => {c.exports[17].symbol = 'YNXAuthSourceStatementVerifyV3';},
  ]) {const f = core18Fixture(); mutation(f.core); assert.throws(() => selectCoreSupplyProfile(f.core));}
  const f = core18Fixture();
  replaceRaw(f, foreignControls, f.sourceBytes.get(foreignControls) + '\n//export YNXUnexpectedStaticControlV1\nfunc YNXUnexpectedStaticControlV1() {}\n');
  assert.throws(() => verify(f), /actual source|export/);
});

test('Core18 Source-v2 capacity and ABI metadata are fixed independent of matching source counts', () => {
  for (const [key, bad] of [['version', 2], ['domain', 'YNX/AUTH/SOURCE-ORIGINAL/V3'], ['bodyMaximum', 65535],
    ['memberMaximum', 98304], ['messageMaximum', 65536], ['requestBytes64Bit', 168], ['resultBytes64Bit', 24],
    ['symbol', 'YNXAuthSourceStatementVerifyV3']]) {
    const f = core18Fixture(); f.core.sourceV2Integration[key] = bad;
    assert.throws(() => selectCoreSupplyProfile(f.core));
  }
  for (const mutation of [c => c.sourceV2Integration.fields8.pop(),
    c => {c.sourceV2Integration.fixedPurposeByRole['3'] = 'AUTH-SOURCE-PROFILE';}]) {
    const f = core18Fixture(); mutation(f.core); assert.throws(() => selectCoreSupplyProfile(f.core));
  }
});

test('Core18 header macros and 64-bit static assertions cannot drift behind updated pins', () => {
  for (const [original, changed] of [['ABI_V1 1u', 'ABI_V1 2u'], ['BODY_MAX_V2 65536u', 'BODY_MAX_V2 65535u'],
    ['MEMBER_MAX_V2 262144u', 'MEMBER_MAX_V2 98304u'], ['==176', '==168'], ['member)==16', 'member)==24'],
    ['key_version)==128', 'key_version)==120'], ['enabled)==168', 'enabled)==160']]) {
    const f = core18Fixture(), text = f.sourceBytes.get(sourceV2HeaderPath).toString();
    assert.ok(text.includes(original)); replaceRaw(f, sourceV2HeaderPath, text.replace(original, changed));
    assert.throws(() => verify(f), /header|ABI|capacity|layout|Source.v2/);
  }
});

test('Core18 verifies the candidate Git blob bytes rather than trusting an updated SHA alone', () => {
  const f = core18Fixture(), name = 'internal/ynxbatch/auth_source_statement_v2.go';
  f.sourceBytes.set(name, Buffer.from('package ynxbatch\n// PUBLIC changed source\n'));
  const row = f.core.sources.find(row => row.path === name), replacement = pin(name, f.sourceBytes.get(name));
  row.bytes = replacement.bytes; row.sha256 = replacement.sha256;
  assert.throws(() => verify(f), /original bytes\/hash\/Git mismatch/);
});

test('Core19 exact committed source normalizes all88 leaves while retaining source-only provenance', () => {
  const f = core19Fixture(), before = structuredClone(f.core), n = normalizeCoreSupply(f.core);
  assert.deepEqual(f.core, before);
  assert.equal(selectCoreSupplyProfile(f.core), f.selected);
  assert.deepEqual(verify(f), {profile: 'core19/49', coreExports: 19, totalExports: 49, sourceLeaves: 88, handHeaders: 17, descriptors: 4});
  assert.equal(n.provenance.rawSchema, 'YNX-CORE19-EXACT-GIT-SOURCE/v1');
  assert.equal(n.provenance.freshCommandClosureClaimedBySupplier, false);
  assert.equal(n.provenance.protectedAuthNativeFactoryQualified, false);
  assert.equal(n.supply.delivery.sourceDirectory, '/PUBLIC/core19/src');
  assert.equal(f.selected.bridges.length, 17); assert.equal(f.selected.nonExportCgoTranslationUnits.length, 2);
  assert.equal(f.selected.cgoTranslationUnits.length, 19);
  assert.throws(() => selectCoreSupplyProfile(n.supply));
});

test('Core19 rejects unknown identity, incomplete source or a relabelled supplier qualification', () => {
  for (const mutate of [
    r => {r.commit = 'f'.repeat(40);}, r => {r.tree = 'f'.repeat(40);}, r => {r.archiveIncluded = true;},
    r => {r.freshCIQualified = true;}, r => {r.moduleContextIsDescriptorOnly = false;}, r => {r.originalCometForkTree = 'f'.repeat(40);},
    r => r.sources.pop(), r => {r.sources[0].gitMode = '120000';}, r => {r.sources[0].path = '/OTHER/' + r.sources[0].repositoryPath;},
    r => {r.sources[0].gitBlob = 'bad';}, r => {r.productionClosure.freshGoListRun = true;},
    r => {r.productionClosure.blankImport = true;}, r => {r.productionClosure.resourceConsentActuallyImported = false;},
    r => {r.productionClosure.packageCount = 4;}, r => {r.productionClosure.cgoTranslationUnits.pop();},
    r => {r.productionClosure.exports[0].source = command + '/unlisted.go';}, r => r.moduleContext.pop(),
    r => {r.productionClosure.packages[command].imports = [];},
  ]) {const f = core19Fixture(); mutate(f.core); assert.throws(() => selectCoreSupplyProfile(f.core));}
});

test('Core19 actual byte gate counts both static controls and rejects changed original bridge bytes', () => {
  const f = core19Fixture(), name = command + '/network_resource_consent_foreign_controls.go';
  f.sourceBytes.set(name, Buffer.from('package main\n')); assert.throws(() => verify(f), /original bytes\/hash\/Git mismatch/);
});

test('Core19 requires real resource backend reachability without qualifying protected Native authority', () => {
  const f = core19Fixture(), rows = dependencyRecords(f.selected);
  const result = verifyCoreCommandDependencyClosure(f.selected, jsonSequence(rows));
  assert.equal(result.resourceConsentAlreadyImportedByCoreCommand, true);
  assert.equal(result.resourceConsentPackageSuppliedSeparately, false);
  assert.equal(result.coreCommandReachablePackages.length, 5);
  assert.equal(result.normalResourceBinder, 'FIXED_CORE_CABI_REACHABLE_PROTECTED_AUTH_NATIVE_FACTORY_NOT_QUALIFIED');
  rows.find(row => row.Name === 'main').Imports = rows.find(row => row.Name === 'main').Imports.filter(p => !p.endsWith('/ynxresourceconsent'));
  assert.throws(() => verifyCoreCommandDependencyClosure(f.selected, jsonSequence(rows)));
});

test('legacy Shop uses the original Core19 module and single command', () => {
  const {selected} = core19Fixture(), rows = dependencyRecords(selected);
  const main = rows.find(row => row.Name === 'main');
  main.GoFiles.push(shopImportFile);
  main.Imports.push(shopImportPath);
  const link = rows.find(row => row.ImportPath === modulePath + 'internal/securelink');
  link.CgoLDFLAGS = ['-lbsm'];
  const shop = {ImportPath: shopImportPath, Name: 'productreadsource', DepOnly: true,
    Module: {Path: modulePath.slice(0, -1), Main: true}, Imports: [modulePath + 'internal/securelink', 'C'],
    GoFiles: ['authority.go','capture.go','contract.go','physical.go','runtime.go','sdk_input.go','sdk_output.go',
      'shop_client_transport_original.go','shop_private_client.go','shop_source_constraints.go'],
    CgoFiles: ['shop_private_client_cgo.go','shop_proof_carrier_cgo.go','shop_source_constraints_cgo.go']};
  rows.push(shop);
  const verifyClosure = () => verifyCoreCommandDependencyClosure(selected, jsonSequence(rows), shopRole);
  assert.deepEqual(verifyClosure().commandRoots, [main.ImportPath]);
  assert.equal(verifyClosure().shopPackage, shopImportPath);
  assert.throws(() => verifyCoreCommandDependencyClosure(selected, jsonSequence(rows)), /exact original Shop archive role/);
  link.CgoLDFLAGS = [];
  assert.throws(verifyClosure, /Darwin LINK85fd peer library/);
  link.CgoLDFLAGS = ['-lbsm'];
  shop.Module.Replace = {Dir: '/PUBLIC/another-tree'};
  assert.throws(verifyClosure, /sole module/);
  delete shop.Module.Replace;
  shop.CgoFiles.pop();
  assert.throws(verifyClosure, /exact Auth Shop Go13/);
});

const publicShopGoRoot = '/PUBLIC/golang.org/toolchain@v0.0.1-go1.26.11.darwin-arm64';
const publicShopGo = publicShopGoRoot + '/bin/go';

test('Shop Go toolchain selects the fixed patch above the unchanged e120 source minimum', () => {
  const {core: raw} = core19Fixture();
  const {supply: core} = normalizeCoreSupply(raw);
  const selected = selectCoreSupplyProfile(raw);
  const toolchain = selectCombinedGoToolchain(selected, shopRole, publicShopGo);
  assert.equal(core.source.go, '1.26.10');
  assert.equal(selected.commit, 'e12036079d28adef2559733739a4743e258ba4e5');
  assert.equal(toolchain.profile, 'shop-single62-go1.26.11');
  assert.equal(toolchain.version, 'go1.26.11');
  assert.equal(toolchain.command, publicShopGo);
  assert.equal(toolchain.root, publicShopGoRoot);
  assert.deepEqual(toolchain.executable, {bytes: 14602880,
    sha256: '20e07ffb4f08faaf125e413db024b6e988d3ec2799dcb3568a720d14be0ad133'});
  assert.deepEqual(toolchain.versionFile, {bytes: 36,
    sha256: '489cd0f7bd5ac954d65ee65cb20f23ddf906a4677b76ed4e9f5f204e35e0d7ba'});
});

test('Shop Go toolchain is required only for the exact original Shop role and uses an absolute executable', () => {
  const {selected} = core19Fixture();
  for (const executable of [undefined, 'go', '/PUBLIC/../PUBLIC/bin/go', '/PUBLIC/bin/go/', '/PUBLIC/go']) {
    assert.throws(() => selectCombinedGoToolchain(selected, shopRole, executable), /absolute canonical Shop bin\/go/);
  }
  assert.throws(() => selectCombinedGoToolchain(selected, 'PUBLIC unknown role', publicShopGo), /requires original Core19 e120/);
  for (const profile of CORE_SUPPLY_PROFILES) {
    assert.throws(() => selectCombinedGoToolchain(profile, undefined, publicShopGo), /only accepted for Shop/);
    if (profile !== selected) assert.throws(() => selectCombinedGoToolchain(profile, shopRole, publicShopGo), /requires original Core19 e120/);
  }
});

test('Shop Go toolchain probe requires its exact version, native architecture and tool root', () => {
  const {selected} = core19Fixture();
  const toolchain = selectCombinedGoToolchain(selected, shopRole, publicShopGo);
  const observed = {GOVERSION: 'go1.26.11', GOOS: 'darwin', GOARCH: 'arm64', GOROOT: publicShopGoRoot,
    GOTOOLDIR: publicShopGoRoot + '/pkg/tool/darwin_arm64', GOTOOLCHAIN: 'local'};
  assert.doesNotThrow(() => verifyCombinedGoEnvironment(toolchain, observed, 'arm64'));
  for (const [key, value] of Object.entries({GOVERSION: 'go1.26.10', GOOS: 'linux', GOARCH: 'amd64',
    GOROOT: '/PUBLIC/other', GOTOOLDIR: '/PUBLIC/other/pkg/tool/darwin_arm64', GOTOOLCHAIN: 'auto'})) {
    assert.throws(() => verifyCombinedGoEnvironment(toolchain, {...observed, [key]: value}, 'arm64'), /Go/);
  }
  assert.throws(() => verifyCombinedGoEnvironment(toolchain, {...observed, GOARCH: 'amd64'}, 'amd64'), /Darwin arm64/);
});

test('Shop Go toolchain successor leaves every non-Shop profile at Go 1.26.10', () => {
  const observed = {GOVERSION: 'go1.26.10', GOOS: 'darwin', GOARCH: 'arm64'};
  for (const profile of CORE_SUPPLY_PROFILES) {
    const toolchain = selectCombinedGoToolchain(profile);
    assert.deepEqual(toolchain, {command: 'go', version: 'go1.26.10'});
    assert.doesNotThrow(() => verifyCombinedGoEnvironment(toolchain, observed, 'arm64'));
    assert.throws(() => verifyCombinedGoEnvironment(toolchain, {...observed, GOVERSION: 'go1.26.11'}, 'arm64'), /go1.26.10/);
  }
});

test('legacy Shop adds thirteen strong symbols and requires its original Native witnesses', () => {
  const {selected} = core19Fixture();
  const symbols = [...selected.symbols, ...linkRequiredSymbols, ...productTransportRequiredSymbols, ...shopRequiredSymbols];
  const result = {shopRole, coreExports: selected.symbols, linkExports: linkRequiredSymbols,
    productExports: productTransportRequiredSymbols, shopExports: shopRequiredSymbols, symbols: symbols.map(symbol => ({symbol})),
    shopNativeObservedGoReferences: shopNativeRequiredSymbols,
    shopArchiveBorrowUndefinedReferences: shopBorrowSymbols.map(symbol => ({symbol, undefinedReferences: 1}))};
  assert.equal(symbols.length, 62);
  verifyCombinedSupplyResult(selected, result, shopRole);
  assert.throws(() => verifyCombinedSupplyResult(selected, result), /strong ABI/);
  assert.throws(() => verifyCombinedSupplyResult(selected, {...result, shopNativeObservedGoReferences: []}, shopRole), /Native11/);
  result.shopArchiveBorrowUndefinedReferences[0].undefinedReferences = 0;
  assert.throws(() => verifyCombinedSupplyResult(selected, result, shopRole), /reference counts/);
});

test('go-list single command traverses its real LINK edge and leaves the separate resource binder absent', () => {
  const f = core18Fixture(), records = dependencyRecords(f.selected);
  // A misleading union/Deps claim is not an Imports edge from main.
  records.find(row => row.Name === 'main').Deps = [...records.filter(row => row.Name !== 'main').map(row => row.ImportPath), modulePath + 'internal/ynxresourceconsent'];
  const result = verifyCoreCommandDependencyClosure(f.selected, jsonSequence(records));
  assert.equal(result.resourceConsentAlreadyImportedByCoreCommand, false);
  assert.equal(result.resourceConsentPackageSuppliedSeparately, true);
  assert.equal(result.separateResourceRootInOutput, false);
  assert.ok(result.reachableLocalPackages.includes(modulePath + 'internal/securelink'));
  assert.equal(result.normalResourceBinder, 'NOT_SUPPLIED');
  assert.deepEqual([...result.coreCommandReachablePackages].sort(),
    [command, 'internal/accountaddress', 'internal/ynxauth', 'internal/ynxbatch'].sort());
});

test('go-list requires the original direct LINK edge and its traversable package', () => {
  for (const selected of legacyProfiles) for (const mutate of [
    rows => {rows.find(row => row.Name === 'main').Imports = rows.find(row => row.Name === 'main').Imports.filter(name => name !== modulePath + 'internal/securelink');},
    rows => rows.splice(rows.findIndex(row => row.ImportPath === modulePath + 'internal/securelink'), 1),
    rows => {
      rows.find(row => row.Name === 'main').Imports = rows.find(row => row.Name === 'main').Imports.filter(name => name !== modulePath + 'internal/securelink');
      rows.find(row => row.ImportPath === modulePath + 'internal/ynxauth').Imports.push(modulePath + 'internal/securelink');
    },
  ]) {const records = dependencyRecords(selected); mutate(records); assert.throws(() => verifyCoreCommandDependencyClosure(selected, jsonSequence(records)));}
});

test('go-list rejects multiple roots and dependency rows without true DepOnly', () => {
  for (const selected of legacyProfiles) for (const mutate of [
    rows => {rows.find(row => row.ImportPath === modulePath + 'internal/ynxauth').DepOnly = false;},
    rows => {delete rows.find(row => row.ImportPath === modulePath + 'internal/securelink').DepOnly;},
    rows => rows.push({ImportPath: modulePath + 'internal/ynxresourceconsent', Name: 'ynxresourceconsent', DepOnly: false, Imports: []}),
    rows => rows.push({ImportPath: 'PUBLIC/unrelated-command', Name: 'main', DepOnly: false, Imports: []}),
  ]) {const records = dependencyRecords(selected); mutate(records); assert.throws(() => verifyCoreCommandDependencyClosure(selected, jsonSequence(records)));}
});

test('go-list union roots cannot manufacture a normal resource binder or omit a real main dependency', () => {
  const f = core18Fixture();
  for (const mutate of [
    rows => rows.find(row => row.Name === 'main').Imports.push(modulePath + 'internal/ynxresourceconsent'),
    rows => {rows.find(row => row.Name === 'main').Imports = [modulePath + 'internal/accountaddress'];},
    rows => rows.splice(rows.findIndex(row => row.ImportPath === modulePath + 'internal/ynxauth'), 1),
    rows => rows.push(structuredClone(rows[0])),
  ]) {const rows = dependencyRecords(f.selected); mutate(rows); assert.throws(() => verifyCoreCommandDependencyClosure(f.selected, jsonSequence(rows)));}
});

test('go-list command names, original composition file and exact source/cgo inventories remain fixed', () => {
  const f = core18Fixture();
  for (const mutate of [
    main => {main.Name = 'replacement';}, main => {main.GoFiles = main.GoFiles.filter(path => path !== 'link_transport_import.go');},
    main => main.CgoFiles.pop(), main => {main.CgoFiles[0] = 'unlisted_bridge.go';},
    main => main.GoFiles.push('unlisted_core.go'),
  ]) {const rows = dependencyRecords(f.selected); mutate(rows.find(row => row.Name === 'main')); assert.throws(() => verifyCoreCommandDependencyClosure(f.selected, jsonSequence(rows)));}
  assert.throws(() => verifyCoreCommandDependencyClosure(f.selected, '{"ImportPath":'));
});

test('Source-v2 golden diagnosis reconstructs all three PUBLIC E8 messages without a crypto claim', () => {
  const golden = goldenFixture(), before = structuredClone(golden);
  const result = diagnoseSourceV2Golden(golden);
  assert.deepEqual(golden, before);
  assert.equal(result.fullCompatibility, false); assert.equal(result.cryptographicVerification, false);
  assert.equal(result.scope, 'PUBLIC_BYTE_FRAMING_AND_CAPACITY_ONLY');
  assert.equal(result.allExpectedBytesMatch, true); assert.equal(result.vectors.length, 3);
});

test('Source-v2 public diagnostics require exactly one original vector for each textual role', () => {
  for (const mutate of [
    g => {g.PUBLIC_ONLY = false;}, g => {delete g.PUBLIC_ONLY;}, g => g.vectors.pop(),
    g => g.vectors.push(structuredClone(g.vectors[0])),
    g => {g.vectors[2].role = 'profile'; updateGoldenVector(g.vectors[2]);},
    g => {g.vectors[0].role = '1'; updateGoldenVector(g.vectors[0]);},
  ]) {const golden = goldenFixture(); mutate(golden); assert.throws(() => diagnoseSourceV2Golden(golden));}
});

test('Source-v2 E8 field count and field boundaries are checked after hashes are recomputed', () => {
  for (const mutate of [
    bytes => bytes.writeUInt32BE(7, 0), bytes => bytes.writeUInt32BE(9, 0),
    bytes => bytes.writeUInt32BE(bytes.readUInt32BE(4) + 1, 4),
  ]) {
    const golden = goldenFixture(), vector = golden.vectors[0], bytes = Buffer.from(vector.messageBase64url, 'base64url');
    mutate(bytes); vector.messageBase64url = bytes.toString('base64url'); vector.messageSHA256 = digest(bytes);
    assert.throws(() => diagnoseSourceV2Golden(golden));
  }
  const golden = goldenFixture(), vector = golden.vectors[0];
  updateGoldenVector(vector, ['YNX/AUTH/SOURCE-ORIGINAL/V2', vector.role, vector.frame, vector.binding.networkId,
    vector.binding.owner, vector.binding.keyVersion, vector.binding.executionHeight]);
  assert.throws(() => diagnoseSourceV2Golden(golden));
});

test('Source-v2 framing binds exact domain, original body, independent frame and text numeric fields', () => {
  for (const mutate of [
    v => {v.bodyOriginal += ' ';}, v => {v.frame += '/different';},
    v => {v.binding.executionHeight = '99';}, v => {v.binding.keyVersion = '2';},
    v => {const bytes = Buffer.from(v.messageBase64url, 'base64url'); bytes[8] ^= 1;
      v.messageBase64url = bytes.toString('base64url'); v.messageSHA256 = digest(bytes);},
  ]) {const golden = goldenFixture(); mutate(golden.vectors[0]); assert.throws(() => diagnoseSourceV2Golden(golden));}
});

test('Source-v2 binding text rejects noncanonical network, owner and uint64 spelling', () => {
  for (const mutate of [
    v => {v.binding.networkId = 'AB'.repeat(32);}, v => {v.binding.networkId = 'ab'.repeat(31);},
    v => {v.binding.owner = '0x' + 'AB'.repeat(20);}, v => {v.binding.owner = '0X' + '12'.repeat(20);},
    ...['0', '01', '-1', '1.0', '18446744073709551616'].map(value => v => {v.binding.keyVersion = value;}),
    ...['01', '-1', '18446744073709551616'].map(value => v => {v.binding.executionHeight = value;}),
    v => {v.frame = '';}, v => {v.frame = 'PUBLIC\0frame';},
  ]) {const golden = goldenFixture(); mutate(golden.vectors[0]); updateGoldenVector(golden.vectors[0]); assert.throws(() => diagnoseSourceV2Golden(golden));}
});

test('Source-v2 base64url, declared byte counts and SHA metadata must agree for message and opaque member', () => {
  for (const mutate of [
    v => {v.messageBytes++;}, v => {v.messageSHA256 = '0'.repeat(64);},
    v => {v.memberBytes++;}, v => {v.memberSHA256 = '0'.repeat(64);},
    v => {v.messageBase64url += '=';}, v => {v.memberBase64url += '!';},
  ]) {const golden = goldenFixture(); mutate(golden.vectors[0]); assert.throws(() => diagnoseSourceV2Golden(golden));}
});

test('Source-v2 accepts the exact public byte capacities and rejects their first overflowing bytes', () => {
  const golden = goldenFixture(), vector = golden.vectors[0];
  vector.frame = 'f'.repeat(512); vector.bodyOriginal = '"' + 'b'.repeat(65534) + '"';
  vector.binding.keyVersion = '18446744073709551615'; vector.binding.executionHeight = '18446744073709551615';
  const member = Buffer.alloc(262144, 0x50);
  Object.assign(vector, {memberBase64url: member.toString('base64url'), memberBytes: member.length, memberSHA256: digest(member)});
  updateGoldenVector(vector); assert.equal(vector.messageBytes, 66267);
  assert.equal(diagnoseSourceV2Golden(golden).allExpectedBytesMatch, true);
  for (const mutate of [
    v => {v.frame += 'f'; updateGoldenVector(v);},
    v => {v.bodyOriginal = '"' + 'b'.repeat(65535) + '"'; updateGoldenVector(v);},
    v => {const bytes = Buffer.alloc(262145, 0x50); Object.assign(v,
      {memberBase64url: bytes.toString('base64url'), memberBytes: bytes.length, memberSHA256: digest(bytes)});},
  ]) {const overflowing = structuredClone(golden); mutate(overflowing.vectors[0]); assert.throws(() => diagnoseSourceV2Golden(overflowing));}
});


// New controls are entirely self-contained metadata. Invented public content
// pins below exercise structure; actual supplier SHA/Git bytes are a separate
// one-time intake and are never claimed by these in-memory fixtures.
function core19C2Fixture() {
  const f = core19Fixture(CORE19_C2_BINDING.id), b = CORE19_C2_BINDING;
  const samplePin = {bytes: 1, sha256: '1'.repeat(64), gitBlob: '2'.repeat(40)};
  const linkPaths = [...Array.from({length: 76}, (_, i) => 'internal/securelink/public-fixture-' + i + '.go'),
    'cmd/ynx-secure-link-caller/private_client_v1.h', 'cmd/ynx-secure-link-caller/private_client_startup_v1.h'];
  const normalized = normalizeCoreSupply(f.core).supply;
  const rows = new Map([...normalized.sources.map(row => [row.path, row]),
    ...normalized.moduleContext.descriptors.map(row => [row.repositoryPath, row])]);
  const composition = {schema: 'YNX-SINGLE49-FINITE7-SOURCE-COMPOSITION/v1', sourceOnly: true,
    coreCommit: b.commit, coreTree: b.tree, linkCommit: b.linkCommit, linkTree: b.linkTree,
    coreSource: {...b.inputs.source}, fullOriginalFork: {...b.inputs.fork}, normalProducerSourceCount: 169,
    normalProducerSources: [...[...rows].map(([repositoryPath, row]) => ({...row, repositoryPath, owner: 'Core', commit: b.commit})),
      ...linkPaths.map(repositoryPath => ({...samplePin, repositoryPath, owner: 'LINK', commit: b.linkCommit})),
      {...b.template, owner: 'LINK original composition template', commit: b.linkCommit}],
    generatedImportIsOriginalTemplate: true, GoExportsIdenticalToOld49Source: true, newArchiveBuilt: false,
    neutralCSymbolsAreNotNewGoExports: true, expectedGoABI: {Core: 19, LINK: 22, Product: 8, total: 49, runtime: 1},
    neutralCOldDeclarations: Object.fromEntries(b.neutralCSymbols.slice(0, 8).map(name => [name, 'PUBLIC declaration'])),
    neutralCNewDeclarations: Object.fromEntries(b.neutralCSymbols.slice(8).map(name => [name, 'PUBLIC declaration']))};
  const originalBuildInputPins = {AuthBuildHeaderInputs: {...b.inputs.authHeaders}, NativeOriginalUndefined: {...b.inputs.nativeUndefined}};
  composition.originalBuildInputs = structuredClone(originalBuildInputPins);
  const supplier = {schema: 'YNX-SINGLE49-FINITE7-NORMAL-PRODUCER-INPUTS/v1', sourceReady: true,
    archiveReady: false, requestedSuccessorCount: 1, oldArchivesAndImagesImmutable: true, originalBuildInputPins,
    normalArchiveProducer: {currentlyRequiredOwnerCODE: {requiredCoreCommit: b.commit, requiredCoreTree: b.tree,
      requiredForkTree: b.forkTree, requiredLINKCommit: b.linkCommit, requiredLINKTree: b.linkTree, requiredRawSource: {...b.inputs.source}}}};
  const files = [...b.modules.filter(row => row.repositoryPath.startsWith('third_party/')).map(row => ({...row, gitMode: '100644'})),
    ...Array.from({length: 1454}, (_, i) => ({...samplePin, repositoryPath: 'third_party/cometbft/public-fixture-' + i, gitMode: '100644'}))];
  files.at(-1).bytes = 0;
  files[2].bytes += b.forkBytes - files.reduce((sum, row) => sum + row.bytes, 0);
  const fork = {commit: b.commit, tree: b.forkTree, files, filesAreOriginalCommittedPublicSource: true,
    notAdditionalArchiveRoot: true, noFakeGitOrStub: true};
  const values = {source: f.core, composition, fork, supplier, handoff: {}, authHeaders: {}, nativeUndefined: {}};
  return {...f, inputs: Object.fromEntries(Object.entries(b.inputs).map(([key, descriptor]) => [key, {descriptor: {...descriptor}, value: values[key]}])),
    options: {linkCommit: b.linkCommit, linkTree: b.linkTree, linkPaths}};
}
const verifyC2 = f => verifyCore19C2Recipe(f.selected, f.inputs, f.options);

test('Core19 C2 selects a distinct immutable aa60/42031 successor and retains e120/49', () => {
  const f = core19C2Fixture(), before = structuredClone(f.core), n = normalizeCoreSupply(f.core);
  assert.equal(selectCoreSupplyProfile(f.core), f.selected);
  assert.deepEqual(f.core, before);
  assert.equal(n.supply.LINKReadOnlyComposition.sourceCommit, CORE19_C2_BINDING.linkCommit);
  assert.equal(n.provenance.actualCommit, CORE19_C2_BINDING.commit);
  assert.equal(n.provenance.protectedAuthNativeFactoryQualified, false);
  assert.equal(f.selected.totalExports, 49); assert.equal(f.selected.coreExports, 19);
  assert.deepEqual(f.selected.symbols, core19Fixture().selected.symbols);
  assert.equal(selectCoreSupplyProfile(core19Fixture().core).id, 'core19/49');
  assert.deepEqual(verifyC2(f), {profile: CORE19_C2_BINDING.id, normalSourceInputs: 169, linkSourceInputs: 78,
    forkFiles: 1456, forkBytes: 60470640, materializedSourceLeaves: 1623, sourceOnly: true,
    normalNativeImageVerified: false, RootAdmission: false, SourceAdmission: false});
  assert.equal(Object.isFrozen(CORE19_C2_BINDING.modules[0]), true);
});

test('Core19 C2 refuses missing extra duplicate renamed exports and any mixed Core/fork identity', () => {
  for (const mutate of [
    f => f.core.productionClosure.exports.pop(), f => f.core.productionClosure.exports.push({...f.core.productionClosure.exports[0], symbol: 'YNXUnlistedV1'}),
    f => {f.core.productionClosure.exports[1] = {...f.core.productionClosure.exports[0]};},
    f => {f.core.productionClosure.exports[0].symbol += 'Alias';},
    f => {f.core.commit = 'a'.repeat(40);}, f => {f.core.tree = 'b'.repeat(40);},
    f => {f.core.originalCometForkTree = '54e88e6aba735eaceeb2d00bb40731248c673bd7';},
    f => {f.core.tree = core19Fixture().selected.tree;},
  ]) {const f = core19C2Fixture(); mutate(f); assert.throws(() => selectCoreSupplyProfile(f.core));}
});

test('Core19 C2 refuses old or changed module descriptors despite matching count and rest of source', () => {
  for (const expected of CORE19_C2_BINDING.modules) {
    const f = core19C2Fixture(), descriptor = f.core.moduleContext.find(row => row.repositoryPath === expected.repositoryPath);
    descriptor.sha256 = 'f'.repeat(64);
    const source = f.core.sources.find(row => row.repositoryPath === expected.repositoryPath);
    if (source) source.sha256 = descriptor.sha256;
    assert.throws(() => selectCoreSupplyProfile(f.core), /fixed successor module descriptor/);
  }
});

test('Core19 C2 binds each exact SOURCE manifest contract handoff Auth and Native input pin', () => {
  for (const key of Object.keys(CORE19_C2_BINDING.inputs)) for (const field of ['bytes', 'sha256']) {
    const f = core19C2Fixture(); f.inputs[key].descriptor[field] = field === 'bytes' ? f.inputs[key].descriptor.bytes + 1 : 'f'.repeat(64);
    assert.throws(() => verifyC2(f), /fixed C2 .* input pin/);
  }
  for (const key of ['linkCommit', 'linkTree']) {const f = core19C2Fixture(); f.options[key] = 'f'.repeat(40); assert.throws(() => verifyC2(f), /C2 identity/);}
});

test('Core19 C2 requires all169 original normal inputs without four-leaf transplant or relabel', () => {
  for (const mutate of [
    f => f.inputs.composition.value.normalProducerSources.pop(),
    f => f.inputs.composition.value.normalProducerSources.push({...f.inputs.composition.value.normalProducerSources[0], repositoryPath: 'internal/securelink/unlisted.go'}),
    f => {const rows = f.inputs.composition.value.normalProducerSources; rows[1] = {...rows[0]};},
    f => {f.inputs.composition.value.normalProducerSources.find(row => row.owner === 'LINK').commit = '8df4139adb14c68d93e0a55a56851399d46059ac';},
    f => {f.inputs.composition.value.normalProducerSources.find(row => row.owner === 'Core').sha256 = 'f'.repeat(64);},
    f => {f.inputs.composition.value.normalProducerSources.at(-1).generatedFrom = 'caller-template.go';},
    f => {f.options.linkPaths = f.options.linkPaths.slice(0, 4);},
    f => {f.inputs.composition.value.expectedGoABI.total = 51;},
  ]) {const f = core19C2Fixture(); mutate(f); assert.throws(() => verifyC2(f));}
});

test('Core19 C2 requires all1456 regular fork files and matching descriptors including a zero-byte file', () => {
  assert.equal(verifyC2(core19C2Fixture()).forkFiles, 1456);
  for (const mutate of [
    rows => rows.pop(), rows => rows.push({...rows[0], repositoryPath: 'third_party/cometbft/unlisted'}),
    rows => {rows[3] = {...rows[2]};}, rows => {rows[2].repositoryPath = 'third_party/cometbft/../outside';},
    rows => {rows[2].gitMode = '120000';}, rows => {rows[2].bytes = -1;}, rows => {rows[2].bytes++;},
    rows => {rows[0].gitBlob = 'f'.repeat(40);},
  ]) {const f = core19C2Fixture(); mutate(f.inputs.fork.value.files); assert.throws(() => verifyC2(f));}
});

test('Core19 C2 refuses supplier tuple mismatch or substituted original Auth/Native build inputs', () => {
  for (const mutate of [
    f => {f.inputs.supplier.value.normalArchiveProducer.currentlyRequiredOwnerCODE.requiredLINKCommit = 'f'.repeat(40);},
    f => {f.inputs.supplier.value.normalArchiveProducer.currentlyRequiredOwnerCODE.requiredRawSource.sha256 = 'f'.repeat(64);},
    f => {f.inputs.supplier.value.archiveReady = true;},
    f => {f.inputs.composition.value.originalBuildInputs.AuthBuildHeaderInputs.sha256 = 'f'.repeat(64);},
    f => {f.inputs.supplier.value.originalBuildInputPins.NativeOriginalUndefined.bytes++;},
  ]) {const f = core19C2Fixture(); mutate(f); assert.throws(() => verifyC2(f));}
});

test('Core19 C2 keeps real LINK and resource backend edges in the sole original command closure', () => {
  const f = core19C2Fixture(), rows = dependencyRecords(f.selected);
  const result = verifyCoreCommandDependencyClosure(f.selected, jsonSequence(rows));
  assert.equal(result.resourceConsentAlreadyImportedByCoreCommand, true);
  assert.equal(result.normalResourceBinder, 'FIXED_CORE_CABI_REACHABLE_PROTECTED_AUTH_NATIVE_FACTORY_NOT_QUALIFIED');
  rows.find(row => row.Name === 'main').Imports = rows.find(row => row.Name === 'main').Imports.filter(name => !name.endsWith('/securelink'));
  assert.throws(() => verifyCoreCommandDependencyClosure(f.selected, jsonSequence(rows)));
});

test('Core19 C2 neutral C old8 plus2 require unique strong text and never increase Go49 count', () => {
  const f = core19C2Fixture(), names = CORE19_C2_BINDING.neutralCSymbols;
  const plain = names.map(name => '0000000000000000 T _' + name).join('\n');
  const macho = names.map(name => '0000000000000000 (__TEXT,__text) external _' + name).join('\n');
  assert.equal(verifyCore19C2NeutralSymbols(f.selected, plain, macho).length, 10);
  for (const name of [names[0], names[8], names[9]]) {
    assert.throws(() => verifyCore19C2NeutralSymbols(f.selected, plain.replace('T _' + name, 'U _' + name), macho));
    assert.throws(() => verifyCore19C2NeutralSymbols(f.selected, plain, macho.replace('external _' + name, 'weak external _' + name)));
    assert.throws(() => verifyCore19C2NeutralSymbols(f.selected, plain + '\n0 T _' + name, macho + '\n0 (__TEXT,__text) external _' + name));
  }
  assert.equal(f.selected.totalExports, 49);
});
