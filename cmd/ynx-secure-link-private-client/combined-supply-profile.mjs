import {createHash} from 'node:crypto';

const command = 'cmd/ynx-artifact-release-cabi';
const baseLINKCommit = '8df4139adb14c68d93e0a55a56851399d46059ac';
const version = 'YNX-CORE-MACOS-SINGLE-GO-IMAGE-PUBLIC-SOURCE-SUPPLY/v1';
const modulePaths = Object.freeze(['go.mod', 'go.sum', 'third_party/cometbft/go.mod', 'third_party/cometbft/go.sum']);
const commonBindings = [
  ['YNXArtifactPublicationSignV1', 'bridge.go', 'ynx_artifact_release.h', 'core.go'],
  ['YNXProjectControlSignV1', 'control_bridge.go', 'ynx_project_control.h', 'control_core.go'],
  ['YNXTransactionBatchSignV1', 'tx_bridge.go', 'tx_batch.h', 'tx_core.go'],
  ['YNXAccountInitialSignV1', 'initial_bridge.go', 'account_initial.h', 'initial_core.go'],
  ['YNXProductSessionHTTPProofSignV4', 'device_http_bridge.go', 'product_session_http.h', 'device_http_core.go'],
  ['YNXProductSessionDeviceRegistrationSignV4', 'product_device_registration_v4_bridge.go', 'product_device_registration_v4.h', 'product_device_registration_v4_core.go'],
  ['YNXProductSessionDeviceChallengeSignV4', 'product_device_challenge_v4_bridge.go', 'product_device_challenge_v4.h', 'product_device_challenge_v4_core.go'],
  ...['Generate', 'PoPSign', 'CustodianSign'].map(name => ['YNXPublisher' + name + 'V1', 'publisher_bridge.go', 'publisher_registration.h', 'publisher_core.go']),
  ['YNXRegisteredANDMemberVerifyN1V1', 'registered_n1_verify_bridge.go', 'registered_n1_verify.h', 'registered_n1_verify_core.go'],
  ['YNXProductSessionHTTPProofSignV5', 'device_http_v5_bridge.go', 'product_session_http_v5.h', 'device_http_v5_core.go'],
  ['YNXProductSessionDeviceKeypairGenerateV4', 'product_device_keypair_v4_bridge.go', 'product_device_keypair_v4.h', 'product_device_keypair_v4_core.go'],
  ['YNXDeploymentManifestSignV2', 'deployment_manifest_v2_bridge.go', 'deployment_manifest_v2.h', 'deployment_manifest_v2_core.go'],
  ['YNXAccountMigrationPossessionSignV1', 'migration_bridge.go', 'account_migration.h', 'migration_core.go'],
];
const commonPackages = {
  'internal/accountaddress': ['address.go'],
  'internal/ynxauth': ['action.go', 'contract_action.go', 'ethereum.go', 'invoice_action.go', 'message.go', 'policy.go', 'pq_initial_policy.go', 'pq_initial_possession.go', 'revocation.go', 'staking_action.go', 'wallet_policy_json.go'],
  'internal/ynxbatch': ['artifact_publication.go', 'certificate_cache.go', 'codec.go', 'deployment_manifest_v2.go', 'key_material.go', 'parallel_provider.go', 'product_device_v4.go', 'product_session_http.go', 'product_session_http_v5.go', 'project_control.go', 'provider.go', 'publisher_registration.go', 'sign.go', 'tree.go', 'verify.go'],
};
function profile(id, commit, tree, additionalBindings = [], additionalSources = [], settings = {}) {
  const bindings = [...commonBindings, ...additionalBindings].map(([symbol, bridge, header, implementation]) => Object.freeze({
    symbol, bridge: command + '/' + bridge, header: command + '/' + header, implementation: command + '/' + implementation,
  }));
  const sourcePaths = [...new Set(['go.mod', 'go.sum', ...bindings.flatMap(row => [row.bridge, row.header, row.implementation]),
    ...Object.entries(commonPackages).flatMap(([pkg, names]) => names.map(name => pkg + '/' + name)), ...additionalSources])].sort();
  const packagePaths = [...new Set(sourcePaths.filter(name => name.endsWith('.go')).map(name => name.slice(0, name.lastIndexOf('/'))))].sort();
  const bridges = [...new Set(bindings.map(row => row.bridge))].sort();
  const nonExportCgoTranslationUnits = settings.nonExportCgoTranslationUnits ?? [];
  return Object.freeze({id, commit, tree, bindings: Object.freeze(bindings), sourcePaths: Object.freeze(sourcePaths),
    modulePaths, packagePaths: Object.freeze(packagePaths), symbols: Object.freeze(bindings.map(row => row.symbol).sort()),
    headers: Object.freeze([...new Set(bindings.map(row => row.header))].sort()),
    bridges: Object.freeze(bridges), nonExportCgoTranslationUnits: Object.freeze(nonExportCgoTranslationUnits),
    cgoTranslationUnits: Object.freeze([...bridges, ...nonExportCgoTranslationUnits].sort()),
    resourceBackendImported: settings.resourceBackendImported === true,
    normalPackagePaths: Object.freeze(packagePaths.filter(name => settings.resourceBackendImported || name !== 'internal/ynxresourceconsent')),
    coreExports: bindings.length, totalExports: bindings.length + 22 + 8});
}

// Updating a supplier source identity requires an explicit owner-reviewed profile.
// Counts alone, a new caller-chosen commit, or arbitrary paths never select one.
const originalProfiles = Object.freeze([
  profile('core15/45', '84a57203f2ea10dfa51c9c4cef817ea3cc411b9c', '13e9cba4d9650bf71fcbf8080286d648a1b45fbf'),
  profile('core17/47', 'ebd19f47559d5e97082e5c61fff106fb4aee6f7f', 'bdafb9c790b825eb277be358535b51983912beed', [
    ['YNXAccountMigrationAuthorizationSignV1', 'migration_authorization_bridge.go', 'account_migration_authorization.h', 'migration_authorization_core.go'],
    ['YNXProductPairPendingOriginalQuerySignV1', 'pending_query_bridge.go', 'product_pair_pending_original_query.h', 'pending_query_core.go'],
  ], ['internal/ynxauth/migration_signing.go', 'internal/ynxbatch/product_pair_pending_original_query.go']),
  profile('core18/48', 'f27e07df6dd96114135aceace20a9413bba94649', '448397a08ab167647f970934891d1336b81d15e0', [
    ['YNXAccountMigrationAuthorizationSignV1', 'migration_authorization_bridge.go', 'account_migration_authorization.h', 'migration_authorization_core.go'],
    ['YNXProductPairPendingOriginalQuerySignV1', 'pending_query_bridge.go', 'product_pair_pending_original_query.h', 'pending_query_core.go'],
    ['YNXAuthSourceStatementVerifyV2', 'source_statement_v2_bridge.go', 'auth_source_statement_v2.h', 'source_statement_v2_core.go'],
  ], ['internal/ynxauth/migration_signing.go', 'internal/ynxbatch/product_pair_pending_original_query.go',
    command + '/source_statement_v2_foreign_controls.go', 'internal/ynxbatch/auth_source_statement_v2.go',
    'internal/ynxbatch/resource_consent.go', 'internal/ynxresourceconsent/consent.go'],
  {nonExportCgoTranslationUnits: [command + '/source_statement_v2_foreign_controls.go']}),
  profile('core19/49', 'e12036079d28adef2559733739a4743e258ba4e5', 'caf9cbfd3e8c1aef203797f67dbd012568b05a3c', [
    ['YNXAccountMigrationAuthorizationSignV1', 'migration_authorization_bridge.go', 'account_migration_authorization.h', 'migration_authorization_core.go'],
    ['YNXProductPairPendingOriginalQuerySignV1', 'pending_query_bridge.go', 'product_pair_pending_original_query.h', 'pending_query_core.go'],
    ['YNXAuthSourceStatementVerifyV2', 'source_statement_v2_bridge.go', 'auth_source_statement_v2.h', 'source_statement_v2_core.go'],
    ['YNXNetworkResourceConsentAttemptV1', 'network_resource_consent_bridge.go', 'network_resource_consent.h', 'network_resource_consent_core.go'],
  ], ['internal/ynxauth/migration_signing.go', 'internal/ynxbatch/product_pair_pending_original_query.go',
    command + '/source_statement_v2_foreign_controls.go', 'internal/ynxbatch/auth_source_statement_v2.go',
    'internal/ynxbatch/resource_consent.go', 'internal/ynxresourceconsent/consent.go',
    command + '/network_resource_consent_foreign_controls.go', 'internal/ynxresourceconsent/material_attempt.go'],
  {nonExportCgoTranslationUnits: [command + '/source_statement_v2_foreign_controls.go', command + '/network_resource_consent_foreign_controls.go'], resourceBackendImported: true}),
]);

// One separately named successor; the frozen e120 source/profile remains selectable.
const originalCore19 = originalProfiles.find(row => row.id === 'core19/49');
function deepFreeze(value) {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value);}
  return value;
}
export const CORE19_C2_BINDING = deepFreeze({
  id: 'core19-aa60-link42031/49',
  commit: 'aa60e45ee5ab2ae4422f62a8932fe6065ed19dcf', tree: 'ab99445e46339d2376ec1c0b2aae2674b60c1c7f',
  forkTree: '5a128880d14bfc73de4334cba23218859ad3473c',
  linkCommit: '42031b7d6a915b357f81e8faded3434d4c053b1f', linkTree: '2ed56d8c98590900d977a7ff2dba09c70fc2366a',
  inputs: {
    source: {bytes: 61763, sha256: 'dbbab75b29a040f287d9df045595b5726dda378a1578ec9bd2a66a0309ebf53e'},
    composition: {bytes: 66603, sha256: '876101b4f27eaab98ef1bb89e19ed0e3253ddef5b87a9aa2896df311d7017219'},
    fork: {bytes: 420133, sha256: 'b1f474d69f7c8984f5b4c1be5b7723bc1e740a6ff879092d45ff9f314faf94f6'},
    supplier: {bytes: 6307, sha256: 'dc5131cb4ec648359dc93028382b90f16cd3980bcf77fa761d780a4f69f8944d'},
    handoff: {bytes: 11531, sha256: '646fe76bfda29bd1510934eede8b0ac7e0df5d5d7bcc6fc919a3a0cb21af8bf4'},
    authHeaders: {bytes: 1821, sha256: '23ef1ded16ea80dab04f33e3e9d8b0fa6a487364a7d405b2a21f50e38b8ed42d'},
    nativeUndefined: {bytes: 10487, sha256: 'f364837c7f0593ca09a760e97b433c11993d1d976a1eb48256a5abd2cbaea6ba'},
  },
  modules: [
    {repositoryPath: 'go.mod', bytes: 4913, sha256: '07b303f8099eebb861f8ce1671089939e45069efbb1f71884b892548af47f803', gitBlob: '711fee87261c833a6e4cae5c9706d9fd32e9aed4'},
    {repositoryPath: 'go.sum', bytes: 39759, sha256: '87d7280001b2b5e12b687d45e921d5e3500d53b79d3885acf7ab2b9a17cc575c', gitBlob: '940892c107fd2facdd222a07d11f227bb0963473'},
    {repositoryPath: 'third_party/cometbft/go.mod', bytes: 6552, sha256: '265396d8783ee13227b7dcded4787dfc169b86600388e028e3cecdb54a643d59', gitBlob: '9cd25a5e363527c015c81bb5a5b07f64cad25c39'},
    {repositoryPath: 'third_party/cometbft/go.sum', bytes: 51533, sha256: 'daa9e68eab2c225e39a03b624169f17ad31dcf0b3f5c106c2b9df9ac3c9cdbfd', gitBlob: '920f8c3e63d286c702c4a38bbadfcc446466017b'},
  ],
  template: {repositoryPath: command + '/link_transport_import.go', generatedFrom: 'cmd/ynx-secure-link-private-client/combined-entry.go.in',
    bytes: 236, sha256: '4642a221df78dd7ae8f8ff3fc9bd70a6a9c569ec4b823b2ef607505627e7fafe', gitBlob: 'e8af5e76a5c79791755c8de1b188318eedf75173'},
  normalSourceCount: 169, linkSourceCount: 78, forkFileCount: 1456, forkBytes: 60470640,
  neutralCSymbols: ['ynx_ctx_new', 'ynx_ssl_new', 'ynx_handshake', 'ynx_read', 'ynx_write', 'ynx_snapshot', 'ynx_export',
    'ynx_runtime_version', 'ynx_ctx_new_fds', 'ynx_peer_spki_der'],
});
export const CORE_SUPPLY_PROFILES = Object.freeze([...originalProfiles, Object.freeze({...originalCore19,
  id: CORE19_C2_BINDING.id, commit: CORE19_C2_BINDING.commit, tree: CORE19_C2_BINDING.tree,
  preparedComposition: CORE19_C2_BINDING})]);

const requireValue = (value, message) => {if (!value) throw Error('Core supply profile: ' + message);};
const exact = (actual, expected, label) => {
  requireValue(Array.isArray(actual) && actual.every(value => typeof value === 'string') && new Set(actual).size === actual.length &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()), 'closed unique ' + label + ' required');
};
const validPin = row => row && Number.isSafeInteger(row.bytes) && row.bytes > 0 && /^[a-f0-9]{64}$/.test(row.sha256 ?? '') && /^[a-f0-9]{40}$/.test(row.gitBlob ?? '');
const samePin = (a, b) => a.bytes === b.bytes && a.sha256 === b.sha256 && a.gitBlob === b.gitBlob;
function approved(selected) {requireValue(CORE_SUPPLY_PROFILES.includes(selected), 'approved named profile required');}

const core18 = CORE_SUPPLY_PROFILES.find(row => row.id === 'core18/48');
const sourceV2Fields = Object.freeze(['domain UTF8', 'role UTF8', 'independently expected frame UTF8', 'network lowercase hex64 TEXT',
  'owner lowercase0x42 TEXT', 'keyVersion u64 decimal TEXT', 'issuedHeight u64 decimal TEXT', 'canonical bodyOriginal UTF8']);
export const CORE18_SOURCE_V2_LIMITS = Object.freeze({bodyMaximum: 65536, memberMaximum: 262144, messageMaximum: 66267,
  requestBytes64Bit: 176, resultBytes64Bit: 32});
const core18PatchPins = Object.freeze({
  combinedIntegrationPatch: [34500, '96a0078b16f6c4b95578f21fcf4fc828b5e7169a723016dd160812bf8d2198bd'],
  mathPatch: [31445, '95a2209c64fb5b62221feabe498b25db406395873dc9080913131e34ff54cb65'],
  normalCIDelta: [3055, '03811d635c41d4d45c8c26adfc0e092d1c275c70b4440f548628d5bb562b7ede'],
  frozenMathH: [11628, 'fcb54edb382140c43795ae171a50de6bb6107722e65571db3e94cf772565f4c5'],
});
const core18MathPaths = new Set([command + '/auth_source_statement_v2.h', command + '/registered_n1_verify_core.go',
  command + '/source_statement_v2_bridge.go', command + '/source_statement_v2_core.go',
  command + '/source_statement_v2_foreign_controls.go', 'internal/ynxbatch/auth_source_statement_v2.go']);
const clone = value => structuredClone(value);

// This is an explicit derived view, not a change to what the frozen supplier H
// claimed. The builder still verifies every byte against the approved f27 tree.
export function normalizeCoreSupply(raw) {
  if (raw?.schema === 'YNX-CORE19-EXACT-GIT-SOURCE/v1') return normalizeCore19Supply(raw);
  if (raw?.version !== 1) return {supply: raw, provenance: {derivedViewOnly: false, rawSchemaVersion: raw?.version}};
  requireValue(raw.state === 'CORE18_PUBLIC_SOURCE_CARRIER_BASE_PLUS_FROZEN_DELTA_NO_ARCHIVE' &&
    raw.source === undefined && raw.actualCounts === undefined && raw.productionPackageClosure === undefined &&
    raw.actualCommit === undefined && raw.postCommit === undefined && raw.candidateCommit === undefined, 'Core18 raw schema/provenance required');
  const identity = raw.sourceIdentity;
  exact(Object.keys(identity ?? {}), ['baseCommit', 'baseTree', 'candidateCommit', 'candidateTreeClaimed',
    'combinedIntegrationPatch', 'frozenMathH', 'fullSourceRoot', 'mathPatch', 'normalCIDelta'], 'Core18 sourceIdentity keys');
  requireValue(identity.baseCommit === '06c787b2545364875b6f4e3668a6dadb084ea01b' &&
    identity.baseTree === 'c5355ef1c0a22c7ed979901b937b532f37478cf2' && identity.candidateCommit === null &&
    identity.candidateTreeClaimed === false && typeof identity.fullSourceRoot === 'string' && identity.fullSourceRoot.length > 0,
  'Core18 original base/no-candidate provenance required');
  for (const [key, [bytes, sha256]] of Object.entries(core18PatchPins)) requireValue(identity[key]?.bytes === bytes &&
    identity[key]?.sha256 === sha256 && typeof identity[key]?.path === 'string' && identity[key].path.length > 0,
  'Core18 fixed patch provenance required: ' + key);
  const rowPin = row => {
    requireValue(row?.candidateCommitClaimed === false && row.gitBlob === undefined && validPin({...row, gitBlob: row.candidateGitBlob}),
      'Core18 raw candidate pin/no commit claim required: ' + row?.path);
    const mathematical = core18MathPaths.has(row.path);
    requireValue(row.sourceOrigin === (mathematical ? 'FROZEN_CORE_MATH_DELTA' : 'BASE_GIT_OBJECT'), 'Core18 source origin required: ' + row.path);
    if (!mathematical) requireValue(validPin(row.baseGit) && samePin(row.baseGit, {...row, gitBlob: row.candidateGitBlob}),
      'Core18 base Git provenance required: ' + row.path);
    else if (row.path === command + '/registered_n1_verify_core.go') requireValue(row.baseGit?.bytes === 4188 &&
      row.baseGit?.gitBlob === 'c44f5850ab7b7afab142783c77dca522d55456c0' &&
      row.baseGit?.sha256 === '4238f3ec2e1e231635bf82863941ef04e4d23f52d2a936db567c5dc0814cb3fc', 'Core18 replaced original N1 provenance required');
    else requireValue(row.baseGit === null, 'Core18 new mathematical source has no base Git claim');
    return {...clone(row), gitBlob: row.candidateGitBlob, gitBindingOrigin: 'DERIVED_EXPECTED_BLOB_FOR_FIXED_POSTCOMMIT_VERIFICATION'};
  };
  requireValue(Array.isArray(raw.sources) && Array.isArray(raw.exports), 'Core18 complete raw source/exports required');
  exact(raw.sources.map(row => row?.path), core18.sourcePaths, 'Core18 raw source paths');
  exact(raw.exports.map(row => row?.symbol), core18.symbols, 'Core18 raw export identities');
  const sources = raw.sources.map(rowPin);
  const exports = raw.exports.map(row => ({...clone(row), ...Object.fromEntries(['bridge', 'header', 'implementation'].map(key => [key, rowPin(row[key])]))}));
  const delivery = raw.delivery;
  requireValue(delivery?.sourceLeaves === 83 && delivery.productionGo === 65 && delivery.handHeaders === 16 && delivery.includeGuards === 16 &&
    delivery.coreExports === 18 && delivery.cgoTranslationUnits === 17 && delivery.cgoExportBridgeUnits === 16 && delivery.publicStaticCControlUnits === 1 &&
    typeof delivery.sources === 'string' && delivery.sources.length > 0, 'Core18 full83/65/16/17 delivery required');
  exact(raw.cgoTranslationUnits, core18.cgoTranslationUnits, 'Core18 cgo translation units including static control');
  const module = raw.moduleContext;
  requireValue(module?.sourceCommit === undefined && module?.sourceTree === undefined && module?.moduleChangedHere === false &&
    module?.forkTree === '54e88e6aba735eaceeb2d00bb40731248c673bd7' && Array.isArray(module.changedSinceCore17) && module.changedSinceCore17.length === 0,
  'Core18 original module provenance required');
  exact(module.descriptors?.map(row => row?.repositoryPath), modulePaths, 'Core18 descriptor paths');
  const descriptors = module.descriptors?.map(row => ({...rowPin(row), path: row.carrierPath}));
  const closure = raw.actualDependencyClosure;
  requireValue(closure?.CGO_ENABLED === 1 && closure.GOOS === 'darwin' && closure.GOARCH === 'arm64' && closure.compileOrTest === false &&
    closure.coreCommandRecursivePackages === 4 && closure.unionPackages === 5 && closure.resourceConsentAlreadyImportedByCoreCommand === false &&
    closure.resourceConsentSeparateExplicitRoot === true, 'Core18 explicit metadata union is not normal backend import');
  exact(Object.keys(closure.packages ?? {}), core18.packagePaths, 'Core18 union package paths');
  const productionPackageClosure = Object.fromEntries(Object.entries(closure.packages).map(([name, row]) => {
    requireValue(Array.isArray(row.GoFiles) && Array.isArray(row.CgoFiles), 'Core18 package Go/cgo inventories required');
    const paths = [...row.GoFiles, ...row.CgoFiles];
    return [name, {paths, goFiles: paths.length}];
  }));
  const v2 = raw.sourceV2Integration;
  const v2Header = sources.find(row => row.path === command + '/auth_source_statement_v2.h');
  requireValue(v2?.symbol === 'YNXAuthSourceStatementVerifyV2' && v2.version === 1 && v2.domain === 'YNX/AUTH/SOURCE-ORIGINAL/V2' &&
    Object.entries(CORE18_SOURCE_V2_LIMITS).every(([key, value]) => v2[key] === value) &&
    JSON.stringify(v2.fixedPurposeByRole) === JSON.stringify({'1': 'AUTH-SOURCE-ENROLLMENT', '2': 'AUTH-SOURCE-PROFILE', '3': 'AUTH-SOURCE-CURRENT'}) &&
    JSON.stringify(v2.fields8) === JSON.stringify(sourceV2Fields), 'Core18 exact Source-v2 typed capacity/E8 contract required');
  requireValue(v2.header?.bytes === v2Header?.bytes && v2.header?.sha256 === v2Header?.sha256, 'Core18 Source-v2 header provenance required');
  requireValue(raw.exports.every(row => row.machOSymbol === '_' + row.symbol), 'Core18 exact Mach-O export identities required');
  const composition = raw.singleRuntimeComposition;
  requireValue(composition?.originalCommandPackage === command && composition.expectedCombinedCount === 48 && composition.doNotLinkTwoGoArchives === true &&
    composition.noNewMain === true && composition.unchangedLINKCountProvidedByRoot === 22 && composition.unchangedProductCountProvidedByRoot === 8,
  'Core18 sole original runtime composition required');
  return {supply: {version, source: {commit: core18.commit, tree: core18.tree, module: 'github.com/JiahaoAlbus/YNX-Chain', go: '1.26.10'},
    LINKReadOnlyComposition: {sourceCommit: baseLINKCommit}, sources, exports, delivery: {...clone(delivery), sourceDirectory: delivery.sources},
    moduleContext: {...clone(module), sourceCommit: core18.commit, sourceTree: core18.tree, descriptors}, productionPackageClosure,
    actualCounts: {sourceLeaves: 83, productionGo: 65, handHeaders: 16, exportedSymbols: 18,
      cgoTranslationUnits: 17, cgoTranslationUnitPaths: [...raw.cgoTranslationUnits]}},
  provenance: {derivedViewOnly: true, rawSchemaVersion: raw.version, actualCommit: core18.commit, actualTree: core18.tree,
    candidateCommitClaimed: false, rawSourceIdentity: clone(identity), rawDelivery: clone(delivery),
    rawDependencyClosure: clone(closure), rawSingleRuntimeComposition: clone(composition),
    sourceRowProvenance: raw.sources.map(({path, sourceOrigin, candidateGitBlob, candidateCommitClaimed, baseGit}) =>
      ({path, sourceOrigin, candidateGitBlob, candidateCommitClaimed, baseGit: clone(baseGit)}))}};
}

function normalizeCore19Supply(raw) {
  const selected = CORE_SUPPLY_PROFILES.find(row => row.coreExports === 19 && row.commit === raw.commit && row.tree === raw.tree);
  requireValue(selected, 'approved exact Core19 commit/tree identity required');
  const originalFork = selected.preparedComposition?.forkTree ?? '54e88e6aba735eaceeb2d00bb40731248c673bd7';
  requireValue(raw.productionLeafCount === 88 &&
    raw.originalCometForkTree === originalFork && raw.moduleContextIsDescriptorOnly === true &&
    raw.normalOriginalModuleAndForkRequired === true && raw.goModReplaceNotRemovedOrStubbed === true &&
    raw.archiveIncluded === false && raw.freshCIQualified === false, 'exact committed Core19 source-only original required');
  requireValue(Array.isArray(raw.sources), 'complete Core19 source rows required');
  exact(raw.sources.map(row => row?.repositoryPath), selected.sourcePaths, 'Core19 source paths');
  const roots = new Set();
  const sources = raw.sources.map(row => {
    requireValue(validPin(row) && row.gitMode === '100644' && typeof row.path === 'string' &&
      row.path.endsWith('/' + row.repositoryPath) && row.path.startsWith('/'), 'Core19 actual Git source pin required');
    roots.add(row.path.slice(0, -row.repositoryPath.length));
    return {...clone(row), originalCarrierPath: row.path, path: row.repositoryPath};
  });
  requireValue(roots.size === 1, 'one original Core19 source carrier required');
  const sourceDirectory = [...roots][0].slice(0, -1), byPath = new Map(sources.map(row => [row.path, row]));
  const closure = raw.productionClosure;
  requireValue(closure?.rootPackage === command && closure.singleExplicitRoot === true && closure.resourceConsentActuallyImported === true &&
    closure.blankImport === false && closure.packageCount === 5 && closure.goFileCount === 69 && closure.headerCount === 17 &&
    closure.productionLeafCount === 88 && closure.cgoTranslationUnitCount === 19 && closure.exportCount === 19 && closure.guardCount === 17 &&
    closure.currentExactGitImportsIndependentlyRewalked === true && closure.allPackageProductionFilesCheckedAgainstExactTree === true &&
    closure.freshGoListRun === false && closure.freshGoTestRun === false, 'Core19 original static closure is not fresh command execution');
  exact(Object.keys(closure.packages ?? {}), selected.packagePaths, 'Core19 exact package paths');
  exact(closure.cgoTranslationUnits, selected.cgoTranslationUnits, 'Core19 export and static cgo units');
  exact(closure.exports?.map(row => row?.symbol), selected.symbols, 'Core19 export names');
  const exports = selected.bindings.map(binding => {
    requireValue(closure.exports.find(row => row.symbol === binding.symbol)?.source === binding.bridge, 'Core19 export bridge required');
    return {symbol: binding.symbol, ...Object.fromEntries(['bridge', 'header', 'implementation'].map(key => [key, clone(byPath.get(binding[key]))]))};
  });
  const productionPackageClosure = Object.fromEntries(Object.entries(closure.packages).map(([name, row]) => {
    requireValue(row.importPath === 'github.com/JiahaoAlbus/YNX-Chain/' + name && Array.isArray(row.productionGoFiles) &&
      Array.isArray(row.imports) && row.actualPriorGoListSelectionUnchanged === true && row.exactGitTreeAllProductionGoFilesMatch === true,
    'Core19 exact package inventory required');
    return [name, {paths: clone(row.productionGoFiles), goFiles: row.productionGoFiles.length}];
  }));
  const imports = closure.packages[command].imports;
  requireValue(imports.includes('github.com/JiahaoAlbus/YNX-Chain/internal/ynxresourceconsent'), 'Core19 direct resource backend import required');
  exact(raw.moduleContext?.map(row => row?.repositoryPath), modulePaths, 'Core19 descriptor paths');
  for (const row of raw.moduleContext) requireValue(validPin(row) && row.gitMode === '100644' && typeof row.path === 'string' && row.path.startsWith('/'), 'Core19 descriptor Git pin required');
  return {supply: {version, source: {commit: selected.commit, tree: selected.tree, module: 'github.com/JiahaoAlbus/YNX-Chain', go: '1.26.10'},
    LINKReadOnlyComposition: {sourceCommit: selected.preparedComposition?.linkCommit ?? baseLINKCommit}, sources, exports, delivery: {sourceDirectory},
    moduleContext: {sourceCommit: selected.commit, sourceTree: selected.tree, originalReplace: 'github.com/cometbft/cometbft => ./third_party/cometbft',
      stubModule: false, descriptors: clone(raw.moduleContext)}, productionPackageClosure,
    actualCounts: {sourceLeaves: 88, productionGo: 69, handHeaders: 17, exportedSymbols: 19, cgoTranslationUnits: 19,
      cgoTranslationUnitPaths: clone(closure.cgoTranslationUnits)}},
  provenance: {derivedViewOnly: true, rawSchema: raw.schema, actualCommit: raw.commit, actualTree: raw.tree,
    sourceReadMethod: raw.sourceReadMethod, rawDependencyClosure: clone(closure), rawAuthority: clone(raw.authority),
    sourceRowProvenance: clone(raw.sources), rawModuleContext: clone(raw.moduleContext), freshCommandClosureClaimedBySupplier: false,
    fixedResourceCABIBackendSupplied: true, protectedAuthNativeFactoryQualified: false}};
}

/** Pure metadata gate, called before creating any build output. */
export function selectCoreSupplyProfile(raw) {
  const {supply: core} = normalizeCoreSupply(raw);
  requireValue(core?.version === version && core.source?.module === 'github.com/JiahaoAlbus/YNX-Chain' && core.source?.go === '1.26.10', 'original module/toolchain/LINK contract required');
  requireValue(Array.isArray(core.exports), 'declared exports required');
  const selected = CORE_SUPPLY_PROFILES.find(row => row.commit === core.source.commit && row.tree === core.source.tree);
  requireValue(selected && (selected !== core18 || raw.version === 1) &&
    (selected.coreExports !== 19 || raw.schema === 'YNX-CORE19-EXACT-GIT-SOURCE/v1'), 'approved Core15, Core17, raw Core18 or exact Core19 commit/tree identity required');
  requireValue(core.LINKReadOnlyComposition?.sourceCommit === (selected.preparedComposition?.linkCommit ?? baseLINKCommit), 'profile-specific original LINK contract required');
  exact(core.exports.map(row => row?.symbol), selected.symbols, 'Core export identities');
  requireValue(Array.isArray(core.sources), 'complete source pins required');
  exact(core.sources.map(row => row?.path), selected.sourcePaths, 'Core source paths');
  const sources = new Map(core.sources.map(row => [row.path, row]));
  requireValue(core.sources.every(validPin), 'complete source byte/hash/Git pins required');
  for (const expected of selected.bindings) {
    const row = core.exports.find(row => row.symbol === expected.symbol);
    for (const kind of ['bridge', 'header', 'implementation']) requireValue(row[kind]?.path === expected[kind] &&
      samePin(row[kind], sources.get(expected[kind])), expected.symbol + ' fixed ' + kind + ' identity/pin required');
  }
  const descriptors = core.moduleContext?.descriptors;
  requireValue(Array.isArray(descriptors), 'four original module descriptors required');
  exact(descriptors.map(row => row?.repositoryPath), modulePaths, 'module descriptor paths');
  requireValue(descriptors.every(validPin), 'complete descriptor byte/hash/Git pins required');
  for (const row of descriptors) if (sources.has(row.repositoryPath)) requireValue(samePin(row, sources.get(row.repositoryPath)), 'root module descriptor/source mismatch');
  requireValue(core.moduleContext.sourceCommit === selected.commit && core.moduleContext.sourceTree === selected.tree &&
    core.moduleContext.originalReplace === 'github.com/cometbft/cometbft => ./third_party/cometbft' && core.moduleContext.stubModule === false,
  'same original module/replacement context required');
  if (selected.preparedComposition) for (const expected of selected.preparedComposition.modules) {
    requireValue(samePin(descriptors.find(row => row.repositoryPath === expected.repositoryPath), expected), 'fixed successor module descriptor required: ' + expected.repositoryPath);
  }
  exact(Object.keys(core.productionPackageClosure ?? {}), selected.packagePaths, 'production package paths');
  for (const name of selected.packagePaths) {
    const paths = selected.sourcePaths.filter(row => row.startsWith(name + '/') && row.endsWith('.go'));
    const supplied = core.productionPackageClosure[name];
    exact(supplied?.paths, paths, name + ' production Go closure');
    requireValue(supplied.goFiles === paths.length, name + ' Go count mismatch');
  }
  const counts = core.actualCounts;
  // The original Core15 H predates actualCounts. Its exact source/header/export
  // inventories above still determine all counts; Core17 supplies this new block.
  if (counts !== undefined || selected.id === 'core17/47') {
    requireValue(counts?.sourceLeaves === selected.sourcePaths.length && counts.productionGo === selected.sourcePaths.filter(name => name.endsWith('.go')).length &&
      counts.handHeaders === selected.headers.length && counts.exportedSymbols === selected.coreExports && counts.cgoTranslationUnits === selected.cgoTranslationUnits.length,
    'declared source/header/export counts do not match closed profile');
    exact(counts.cgoTranslationUnitPaths, selected.cgoTranslationUnits, 'cgo translation units');
  }
  return selected;
}

/** Fixed metadata only. The recipe pins every JSON byte before passing values,
 * then independently verifies/materializes the full Git inventories below. */
export function verifyCore19C2Recipe(selected, inputs, {linkCommit, linkTree, linkPaths}) {
  approved(selected);
  const binding = selected.preparedComposition;
  requireValue(binding === CORE19_C2_BINDING, 'prepared exact C2 profile required');
  for (const [key, expected] of Object.entries(binding.inputs)) {
    const actual = inputs[key]?.descriptor;
    requireValue(actual?.bytes === expected.bytes && actual.sha256 === expected.sha256, 'fixed C2 ' + key + ' input pin required');
  }
  requireValue(selectCoreSupplyProfile(inputs.source.value) === selected && linkCommit === binding.linkCommit && linkTree === binding.linkTree,
    'fixed Core/LINK C2 identity required');
  const c = inputs.composition.value, fork = inputs.fork.value, supplier = inputs.supplier.value;
  requireValue(c.schema === 'YNX-SINGLE49-FINITE7-SOURCE-COMPOSITION/v1' && c.sourceOnly === true &&
    c.coreCommit === selected.commit && c.coreTree === selected.tree && c.linkCommit === linkCommit && c.linkTree === linkTree &&
    c.normalProducerSourceCount === binding.normalSourceCount && c.generatedImportIsOriginalTemplate === true &&
    c.GoExportsIdenticalToOld49Source === true && c.newArchiveBuilt === false && c.neutralCSymbolsAreNotNewGoExports === true,
    'complete source-only C2 composition required');
  for (const [row, expected] of [[c.coreSource, binding.inputs.source], [c.fullOriginalFork, binding.inputs.fork]])
    requireValue(row?.bytes === expected.bytes && row.sha256 === expected.sha256, 'composition dependency pin mismatch');
  requireValue(supplier.schema === 'YNX-SINGLE49-FINITE7-NORMAL-PRODUCER-INPUTS/v1' && supplier.sourceReady === true &&
    supplier.archiveReady === false && supplier.requestedSuccessorCount === 1 && supplier.oldArchivesAndImagesImmutable === true,
    'single source-only supplier contract required');
  const required = supplier.normalArchiveProducer?.currentlyRequiredOwnerCODE;
  requireValue(required?.requiredCoreCommit === selected.commit && required.requiredCoreTree === selected.tree &&
    required.requiredForkTree === binding.forkTree && required.requiredLINKCommit === linkCommit && required.requiredLINKTree === linkTree &&
    required.requiredRawSource?.sha256 === binding.inputs.source.sha256 && required.requiredRawSource.bytes === binding.inputs.source.bytes,
    'supplier exact successor tuple required');
  for (const [key, label] of [['authHeaders', 'AuthBuildHeaderInputs'], ['nativeUndefined', 'NativeOriginalUndefined']]) {
    const expected = binding.inputs[key];
    for (const owner of [c.originalBuildInputs, supplier.originalBuildInputPins]) requireValue(owner?.[label]?.bytes === expected.bytes &&
      owner[label].sha256 === expected.sha256, 'original C2 build input mismatch: ' + label);
  }
  requireValue(c.expectedGoABI?.Core === 19 && c.expectedGoABI.LINK === 22 && c.expectedGoABI.Product === 8 &&
    c.expectedGoABI.total === 49 && c.expectedGoABI.runtime === 1, 'unchanged C2 single-Go49 ABI required');
  exact([...Object.keys(c.neutralCOldDeclarations ?? {}), ...Object.keys(c.neutralCNewDeclarations ?? {})], binding.neutralCSymbols, 'neutral C declarations');
  requireValue(Array.isArray(linkPaths) && linkPaths.length === binding.linkSourceCount && linkPaths.every(name =>
    typeof name === 'string' && (name.startsWith('internal/securelink/') || ['cmd/ynx-secure-link-caller/private_client_v1.h',
      'cmd/ynx-secure-link-caller/private_client_startup_v1.h'].includes(name))), 'full original LINK C2 tree required');
  const normalized = normalizeCoreSupply(inputs.source.value).supply;
  const coreRows = new Map([...normalized.sources.map(row => [row.path, row]),
    ...normalized.moduleContext.descriptors.map(row => [row.repositoryPath, row])]);
  const expectedPaths = [...coreRows.keys(), ...linkPaths, binding.template.repositoryPath];
  exact(c.normalProducerSources?.map(row => row?.repositoryPath), expectedPaths, '169 normal producer inputs');
  requireValue(expectedPaths.length === binding.normalSourceCount, 'normal source inventory count required');
  for (const row of c.normalProducerSources) {
    requireValue(validPin(row), 'original normal source byte/hash/Git pin required');
    const original = coreRows.get(row.repositoryPath);
    if (original) requireValue(row.owner === 'Core' && row.commit === selected.commit && samePin(row, original), 'same original Core composition row required');
    else if (row.repositoryPath === binding.template.repositoryPath) requireValue(row.owner === 'LINK original composition template' &&
      row.commit === linkCommit && row.generatedFrom === binding.template.generatedFrom && samePin(row, binding.template), 'fixed original blank-import template required');
    else requireValue(row.owner === 'LINK' && row.commit === linkCommit, 'complete same-commit LINK C2 composition required');
  }
  requireValue(fork.commit === selected.commit && fork.tree === binding.forkTree && fork.filesAreOriginalCommittedPublicSource === true &&
    fork.notAdditionalArchiveRoot === true && fork.noFakeGitOrStub === true && Array.isArray(fork.files) &&
    fork.files.length === binding.forkFileCount, 'complete original replacement fork required');
  const forkPaths = fork.files.map(row => row?.repositoryPath);
  requireValue(new Set(forkPaths).size === forkPaths.length && fork.files.every(row => typeof row.repositoryPath === 'string' &&
    /^third_party\/cometbft\/[A-Za-z0-9_./@+-]+$/.test(row.repositoryPath) &&
    row.repositoryPath.split('/').every(part => part !== '' && part !== '.' && part !== '..') &&
    row.gitMode === '100644' && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && /^[a-f0-9]{64}$/.test(row.sha256 ?? '') &&
    /^[a-f0-9]{40}$/.test(row.gitBlob ?? '')), 'unique regular original fork pins required');
  requireValue(fork.files.reduce((sum, row) => sum + row.bytes, 0) === binding.forkBytes, 'complete fork byte total required');
  for (const expected of binding.modules.filter(row => row.repositoryPath.startsWith('third_party/')))
    requireValue(samePin(fork.files.find(row => row.repositoryPath === expected.repositoryPath) ?? {}, expected), 'fork descriptor/composition mismatch');
  return {profile: selected.id, normalSourceInputs: expectedPaths.length, linkSourceInputs: linkPaths.length,
    forkFiles: fork.files.length, forkBytes: binding.forkBytes, materializedSourceLeaves: expectedPaths.length + fork.files.length - 2,
    sourceOnly: true, normalNativeImageVerified: false, RootAdmission: false, SourceAdmission: false};
}

// The original 49-symbol/single-runtime gate remains separate. This narrow
// supplement follows that gate's nm -g plus mandatory nm -m strong-function rule.
export function verifyCore19C2NeutralSymbols(selected, plain, macho) {
  approved(selected);
  requireValue(selected.preparedComposition === CORE19_C2_BINDING && typeof plain === 'string' && typeof macho === 'string', 'C2 nm readback required');
  return CORE19_C2_BINDING.neutralCSymbols.map(symbol => {
    const key = '_' + symbol;
    const rows = plain.split('\n').map(line => line.trim().split(/\s+/)).filter(parts => parts.at(-1) === key && parts.at(-2) !== 'U');
    const attrs = macho.split('\n').filter(line => line.trim().split(/\s+/).at(-1) === key);
    const definitions = attrs.filter(line => !/\bundefined\b/.test(line));
    requireValue(rows.length === 1 && rows[0].at(-2) === 'T' && definitions.length === 1 &&
      !attrs.some(line => /\bweak\b/.test(line)), 'missing/weak/undefined/duplicate neutral C strong callee: ' + symbol);
    return {symbol, type: 'T', definition: definitions[0].trim(), undefinedReferences: attrs.length - definitions.length};
  });
}

function verifiedBytes(row, bytes, label) {
  requireValue(Buffer.isBuffer(bytes), 'owned original bytes required: ' + label);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const gitBlob = createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
  requireValue(bytes.length === row.bytes && sha256 === row.sha256 && gitBlob === row.gitBlob, 'original bytes/hash/Git mismatch: ' + label);
}

/** Independently reads declarations from all supplied bytes, including internal
 * packages. The builder separately binds each row.gitBlob to the fixed Git tree. */
export function verifyCoreSupplyBytes(raw, selected, sourceBytes, descriptorBytes) {
  approved(selected);
  requireValue(selectCoreSupplyProfile(raw) === selected, 'selected metadata changed');
  const {supply: core} = normalizeCoreSupply(raw);
  requireValue(sourceBytes instanceof Map && descriptorBytes instanceof Map, 'complete owned source/descriptor maps required');
  exact([...sourceBytes.keys()], selected.sourcePaths, 'read source paths');
  exact([...descriptorBytes.keys()], modulePaths, 'read module paths');
  const actual = [], headers = [], mains = [], cgo = [];
  for (const row of core.sources) {
    const bytes = sourceBytes.get(row.path);
    verifiedBytes(row, bytes, row.path);
    const text = bytes.toString('utf8');
    if (row.path.endsWith('.go')) {
      if (/^import\s+"C"\s*$/m.test(text)) cgo.push(row.path);
      for (const match of text.matchAll(/^\/\/export\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/gm)) actual.push({symbol: match[1], path: row.path});
      for (const match of text.matchAll(/^func\s+main\s*\(\s*\)\s*\{/gm)) mains.push(row.path);
    }
    if (row.path.endsWith('.h')) {
      const declarations = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const match of declarations.matchAll(/\bint32_t\s+(YNX[A-Za-z0-9_]*)\s*\(/g)) headers.push({symbol: match[1], path: row.path});
    }
  }
  exact(actual.map(row => row.symbol), selected.symbols, 'actual source //export declarations');
  exact(headers.map(row => row.symbol), selected.symbols, 'actual hand-header declarations');
  for (const binding of selected.bindings) {
    requireValue(actual.find(row => row.symbol === binding.symbol).path === binding.bridge, 'actual export in wrong bridge: ' + binding.symbol);
    requireValue(headers.find(row => row.symbol === binding.symbol).path === binding.header, 'actual declaration in wrong header: ' + binding.symbol);
  }
  exact(mains, [command + '/core.go'], 'sole original Core main');
  if (selected === core18 || selected.coreExports === 19) {
    exact(cgo, selected.cgoTranslationUnits, 'actual Core18 cgo translation units including static control');
    for (const name of selected.nonExportCgoTranslationUnits) requireValue(!actual.some(row => row.path === name), 'static cgo control may not add an export');
    const header = sourceBytes.get(command + '/auth_source_statement_v2.h').toString('utf8');
    for (const [macro, value] of [['ABI_V1', 1], ['BODY_MAX_V2', 65536], ['MEMBER_MAX_V2', 262144]]) requireValue(
      new RegExp('^#define\\s+YNX_AUTH_SOURCE_STATEMENT_' + macro + '\\s+' + value + 'u\\s*$', 'm').test(header), 'actual Source-v2 header capacity required: ' + macro);
    requireValue(/sizeof\(YNXAuthSourceStatementVerifyRequestV2\)\s*==\s*176/.test(header), 'actual Source-v2 request176 declaration required');
    for (const [field, offset] of [['member', 16], ['key_version', 128], ['enabled', 168]]) requireValue(
      new RegExp('offsetof\\(YNXAuthSourceStatementVerifyRequestV2,\\s*' + field + '\\)\\s*==\\s*' + offset).test(header),
      'actual Source-v2 header layout required: ' + field);
  }
  for (const row of core.moduleContext.descriptors) {
    verifiedBytes(row, descriptorBytes.get(row.repositoryPath), row.repositoryPath);
    if (sourceBytes.has(row.repositoryPath)) requireValue(sourceBytes.get(row.repositoryPath).equals(descriptorBytes.get(row.repositoryPath)), 'descriptor/source bytes differ');
  }
  return {profile: selected.id, coreExports: selected.coreExports, totalExports: selected.totalExports,
    sourceLeaves: selected.sourcePaths.length, handHeaders: selected.headers.length, descriptors: modulePaths.length};
}

/** Additional closed-profile check after the existing strong/single-runtime gate. */
export function verifyCombinedSupplyResult(selected, result) {
  approved(selected);
  exact(result?.coreExports, selected.symbols, 'strong Core export identities');
  requireValue(result.linkExports?.length === 22 && result.productExports?.length === 8 && result.symbols?.length === selected.totalExports,
    selected.id + ' requires complete Core' + selected.coreExports + ', LINK22 and Product8 strong ABI');
}

function jsonSequence(text) {
  requireValue(typeof text === 'string' && Buffer.byteLength(text) <= 64 << 20, 'bounded original go-list JSON stream required');
  const rows = [];
  let start = 0;
  while (start < text.length) {
    while (/\s/.test(text[start] ?? '') && start < text.length) start++;
    if (start === text.length) break;
    requireValue(text[start] === '{' && rows.length < 4096, 'original go-list object sequence required');
    let depth = 0, quoted = false, escape = false, end = start;
    for (; end < text.length; end++) {
      const char = text[end];
      if (quoted) {
        if (escape) escape = false;
        else if (char === '\\') escape = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {end++; break;}
    }
    requireValue(depth === 0 && !quoted && end > start, 'complete original go-list object required');
    rows.push(JSON.parse(text.slice(start, end))); start = end;
  }
  requireValue(rows.length > 0, 'nonempty original go-list dependency output required');
  return rows;
}

/** Inspect the ACTUAL original command root, not a union of separately listed roots. */
export function verifyCoreCommandDependencyClosure(selected, text) {
  approved(selected);
  const rows = jsonSequence(text), byPath = new Map(), prefix = 'github.com/JiahaoAlbus/YNX-Chain/';
  for (const row of rows) {
    requireValue(row && typeof row.ImportPath === 'string' && !byPath.has(row.ImportPath) && !row.Error && !row.Incomplete &&
      (!row.DepsErrors || row.DepsErrors.length === 0), 'unique successful actual go-list package required');
    requireValue(row.DepOnly === undefined || typeof row.DepOnly === 'boolean', 'actual go-list DepOnly boolean required');
    requireValue(Array.isArray(row.Imports ?? []) && (row.Imports ?? []).every(name => typeof name === 'string'), 'actual go-list imports required');
    byPath.set(row.ImportPath, row);
  }
  const main = byPath.get(prefix + command);
  requireValue(main?.Name === 'main' && main.DepOnly !== true, 'actual original main package root required');
  const commandRoots = rows.filter(row => row.DepOnly !== true).map(row => row.ImportPath);
  exact(commandRoots, [main.ImportPath], 'single original command root');
  const link = prefix + 'internal/securelink';
  requireValue((main.Imports ?? []).includes(link), 'original main must directly import its LINK transport package');
  const reached = new Set(), pending = [main.ImportPath];
  while (pending.length) {
    const name = pending.pop();
    if (reached.has(name) || name === 'C') continue;
    const row = byPath.get(name);
    requireValue(row, 'actual imported package missing from go-list output: ' + name);
    reached.add(name); pending.push(...(row.Imports ?? []));
  }
  requireValue(reached.has(link), 'actual LINK transport package must be reachable from original main');
  const corePackages = [...reached].filter(name => name.startsWith(prefix) && selected.packagePaths.includes(name.slice(prefix.length))).map(name => name.slice(prefix.length)).sort();
  exact(corePackages, selected.normalPackagePaths, 'actual command Core dependency closure');
  for (const name of selected.normalPackagePaths) {
    const row = byPath.get(prefix + name);
    const expected = selected.sourcePaths.filter(p => p.startsWith(name + '/') && p.endsWith('.go')).map(p => p.slice(name.length + 1));
    if (name === command) expected.push('link_transport_import.go');
    exact([...(row.GoFiles ?? []), ...(row.CgoFiles ?? [])], expected, 'actual ' + name + ' Go/cgo files');
  }
  const resource = prefix + 'internal/ynxresourceconsent';
  requireValue(reached.has(resource) === selected.resourceBackendImported, 'actual fixed resource backend reachability differs from named profile');
  return {profile: selected.id, actualCommandRoot: main.ImportPath, totalPackages: rows.length,
    commandRoots, LINKTransportDirectImport: true, LINKTransportReachable: true,
    coreCommandReachablePackages: corePackages, reachableLocalPackages: [...reached].filter(name => name.startsWith(prefix)).sort(),
    resourceConsentPackageSuppliedSeparately: selected === core18, resourceConsentAlreadyImportedByCoreCommand: reached.has(resource),
    separateResourceRootInOutput: byPath.has(resource) && byPath.get(resource).DepOnly !== true,
    normalResourceBinder: reached.has(resource) ? 'FIXED_CORE_CABI_REACHABLE_PROTECTED_AUTH_NATIVE_FACTORY_NOT_QUALIFIED' : 'NOT_SUPPLIED',
    meaning: 'Actual import traversal only; protected Native keeper, policy, decision, durable once and Source authority remain independently qualified.'};
}

/** Public golden byte/capacity diagnostic, never a signature or Source verifier. */
export function diagnoseSourceV2Golden(golden) {
  requireValue(golden?.PUBLIC_ONLY === true && Array.isArray(golden.vectors), 'PUBLIC Source-v2 golden required');
  exact(golden.vectors.map(row => row.role), ['enrollment', 'profile', 'current'], 'Source-v2 golden roles');
  const decimal = (value, positive) => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) &&
    BigInt(value) <= (1n << 64n) - 1n && (!positive || value !== '0');
  const decode = (text, maximum) => {
    requireValue(typeof text === 'string' && text.length <= Math.ceil(maximum * 4 / 3) && /^[A-Za-z0-9_-]+$/.test(text), 'bounded canonical base64url golden required');
    const bytes = Buffer.from(text, 'base64url');
    requireValue(bytes.length <= maximum && bytes.toString('base64url') === text, 'canonical base64url golden required');
    return bytes;
  };
  const vectors = golden.vectors.map(row => {
    const binding = row.binding;
    requireValue(binding && /^[a-f0-9]{64}$/.test(binding.networkId ?? '') && /^0x[a-f0-9]{40}$/.test(binding.owner ?? '') &&
      decimal(binding.keyVersion, true) && decimal(binding.executionHeight, false) && typeof row.frame === 'string' &&
      Buffer.byteLength(row.frame) >= 1 && Buffer.byteLength(row.frame) <= 512 && !row.frame.includes('\0') && typeof row.bodyOriginal === 'string' &&
      Buffer.byteLength(row.bodyOriginal) >= 1 && Buffer.byteLength(row.bodyOriginal) <= CORE18_SOURCE_V2_LIMITS.bodyMaximum,
    'Source-v2 golden typed binding/capacity required');
    const fields = ['YNX/AUTH/SOURCE-ORIGINAL/V2', row.role, row.frame, binding.networkId, binding.owner,
      binding.keyVersion, binding.executionHeight, row.bodyOriginal].map(value => Buffer.from(value));
    const count = Buffer.alloc(4); count.writeUInt32BE(8);
    const expected = Buffer.concat([count, ...fields.flatMap(field => {const length = Buffer.alloc(4); length.writeUInt32BE(field.length); return [length, field];})]);
    const message = decode(row.messageBase64url, CORE18_SOURCE_V2_LIMITS.messageMaximum);
    const member = decode(row.memberBase64url, CORE18_SOURCE_V2_LIMITS.memberMaximum);
    const sha = bytes => createHash('sha256').update(bytes).digest('hex');
    requireValue(message.equals(expected) && row.messageBytes === message.length && row.memberBytes === member.length &&
      row.messageSHA256 === sha(message) && row.memberSHA256 === sha(member), 'Source-v2 exact E8 count8/bytes/hash required');
    return {role: row.role, componentCount: 8, messageBytes: message.length, memberBytes: member.length,
      bodyBytes: fields[7].length, messageSHA256: sha(message), withinTypedCapacity: true};
  });
  return {scope: 'PUBLIC_BYTE_FRAMING_AND_CAPACITY_ONLY', vectors, allExpectedBytesMatch: true,
    capacities: CORE18_SOURCE_V2_LIMITS, cryptographicVerification: false, CABIInvoked: false, fullCompatibility: false,
    RootAdmission: false, SourceAdmission: false};
}
