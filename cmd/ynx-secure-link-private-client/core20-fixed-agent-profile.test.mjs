import test from 'node:test';
import assert from 'node:assert/strict';
import {CORE_SUPPLY_PROFILES, CORE19_C2_BINDING, CORE20_FIXED_AGENT_BINDING as b,
  diagnoseCore20FixedAgentSupply, diagnoseCore20FixedAgentRecipe, normalizeCoreSupply, selectCoreSupplyProfile,
  preparedCoreInputFiles, preparedCoreSourceInventories, verifyPreparedCoreRecipe, verifyPreparedCoreNeutralSymbols,
  verifyCore20FixedAgentRecipe, verifyCore20FixedAgentNeutralSymbols, verifyCoreSupplyBytes,
  verifyCoreCommandDependencyClosure, verifyCombinedSupplyResult} from './combined-supply-profile.mjs';

const command = 'cmd/ynx-artifact-release-cabi', prefix = 'github.com/JiahaoAlbus/YNX-Chain/';
const old = CORE_SUPPLY_PROFILES.find(row => row.id === CORE19_C2_BINDING.id);
const fixed = {symbol: 'YNXAITaskActionAgentFixedSignV6', bridge: command + '/ai_task_agent_fixed_v6_bridge.go',
  header: command + '/ai_task_agent_fixed_v6.h', implementation: 'internal/ynxbatch/ai_task_v6_fixed_sign.go'};
const layout = {...old, id: b.id, commit: b.commit,
  tree: b.tree, preparedComposition: b,
  sourcePaths: [...old.sourcePaths, ...b.additions.map(row => row.repositoryPath)].sort(),
  symbols: [...old.symbols, fixed.symbol].sort(), bindings: [...old.bindings, fixed],
  headers: [...old.headers, fixed.header].sort(), bridges: [...old.bridges, fixed.bridge].sort(),
  cgoTranslationUnits: [...old.cgoTranslationUnits, fixed.bridge].sort(), coreExports: 20, totalExports: 50};
const active = CORE_SUPPLY_PROFILES.find(row => row.id === b.id);
const sample = () => ({bytes: 1, sha256: '1'.repeat(64), gitBlob: '2'.repeat(40)});
const pinFor = path => ({...sample(), ...(b.modules.find(row => row.repositoryPath === path) ??
  b.additions.find(row => row.repositoryPath === path) ?? {}), repositoryPath: path});

// In-memory PUBLIC metadata exercises the complete new graph; these bytes/hash
// labels do not claim an actual Git supply, compilation, Source or Root grant.
function fixture() {
  const raw = {schema: b.rawSchema, commit: layout.commit, tree: layout.tree,
    parentCommit: CORE19_C2_BINDING.commit, parentTree: CORE19_C2_BINDING.tree,
    sourceRoot: '/PUBLIC/core20/src', moduleContextRoot: '/PUBLIC/core20/module-context',
    sourceLeafCount: 91, moduleContextRows: 4, physicalCarrierFiles: 95, uniqueRepositoryPaths: 93,
    actualCommitNotPrediction: true, actualSourceCommitIsNotSDKComposition: true, sourceBytesUnmodified: true,
    completeGitTreeIsNotPackaged: true, carrierIsProductionClosureNotStandaloneVendorTree: true,
    normalAFullForkAndModuleContextRequired: true, archiveIncluded: false, authority: false,
    selectedNormalInputH: {...b.inputs.integration}, selectedNormalInputCAS: {...b.inputs.inputCAS},
    sources: layout.sourcePaths.map(path => ({...pinFor(path), path: '/PUBLIC/core20/src/' + path, gitMode: '100644',
      commit: layout.commit, tree: layout.tree, changeFromParent: b.additions.some(row => row.repositoryPath === path) ? 'ADD' : 'UNCHANGED'})),
    moduleContext: b.modules.map(row => ({...row, path: '/PUBLIC/core20/module-context/' + row.repositoryPath, gitMode: '100644',
      commit: layout.commit, tree: layout.tree, changeFromParent: 'UNCHANGED'})),
    productionClosure: {rootPackage: command,
      packageCount: 5, goFileCount: 71, headerCount: 18, productionLeafCount: 91, cgoTranslationUnitCount: 20, exportCount: 20, guardCount: 17,
      exactGitOldProductionFileSetChecked: true, staticImportsIndependentlyRewalked: true, exactGitProductionFileSetChecked: true,
      exactGitCommit: layout.commit, freshGoListRun: false, freshGoTestRun: false, nativeArchiveBuilt: false,
      pragmaOnceHeaders: [fixed.header], includeGuards: old.headers.map((header, i) => ({header, guard: 'PUBLIC_HEADER_' + i + '_H'})),
      localIncludes: [{source: fixed.bridge, include: fixed.header}],
      oldActualGoList: {bytes: 366975, sha256: '3e90a99beb32341d20212029ed65ecfaa9298385c522e43dfd293a69b4c0a675'},
      cgoTranslationUnits: [...layout.cgoTranslationUnits],
      exports: layout.bindings.map(row => ({symbol: row.symbol, source: row.bridge})),
      packages: Object.fromEntries(layout.packagePaths.map(name => [name, {importPath: prefix + name,
        productionGoFiles: layout.sourcePaths.filter(path => path.startsWith(name + '/') && path.endsWith('.go')),
        imports: name === command ? layout.packagePaths.filter(name => name !== command).map(name => prefix + name) : [],
        exactGitProductionFileSetChecked: true}]))}};
  const linkPaths = [...Array.from({length: 75}, (_, i) => 'internal/securelink/public-fixture-' + i + '.go'),
    'internal/securelink/testdata/product-transport-contract-r2/product_pay_transport_private.h',
    'cmd/ynx-secure-link-caller/private_client_v1.h', 'cmd/ynx-secure-link-caller/private_client_startup_v1.h'];
  const coreRows = new Map([...raw.sources, ...raw.moduleContext].map(row => [row.repositoryPath, row]));
  const normal = [...coreRows].map(([repositoryPath, row]) => ({...row, repositoryPath,
    ...(b.additions.some(add => add.repositoryPath === repositoryPath) ?
      {owner: 'Original SDK fixedAgent supplier -> original Core normal source owner', sourceCommit: '6e13ba7cf0abd83d974045d765a5e86491af30b4',
        sourcePath: 'core-source/' + repositoryPath, compositeOverlayOnly: true} : {owner: 'Core', commit: CORE19_C2_BINDING.commit})}));
  normal.push(...linkPaths.map(repositoryPath => ({...sample(), repositoryPath, owner: 'LINK', commit: b.linkCommit})),
    {...b.template, owner: 'LINK original composition template', commit: b.linkCommit});
  const materialize = row => ({...row, path: '/PUBLIC/prepared/source/' + row.repositoryPath, relative: 'source/' + row.repositoryPath,
    mode: '0o644', action: b.additions.some(add => add.repositoryPath === row.repositoryPath) ? 'ADD' : 'UNCHANGED'});
  const fork = [...b.modules.filter(row => row.repositoryPath.startsWith('third_party/')).map(materialize),
    ...Array.from({length: 1454}, (_, i) => materialize({...sample(), repositoryPath: 'third_party/cometbft/public-fixture-' + i}))];
  fork.at(-1).bytes = 0;
  fork[2].bytes += b.forkBytes - fork.reduce((sum, row) => sum + row.bytes, 0);
  const nonFork = normal.filter(row => !row.repositoryPath.startsWith('third_party/'));
  nonFork.find(row => row.repositoryPath === linkPaths[0]).bytes += b.completeSourceBytes - b.forkBytes - nonFork.reduce((sum, row) => sum + row.bytes, 0);
  const files = [...nonFork.map(materialize), ...fork];
  const composition = {schema: 'YNX-FIXED-AGENT-ONE-ARCHIVE-SOURCE-PREPARED/v1', completeSourceFiles: 1626,
    completeSourceBytes: b.completeSourceBytes, normalProducerInputs: normal, normalProducerInputCount: 172, forkFiles: 1456,
    forkTreeUnchanged: b.forkTree, normalForkDescriptorAliases: 2, files, inputOnly: true, CoreReleaseCommitNotIssued: true,
    compiled: false, admitted: false};
  const authHeaders = {version: 1, headers: ['pay_native_actual_context_private.h', 'pay_native_source_lease_private.h', 'pay_root_transport_loan_private.h', 'product_pay_transport_private.h']
    .map(name => ({...sample(), name, path: '/PUBLIC/auth/' + name}))};
  const headers = [...layout.headers.map(path => ({...coreRows.get(path), name: path.split('/').at(-1),
    owner: path === fixed.header ? 'CoreFixedAgentV6' : 'core'})),
    ...linkPaths.filter(path => path.endsWith('.h')).map(path => ({...normal.find(row => row.repositoryPath === path), name: path.split('/').at(-1),
      owner: path.startsWith('cmd/') ? 'link' : 'product'})), ...authHeaders.headers.filter(row => row.name !== 'product_pay_transport_private.h').map(row => ({...row, owner: 'auth'}))]
    .map(row => ({...row, relative: 'include/' + row.name, mode: '0o644'}));
  const headerManifest = {schema: 'YNX-FIXED-AGENT-ONE-ARCHIVE-HEADERS/v1', handwrittenCount: 24, headers,
    oldGeneratedHeader: [{bytes: 6925, sha256: 'a9946c9466b66a0e4ca5214cfbaa54f9b7ca2f143ed92f2d5d1746a71879efbd'}],
    oldGeneratedHeaderCopiedToNewInput: false, newGeneratedHeaderRequiredFromActualGoBuild: true,
    expectedFinalHeaderInventory: {handwritten: 24, generated: 1, total: 25}};
  const linkSymbols = ['adopt_source', 'close', 'closed', 'error', 'free', 'join', 'open', 'retire'].map(n => 'ynx_link_pay_native_startup_' + n + '_v1')
    .concat(['call', 'capture', 'close', 'current_local', 'current_source', 'error', 'free', 'join', 'packet_free', 'recheck',
      'registration_borrow_current', 'registration_borrow_release', 'registration_from_borrow', 'retire'].map(n => 'ynx_link_private_client_' + n + '_v1'));
  const productSymbols = ['cancel', 'close', 'join', 'open', 'release_response', 'request', 'response_diagnostics', 'retire']
    .map(n => 'ynx_product_pay_transport_' + n + '_v1');
  const expectedExports = {schema: 'YNX-FIXED-AGENT-ONE-ARCHIVE-EXPECTED-ABI/v1', CoreBefore: 19, CoreAfter: 20, LINKUnchanged: 22,
    ProductUnchanged: 8, GoBefore: 49, GoAfter: 50, GoStrongSymbolsExpected: [...layout.symbols, ...linkSymbols, ...productSymbols],
    newStrongSymbol: fixed.symbol, neutralC10Unchanged: [...b.neutralCSymbols], neutralCNotAdditionalGoExports: true,
    expectedArchives: 1, actualNewArchive: null, newNmExecuted: false, actualNewHeader: null, newHandHeader: {...b.additions.find(row => row.repositoryPath === fixed.header)}};
  const inputCAS = {schema: 'YNX-ROOT-FIXED-AGENT-ONE-ARCHIVE-INPUT-CAS/v1',
    base: {CoreCommit: CORE19_C2_BINDING.commit, LINKCommit: b.linkCommit, sourceFiles: 1623,
      profile: {id: CORE19_C2_BINDING.id, commit: CORE19_C2_BINDING.commit, tree: CORE19_C2_BINDING.tree, coreExports: 19, totalExports: 49}},
    changes: b.additions.map(row => ({...materialize(row), before: null, sourceGit: {commit: '6e13ba7cf0abd83d974045d765a5e86491af30b4',
      repositoryPath: 'core-source/' + row.repositoryPath, kind: 'SUPPLIER_INDEPENDENT_COMPOSITION_NOT_CORE_RELEASE_COMMIT'}})), MODIFY: [], REMOVE: [],
    sourceManifest: {...b.inputs.composition}, headerManifest: {...b.inputs.headerManifest}, expectedExports: {...b.inputs.expectedExports},
    nativeCompanions: {...b.inputs.nativeCompanions}, compatibility: {...b.inputs.compatibility}, sourceInputsVerifiedAgainstOriginalPins: true,
    beforeAbsenceVerifiedInOriginalAInventoryAndSourceRoot: true, baselineNotWritten: true, supplierNotWritten: true,
    productionSharedWriteSetModified: false, actualNewArchive: null, AStartAuthorized: false, AStartExecuted: false};
  const integration = {schema: 'YNX-ROOT-FIXED-AGENT-ONE-ARCHIVE-NORMAL-INPUT-HANDOFF/v1', CoreProductionLeaves: 91, GoExportCount: 50,
    twoGoRuntimesAllowed: false, completeMaterializedSourceFiles: 1626, completeMaterializedSourceBytes: b.completeSourceBytes,
    expectedNewExport: fixed.symbol, fixedN: 1, wholeBatchANDSecurityUnchanged: true,
    truth: {actualNewArchiveBuilt: false, normalProfileAdmitted: false, AStartAuthorized: false, AStartExecuted: false, RootAdmission: false, SourceAdmission: false},
    preparedInputs: Object.fromEntries(Object.entries({composition: 'SOURCE_MANIFEST', inputCAS: 'SOURCE_INPUT_CAS', headerManifest: 'HEADER_MANIFEST',
      expectedExports: 'EXPECTED_EXPORTS', nativeCompanions: 'NATIVE_COMPANIONS', compatibility: 'INHERITED_COMPATIBILITY', ownership: 'NORMAL_PRODUCER_HANDOFF'})
      .map(([key, label]) => [label, {...b.inputs[key]}]))};
  const ownership = {schema: 'YNX-FIXED-AGENT-NORMAL-PRODUCER-OWNERSHIP/v1', uniqueProductionWriter: {threadId: '01a1913c-4f7c-73b1-a774-e67496ebc6d6'},
    noProductPatchGenerated: true, noReceiverTaskIncluded: true};
  const compatibility = {schema: 'YNX-FIXED-AGENT-INHERITED-COMPATIBILITY/v1', matchingMathematicalSourceLeaves: 19,
    actualFullCandidateCompiled: false, originalComponentControlsQualificationNotTransferred: true,
    rows: [...['go.mod', 'go.sum'], ...old.sourcePaths.filter(path => path.startsWith('internal/') && path.endsWith('.go')).slice(0, 19)]
      .map(repositoryPath => ({repositoryPath, selectedNormalAInput: {...coreRows.get(repositoryPath)}, selection: 'KEEP_NORMAL_A_AA60_SOURCE',
        byteExact: !['go.mod', 'go.sum'].includes(repositoryPath), inheritedTestInput: {...coreRows.get(repositoryPath),
          ...(['go.mod', 'go.sum'].includes(repositoryPath) ? {sha256: 'f'.repeat(64)} : {})}}))};
  const nativeCompanions = {schema: 'YNX-FIXED-AGENT-NATIVE-COMPANIONS-INPUT-ONLY/v1', notGoArchiveSources: true, noAuthReceiverSourceIncluded: true,
    noNativeLinkExecuted: true, SDKCodecOldBodyRequiredAPIsUnchanged: true, files: [
      'packages/wallet-auth/native/ai-agent/FixedOriginalAITaskActionV6Sign.cpp', 'packages/wallet-auth/native/ai-agent/ai_task_agent_fixed_v6.h',
      'packages/wallet-auth/native/ai-v6-codec/MobileAITaskV6CodecDATA.cpp', 'packages/wallet-auth/native/ai-v6-codec/MobileAITaskV6CodecDATA.hpp']
      .map(target => ({...sample(), ...(target.endsWith('/ai_task_agent_fixed_v6.h') ? b.additions.find(row => row.repositoryPath === fixed.header) : {}), target}))};
  const values = {source: raw, composition, headerManifest, expectedExports, inputCAS, integration, ownership, compatibility,
    nativeCompanions, authHeaders, nativeUndefined: {unresolvedCore: [...layout.symbols]}};
  const inputs = Object.fromEntries(Object.entries(b.inputs).map(([key, descriptor]) => [key, {descriptor: {...(descriptor ?? sample())}, value: values[key]}]));
  return {raw, inputs, context: {linkCommit: b.linkCommit, linkTree: b.linkTree, linkPaths}, linkSymbols, productSymbols};
}
const diagnose = f => diagnoseCore20FixedAgentRecipe(f.inputs, f.context);
function rejects(mutations, message) {for (const mutate of mutations) {const f = fixture(); mutate(f); assert.throws(() => diagnose(f), message);}}

test('Core20 actual50c41 identity selects the independent91-leaf normal profile and preserves raw provenance', () => {
  const f = fixture(), before = structuredClone(f.raw), d = diagnoseCore20FixedAgentSupply(f.raw);
  assert.deepEqual(f.raw, before); assert.deepEqual(d.counts, {sourceLeaves: 91, productionGo: 71, handHeaders: 18,
    exportedSymbols: 20, cgoTranslationUnits: 20, cgoTranslationUnitPaths: layout.cgoTranslationUnits});
  assert.equal(d.normalProfileAdmitted, false); assert.equal(d.actualGitBytesVerified, false);
  assert.equal(d.SourceAdmission, false); assert.equal(d.RootAdmission, false);
  assert.equal(b.identitySupplied, true); assert.ok(active);
  assert.equal(active.commit, b.commit); assert.equal(selectCoreSupplyProfile(f.raw), active);
});

test('Core20 normal selector rejects every wrong or mixed Git tuple and resubmitted derived view', () => {
  for (const mutate of [r => r.commit = CORE19_C2_BINDING.commit, r => r.tree = CORE19_C2_BINDING.tree,
    r => r.commit = 'f'.repeat(40), r => r.tree = 'f'.repeat(40), r => r.schema = 'YNX-CORE19-EXACT-GIT-SOURCE/v1']) {
    const f = fixture(); mutate(f.raw); assert.throws(() => selectCoreSupplyProfile(f.raw));
  }
  const f = fixture(), normalized = normalizeCoreSupply(f.raw), before = structuredClone(f.raw);
  assert.throws(() => selectCoreSupplyProfile(normalized.supply));
  assert.deepEqual(normalized.provenance.rawDependencyClosure, f.raw.productionClosure);
  assert.deepEqual(normalized.provenance.rawSourceIdentity, {commit: b.commit, tree: b.tree, parentCommit: old.commit,
    parentTree: old.tree, actualCommitNotPrediction: true, actualSourceCommitIsNotSDKComposition: true});
  assert.deepEqual(f.raw, before);
});

test('Core20 metadata rejects old release identities and a supplier identity as a new Core release', () => {
  for (const commit of [old.commit, CORE_SUPPLY_PROFILES.find(row => row.id === 'core19/49').commit, '6e13ba7cf0abd83d974045d765a5e86491af30b4']) {
    const f = fixture(); f.raw.commit = commit; assert.throws(() => diagnoseCore20FixedAgentSupply(f.raw), /old Core\/SDK/);
  }
});

test('Core20 exact source and export identities reject omission, same-count swaps, static-TU deletion and wrong fixed implementation', () => {
  rejects([f => f.raw.sources.pop(), f => f.raw.sources[0].repositoryPath = 'internal/ynxbatch/foreign.go',
    f => f.raw.productionClosure.cgoTranslationUnits.pop(),
    f => f.raw.productionClosure.cgoTranslationUnits[0] = command + '/foreign.go',
    f => f.raw.productionClosure.exports.push({...f.raw.productionClosure.exports[0]}),
    f => f.raw.productionClosure.exports[0].source = fixed.bridge,
    f => f.raw.productionClosure.exports.at(-1).symbol = 'YNXAgentAlternateV6',
    f => f.raw.sources.find(row => row.repositoryPath === fixed.header).bytes++,
    f => f.raw.sources.find(row => row.repositoryPath === fixed.implementation).gitBlob = 'e'.repeat(40)]);
});

test('Core20 normalizer preserves raw metadata and refuses a forged derived/postcommit dialect, modules and stale closure', () => {
  rejects([f => f.raw.source = {commit: f.raw.commit}, f => f.raw.actualCommit = f.raw.commit, f => f.raw.postCommit = f.raw.commit,
    f => f.raw.productionClosure.goFileCount = 69, f => f.raw.productionClosure.cgoTranslationUnitCount = 18,
    f => f.raw.productionClosure.staticImportsIndependentlyRewalked = false, f => f.raw.productionClosure.nativeArchiveBuilt = true,
    f => f.raw.productionClosure.packages[command].imports = [], f => f.raw.productionClosure.freshGoListRun = true,
    f => f.raw.moduleContext[0].sha256 = 'f'.repeat(64), f => f.raw.sources[0].path = '/PUBLIC/different/' + f.raw.sources[0].repositoryPath,
    f => f.raw.moduleContext.pop(), f => f.raw.productionClosure.guardCount = 18,
    f => f.raw.productionClosure.pragmaOnceHeaders = [], f => f.raw.sourceBytesUnmodified = false,
    f => f.raw.parentCommit = f.raw.commit, f => f.raw.physicalCarrierFiles = 93, f => f.raw.uniqueRepositoryPaths = 95,
    f => f.raw.sources[0].commit = CORE19_C2_BINDING.commit, f => f.raw.moduleContext[0].changeFromParent = 'ADD']);
});

test('Core20 complete172/1626 metadata recipe retains raw regular modes and does not grant normal qualification', () => {
  const f = fixture(), before = structuredClone(f.inputs), r = diagnose(f);
  assert.equal(r.normalSourceInputs, 172); assert.equal(r.forkFiles, 1456); assert.equal(r.materializedSourceLeaves, 1626);
  assert.equal(r.materializedSourceBytes, 61696256); assert.equal(r.handwrittenHeaders, 24); assert.equal(r.requiredFreshGeneratedHeaders, 1);
  assert.equal(r.combinedExports, 50); assert.equal(r.actualGitBytesVerified, false); assert.equal(r.normalProfileAdmitted, false);
  assert.deepEqual(f.inputs, before);
  {
    assert.deepEqual(verifyPreparedCoreRecipe(active, f.inputs, f.context), verifyCore20FixedAgentRecipe(active, f.inputs, f.context));
    const inventory = preparedCoreSourceInventories(active, f.inputs);
    assert.equal(inventory.normal.length, 172); assert.equal(inventory.fork.length, 1456);
    assert.equal(inventory.fork[0].mode, '0o644'); assert.equal(inventory.fork[0].validatedGitMode, '100644');
  }
  for (const call of [() => preparedCoreSourceInventories({...active}, f.inputs), () => verifyPreparedCoreRecipe({...active}, f.inputs, f.context),
    () => verifyCore20FixedAgentRecipe({...active}, f.inputs, f.context)]) assert.throws(call, /approved/);
});

test('Core20 static input layout is closed; frozen Core19 C2 keeps its original filenames and exact gate', () => {
  assert.deepEqual(preparedCoreInputFiles(old), {composition: 'COMPOSITION.json', fork: 'FORK-CONTEXT.json', supplier: 'SUPPLIER-CONTRACT.json', handoff: 'HANDOFF.json'});
  assert.deepEqual(preparedCoreInputFiles(active), {integration: 'INTEGRATION_HANDOFF.json', ownership: 'NORMAL_PRODUCER_HANDOFF.json',
    composition: 'SOURCE_MANIFEST.json', inputCAS: 'SOURCE_INPUT_CAS.json', headerManifest: 'HEADER_MANIFEST.json', expectedExports: 'EXPECTED_EXPORTS.json',
    nativeCompanions: 'NATIVE_COMPANIONS.json', compatibility: 'INHERITED_COMPATIBILITY.json'});
  assert.throws(() => preparedCoreInputFiles({...active}), /approved/);
  assert.throws(() => verifyCore20FixedAgentRecipe(old, fixture().inputs, fixture().context), /Core20 identity/);
});

test('Core20 all fixed input descriptors, corrected CAS and LINK tuple are independently mandatory', () => {
  for (const key of Object.keys(b.inputs).filter(key => b.inputs[key])) for (const field of ['bytes', 'sha256']) {
    const f = fixture(); f.inputs[key].descriptor[field] = field === 'bytes' ? 1 : 'f'.repeat(64); assert.throws(() => diagnose(f), /pin/);
  }
  rejects([f => f.inputs.inputCAS.value.expectedExports = {bytes: 3929, sha256: 'f8c8f47dcee54931688f7c74867622a056be8472b9522f9ee2b1c16498bd56fa'},
    f => f.context.linkCommit = 'f'.repeat(40), f => f.context.linkTree = 'f'.repeat(40), f => f.context.linkPaths.pop(),
    f => f.inputs.integration.value.preparedInputs.SOURCE_INPUT_CAS.sha256 = 'f'.repeat(64)]);
});

test('Core20 graph rejects same-count substitution, mode/traversal, bytes/alias/fork omissions and foreign native sources', () => {
  rejects([f => f.inputs.composition.value.files[0].repositoryPath = 'foreign/source.go',
    f => f.inputs.composition.value.files[0].mode = '0o755', f => f.inputs.composition.value.files[0].relative = 'source/../escape',
    f => f.inputs.composition.value.files[0].bytes++, f => f.inputs.composition.value.files.pop(),
    f => f.inputs.composition.value.files.at(-1).repositoryPath = 'third_party/cometbft/../escape',
    f => f.inputs.composition.value.normalProducerInputs[0].sha256 = 'f'.repeat(64),
    f => f.inputs.composition.value.normalForkDescriptorAliases = 0, f => f.inputs.composition.value.forkTreeUnchanged = 'f'.repeat(40),
    f => f.inputs.composition.value.files.find(row => row.repositoryPath === fixed.bridge).action = 'UNCHANGED',
    f => f.inputs.nativeCompanions.value.notGoArchiveSources = false]);
});

test('Core20 preparation provenance does not turn old aa60/supplier6e13 rows into a new commit claim', () => {
  rejects([f => f.inputs.composition.value.normalProducerInputs.find(row => row.owner === 'Core').commit = f.raw.commit,
    f => f.inputs.composition.value.normalProducerInputs.find(row => row.compositeOverlayOnly).sourceCommit = f.raw.commit,
    f => f.inputs.inputCAS.value.changes[0].before = sample(), f => f.inputs.inputCAS.value.changes[0].sourceGit.kind = 'CORE_RELEASE_COMMIT',
    f => f.inputs.inputCAS.value.MODIFY.push(fixed.bridge), f => f.inputs.inputCAS.value.AStartExecuted = true,
    f => f.inputs.integration.value.truth.normalProfileAdmitted = true,
    f => f.inputs.compatibility.value.rows[0].selectedNormalAInput.sha256 = 'f'.repeat(64),
    f => f.inputs.compatibility.value.originalComponentControlsQualificationNotTransferred = false]);
});

test('Core20 hand header, generated-header freshness and exact50 symbol declarations cannot reuse old49 or neutralC10', () => {
  rejects([f => f.inputs.headerManifest.value.headers.pop(), f => f.inputs.headerManifest.value.headers[0].sha256 = 'f'.repeat(64),
    f => f.inputs.headerManifest.value.oldGeneratedHeaderCopiedToNewInput = true,
    f => f.inputs.headerManifest.value.newGeneratedHeaderRequiredFromActualGoBuild = false,
    f => f.inputs.expectedExports.value.GoStrongSymbolsExpected.pop(),
    f => f.inputs.expectedExports.value.GoStrongSymbolsExpected[0] = b.neutralCSymbols[0],
    f => f.inputs.expectedExports.value.GoStrongSymbolsExpected.push(fixed.symbol),
    f => f.inputs.expectedExports.value.neutralC10Unchanged.pop(), f => f.inputs.expectedExports.value.expectedArchives = 2,
    f => f.inputs.expectedExports.value.actualNewHeader = {bytes: 6925},
    f => f.inputs.expectedExports.value.newHandHeader.bytes++,
    f => f.inputs.authHeaders.value.headers.pop(),
    f => f.inputs.authHeaders.value.headers.find(row => row.name === 'product_pay_transport_private.h').sha256 = 'f'.repeat(64)]);
});

test('Core20 registered profile gates original byte maps, import traversal, strong ABI and neutral definitions', () => {
  const f = fixture();
  const rows = layout.packagePaths.map(name => ({ImportPath: prefix + name, Name: name === command ? 'main' : name.split('/').at(-1),
    DepOnly: name !== command, Imports: name === command ? [prefix + 'internal/securelink', ...layout.packagePaths.filter(p => p !== command).map(p => prefix + p)] : [],
    GoFiles: layout.sourcePaths.filter(p => p.startsWith(name + '/') && p.endsWith('.go') && !layout.cgoTranslationUnits.includes(p)).map(p => p.slice(name.length + 1)),
    CgoFiles: layout.cgoTranslationUnits.filter(p => p.startsWith(name + '/')).map(p => p.slice(name.length + 1))}));
  rows.find(row => row.Name === 'main').GoFiles.push('link_transport_import.go');
  rows.push({ImportPath: prefix + 'internal/securelink', DepOnly: true, Imports: []});
  const stream = () => rows.map(row => JSON.stringify(row)).join('\n');
  assert.equal(verifyCoreCommandDependencyClosure(active, stream()).resourceConsentAlreadyImportedByCoreCommand, true);
  rows.find(row => row.Name === 'main').Imports = [prefix + 'internal/securelink'];
  assert.throws(() => verifyCoreCommandDependencyClosure(active, stream()), /closure/);
  const result = {coreExports: [...layout.symbols], linkExports: f.linkSymbols, productExports: f.productSymbols,
    symbols: [...layout.symbols, ...f.linkSymbols, ...f.productSymbols].map(symbol => ({symbol, type: 'T',
      definition: '0001 (__TEXT,__text) external _' + symbol}))};
  verifyCombinedSupplyResult(active, result);
  for (const mutate of [r => r.coreExports[0] = 'YNXForeignV1', r => r.linkExports[0] = r.linkExports[1],
    r => r.productExports[0] = r.productExports[1], r => r.symbols[0].symbol = r.symbols[1].symbol,
    r => r.symbols[0].type = 'U', r => r.symbols[0].definition += ' weak',
    r => r.symbols = r.symbols.map(row => row.symbol)]) {
    const bad = structuredClone(result); mutate(bad); assert.throws(() => verifyCombinedSupplyResult(active, bad));
  }
  assert.throws(() => verifyCoreSupplyBytes(f.raw, active, new Map(), new Map()), /read source paths/);
  const owned = new Map(layout.sourcePaths.map(path => [path, Buffer.from('PUBLIC mutated source bytes\n')]));
  const descriptors = new Map(b.modules.map(row => [row.repositoryPath, Buffer.from('PUBLIC mutated descriptor bytes\n')]));
  assert.throws(() => verifyCoreSupplyBytes(f.raw, active, owned, descriptors), /original bytes\/hash\/Git mismatch/);
  const plain = b.neutralCSymbols.map(name => '0001 T _' + name).join('\n');
  const macho = b.neutralCSymbols.map(name => '0001 (__TEXT,__text) external _' + name).join('\n');
  assert.equal(verifyPreparedCoreNeutralSymbols(active, plain, macho).length, 10);
  assert.deepEqual(verifyCore20FixedAgentNeutralSymbols(active, plain, macho), verifyPreparedCoreNeutralSymbols(active, plain, macho));
  for (const bad of [macho + '\n0001 (__TEXT,__text) weak external _ynx_ctx_new', macho.replace('external _ynx_ctx_new', '(undefined) external _ynx_ctx_new')])
    assert.throws(() => verifyPreparedCoreNeutralSymbols(active, plain, bad), /strong callee/);
});
