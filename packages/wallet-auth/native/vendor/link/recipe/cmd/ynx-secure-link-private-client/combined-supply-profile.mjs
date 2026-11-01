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
function profile(id, commit, tree, additionalBindings = [], additionalSources = []) {
  const bindings = [...commonBindings, ...additionalBindings].map(([symbol, bridge, header, implementation]) => Object.freeze({
    symbol, bridge: command + '/' + bridge, header: command + '/' + header, implementation: command + '/' + implementation,
  }));
  const sourcePaths = [...new Set(['go.mod', 'go.sum', ...bindings.flatMap(row => [row.bridge, row.header, row.implementation]),
    ...Object.entries(commonPackages).flatMap(([pkg, names]) => names.map(name => pkg + '/' + name)), ...additionalSources])].sort();
  const packagePaths = [...new Set(sourcePaths.filter(name => name.endsWith('.go')).map(name => name.slice(0, name.lastIndexOf('/'))))].sort();
  return Object.freeze({id, commit, tree, bindings: Object.freeze(bindings), sourcePaths: Object.freeze(sourcePaths),
    modulePaths, packagePaths: Object.freeze(packagePaths), symbols: Object.freeze(bindings.map(row => row.symbol).sort()),
    headers: Object.freeze([...new Set(bindings.map(row => row.header))].sort()),
    bridges: Object.freeze([...new Set(bindings.map(row => row.bridge))].sort()),
    coreExports: bindings.length, totalExports: bindings.length + 22 + 8});
}

// Updating a supplier source identity requires an explicit owner-reviewed profile.
// Counts alone, a new caller-chosen commit, or arbitrary paths never select one.
export const CORE_SUPPLY_PROFILES = Object.freeze([
  profile('core15/45', '84a57203f2ea10dfa51c9c4cef817ea3cc411b9c', '13e9cba4d9650bf71fcbf8080286d648a1b45fbf'),
  profile('core17/47', 'ebd19f47559d5e97082e5c61fff106fb4aee6f7f', 'bdafb9c790b825eb277be358535b51983912beed', [
    ['YNXAccountMigrationAuthorizationSignV1', 'migration_authorization_bridge.go', 'account_migration_authorization.h', 'migration_authorization_core.go'],
    ['YNXProductPairPendingOriginalQuerySignV1', 'pending_query_bridge.go', 'product_pair_pending_original_query.h', 'pending_query_core.go'],
  ], ['internal/ynxauth/migration_signing.go', 'internal/ynxbatch/product_pair_pending_original_query.go']),
]);

const requireValue = (value, message) => {if (!value) throw Error('Core supply profile: ' + message);};
const exact = (actual, expected, label) => {
  requireValue(Array.isArray(actual) && actual.every(value => typeof value === 'string') && new Set(actual).size === actual.length &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()), 'closed unique ' + label + ' required');
};
const validPin = row => row && Number.isSafeInteger(row.bytes) && row.bytes > 0 && /^[a-f0-9]{64}$/.test(row.sha256 ?? '') && /^[a-f0-9]{40}$/.test(row.gitBlob ?? '');
const samePin = (a, b) => a.bytes === b.bytes && a.sha256 === b.sha256 && a.gitBlob === b.gitBlob;
function approved(selected) {requireValue(CORE_SUPPLY_PROFILES.includes(selected), 'approved named profile required');}

/** Pure metadata gate, called before creating any build output. */
export function selectCoreSupplyProfile(core) {
  requireValue(core?.version === version && core.source?.module === 'github.com/JiahaoAlbus/YNX-Chain' && core.source?.go === '1.26.10' &&
    core.LINKReadOnlyComposition?.sourceCommit === baseLINKCommit, 'original module/toolchain/LINK contract required');
  requireValue(Array.isArray(core.exports), 'declared exports required');
  const selected = CORE_SUPPLY_PROFILES.find(row => row.commit === core.source.commit && row.tree === core.source.tree);
  requireValue(selected, 'approved Core15 or Core17 commit/tree identity required');
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
      counts.handHeaders === selected.headers.length && counts.exportedSymbols === selected.coreExports && counts.cgoTranslationUnits === selected.bridges.length,
    'declared source/header/export counts do not match closed profile');
    exact(counts.cgoTranslationUnitPaths, selected.bridges, 'cgo translation units');
  }
  return selected;
}

function verifiedBytes(row, bytes, label) {
  requireValue(Buffer.isBuffer(bytes), 'owned original bytes required: ' + label);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const gitBlob = createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
  requireValue(bytes.length === row.bytes && sha256 === row.sha256 && gitBlob === row.gitBlob, 'original bytes/hash/Git mismatch: ' + label);
}

/** Independently reads declarations from all supplied bytes, including internal
 * packages. The builder separately binds each row.gitBlob to the fixed Git tree. */
export function verifyCoreSupplyBytes(core, selected, sourceBytes, descriptorBytes) {
  approved(selected);
  requireValue(selectCoreSupplyProfile(core) === selected, 'selected metadata changed');
  requireValue(sourceBytes instanceof Map && descriptorBytes instanceof Map, 'complete owned source/descriptor maps required');
  exact([...sourceBytes.keys()], selected.sourcePaths, 'read source paths');
  exact([...descriptorBytes.keys()], modulePaths, 'read module paths');
  const actual = [], headers = [], mains = [];
  for (const row of core.sources) {
    const bytes = sourceBytes.get(row.path);
    verifiedBytes(row, bytes, row.path);
    const text = bytes.toString('utf8');
    if (row.path.endsWith('.go')) {
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
