// Offline, explicit Main component reuse intake. Import performs no I/O.
// No caller-defined profile, matching source or legacy receipt can replace
// the independently pinned Main28 and original A26 evidence.
import {readFileSync, lstatSync} from 'node:fs';
import {dirname, isAbsolute, resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const SOURCE_HANDOFF = Object.freeze({
  path: '/Volumes/西部数据/YNX-large-work/original-a-builds/wallet-main711-auth26-component-light-intake-20261024/component-suffix-r2-once/MAIN711_AUTH26_COMPLETE_MATCHING_COMPONENT_HANDOFF.json',
  bytes: 47461,
  sha256: '5812ebd34aa76e532dd71cc038338fdee449baa61398ce097a247aef2cfb8dcc',
});
const fail = code => { throw Object.assign(new Error(code), {code}); };
const own = (object, key) => {
  if (!object || Object.getPrototypeOf(object) !== Object.prototype) fail('MAIN_COMPONENT_REUSE_DATA');
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('MAIN_COMPONENT_REUSE_DATA');
  return descriptor.value;
};
function regular(path, cap = 1024 * 1024) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) fail('MAIN_COMPONENT_REUSE_PATH');
  for (let at = path;; at = dirname(at)) {
    const status = lstatSync(at);
    if (status.isSymbolicLink()) fail('MAIN_COMPONENT_REUSE_SYMLINK');
    if (at === path && !status.isFile()) fail('MAIN_COMPONENT_REUSE_NOT_FILE');
    if (at === dirname(at)) break;
  }
  // Metadata reads are bounded; explicit CREATE calls separately request
  // runtime and binary reads under their own per-file caps.
  if (lstatSync(path).size > cap) fail('MAIN_COMPONENT_REUSE_METADATA_CAP');
  return readFileSync(path);
}
const TARGET_HANDOFF = Object.freeze({
  path: '/Volumes/西部数据/YNX-large-work/wallet-feature-integration-20261018/MAIN_2C200B84_AUTH28_PROFILE/HANDOFF.json',
  bytes: 8521, sha256: 'e6ebfd7a5560ba055e4e4691901406812eacdcccb46cb8a2f8c37c4e6604effe',
});
const HISTORICAL_HEADERS = Object.freeze({
  path: '/Volumes/西部数据/YNX-large-work/original-a-builds/wallet-597af41e-auth14-r166-normal-20261024/component-header-r2/COMPLETE_NODE22_HEADER_INPUT_INVENTORY.json',
  bytes: 506398, sha256: '08e36270db7af6acb11dbe4d96d05ac5a9ca14afc6190845db6703eea1c62866',
});
const sha = raw => createHash('sha256').update(raw).digest('hex');
const same = (a, b, code) => { if (!isDeepStrictEqual(a, b)) fail(code); };
const pin = (path, raw) => ({path, bytes: raw.length, sha256: sha(raw)});
function relative(path) {
  if (typeof path !== 'string' || isAbsolute(path) || path.includes('\\') || path.split('/').some(x => !x || x === '.' || x === '..')) fail('MAIN_COMPONENT_REUSE_RELATIVE');
  return path;
}
function pinned(ref, root, cap = 32 * 1024 * 1024) {
  const p = reference(ref), path = root ? join(root, relative(p.path)) : p.path;
  const raw = regular(path, cap);
  if (raw.length !== p.bytes || sha(raw) !== p.sha256) fail('MAIN_COMPONENT_REUSE_INPUT_DIFFERS');
  return raw;
}
const parse = raw => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw));
const normalize = (value, root) => value === root || value.startsWith(root + '/') ? '<SOURCE>' + value.slice(root.length) : value === '-I' + root || value.startsWith('-I' + root + '/') ? '-I<SOURCE>' + value.slice(root.length + 2) : value;
const FLAGS = ['-DYNX_ORIGINAL_WALLET_PROJECT_CONTROL_CABI=1', '-DYNX_ORIGINAL_WALLET_PROJECT_CONTROL=1', '-DYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING=1', '-DYNX_ORIGINAL_WALLET_ARTIFACT_CABI=1'];
// Pure DATA comparison, not a build, qualification or alternative plan factory.
export function inspectMainComponentPlanData(plan, root, role) {
  const count = role === 'node' ? 17 : role === 'helper' ? 11 : 0;
  if (!count || !plan || !Array.isArray(plan.sources) || plan.sources.length !== count || new Set(plan.sources).size !== count || !Array.isArray(plan.commands) || plan.commands.length !== 1) fail('MAIN_COMPONENT_REUSE_PLAN');
  if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root || plan.sources.some(p => typeof p !== 'string' || !p.startsWith(root + '/') || resolve(p) !== p)) fail('MAIN_COMPONENT_REUSE_PLAN_ROOT');
  const {tool, argv} = plan.commands[0];
  if (tool !== '/usr/bin/clang++' || !Array.isArray(argv) || argv.some(x => typeof x !== 'string') || argv.filter(x => x === '-arch').length !== 1 || argv[argv.indexOf('-arch') + 1] !== 'arm64') fail('MAIN_COMPONENT_REUSE_ABI');
  if (!argv.includes('-DNAPI_VERSION=8') && role === 'node') fail('MAIN_COMPONENT_REUSE_ABI');
  if (!argv.includes('-mmacosx-version-min=13.0') || argv.at(-2) !== '-o' || argv.at(-1) !== plan.output) fail('MAIN_COMPONENT_REUSE_ABI');
  const roles = argv.filter(x => x.startsWith('-DYNX_ORIGINAL_WALLET_'));
  same(roles, role === 'node' ? FLAGS : [], 'MAIN_COMPONENT_REUSE_ROLE_FLAGS');
  const archives = argv.filter(x => x.endsWith('.a'));
  same(archives, role === 'node' ? [join(root, 'apps/wallet-desktop/native/libynx_project_control.a')] : [], 'MAIN_COMPONENT_REUSE_ARCHIVE');
  const first = argv.indexOf(plan.sources[0]), last = argv.lastIndexOf('-o');
  same(argv.slice(first, last), [...plan.sources, ...archives], 'MAIN_COMPONENT_REUSE_TU_ORDER');
  const la = argv.reduce((n, x, i) => n + (x === '-framework' && argv[i + 1] === 'LocalAuthentication' ? 1 : 0), 0);
  if (la !== (role === 'node' ? 1 : 0)) fail('MAIN_COMPONENT_REUSE_LOCAL_AUTHENTICATION');
  if (plan.ownedUndefinedScan?.tool !== '/usr/bin/nm' || plan.ownedUndefinedScan.rejectPattern !== 'YNX|ynx') fail('MAIN_COMPONENT_REUSE_SCAN');
  same(plan.ownedUndefinedScan.argv, ['-u', plan.output], 'MAIN_COMPONENT_REUSE_SCAN');
  return {sources: plan.sources.map(x => normalize(x, root)), commands: [{tool, argv: argv.map(x => normalize(x, root))}], output: normalize(plan.output, root)};
}
function tuple(path, version, counts) {
  const raw = regular(path), t = parse(raw);
  if (t.version !== version) fail('MAIN_COMPONENT_REUSE_VERSION');
  if (!t.plansRef) fail('MAIN_COMPONENT_REUSE_PLAN_REFERENCE_REQUIRED');
  const plans = parse(pinned(t.plansRef)), invRaw = pinned(t.inventory), inventory = parse(invRaw);
  if (inventory.version !== version) fail('MAIN_COMPONENT_REUSE_VERSION');
  const rows = [...inventory.NativeInputs, ...inventory.HelperInputs, ...inventory.pureDeploymentInputs, inventory.normalBuildTool];
  if (rows.length !== counts || inventory.NativeInputs.length !== 91 || inventory.HelperInputs.length !== 5 || new Set(rows.map(r => r.path)).size !== counts) fail('MAIN_COMPONENT_REUSE_INVENTORY');
  for (const row of rows) pinned(row, t.sourceRoot);
  const cpp = rows.filter(r => /\.(?:h|mm|cpp)$/.test(r.path)).sort((a, b) => a.path.localeCompare(b.path));
  if (cpp.length !== 81) fail('MAIN_COMPONENT_REUSE_CPP_COUNT');
  const identities = Object.fromEntries(['node', 'helper'].map(role => [role, inspectMainComponentPlanData(plans[role], t.sourceRoot, role)]));
  const runtimeRaw = pinned(t.runtime.manifest), runtime = parse(runtimeRaw);
  if (runtime.version !== 'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1' || !Array.isArray(runtime.files) || runtime.files.length !== (version.endsWith('.26') ? 9350 : 9351)) fail('MAIN_COMPONENT_REUSE_RUNTIME');
  const seen = new Set();
  for (const row of runtime.files) {
    if (seen.has(row.path)) fail('MAIN_COMPONENT_REUSE_RUNTIME_DUPLICATE');
    seen.add(row.path);
    // Runtime package manifests may contain genuine empty files.
    if (row.bytes === 0) { const raw = regular(join(t.runtime.root, relative(row.path)), 32 * 1024 * 1024); if (raw.length || sha(raw) !== row.sha256) fail('MAIN_COMPONENT_REUSE_INPUT_DIFFERS'); }
    else pinned(row, t.runtime.root);
  }
  const pkg = metadata(join(t.runtime.root, 'package.json'));
  if (!seen.has('package.json') || pkg.name !== '@ynx-chain/wallet-auth' || pkg.version !== version) fail('MAIN_COMPONENT_REUSE_RUNTIME_VERSION');
  return {t, raw, input: pin(path, raw), rows, cpp, identities, inventory: pin(t.inventory.path, invRaw), runtime: {manifest: pin(t.runtime.manifest.path, runtimeRaw), files: runtime.files.length}, plans};
}
function metadata(path) {
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(regular(path)));
}
function reference(ref) {
  const path = own(ref, 'path'), bytes = own(ref, 'bytes'), sha256 = own(ref, 'sha256');
  if (!Number.isSafeInteger(bytes) || bytes < 1 || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) fail('MAIN_COMPONENT_REUSE_PIN');
  return {path, bytes, sha256};
}
function exactSourceAnchor(ref) {
  const pin = reference(ref);
  if (Object.keys(SOURCE_HANDOFF).some(key => pin[key] !== SOURCE_HANDOFF[key])) fail('MAIN_COMPONENT_REUSE_SOURCE_HANDOFF');
}

/**
 * Reserved explicit 26 -> 28 branch. The original source is Main711/Auth26,
 * legacy YNX_WALLET_ORIGINAL_NATIVE_BUILD (no invented schema): 104 record
 * inputs = SDK91 + Main13, base CPP/header81 + Main12 = 93, one archive,
 * node17/helper11. MainAdditionalCPP=3 counts TUs, not total Main inputs.
 *
 * Both independently fixed handoffs and an actual target exported plan are
 * required. This function never compiles, loads, copies,
 * registers, writes a receipt, or grants Native/Source/App/install status.
 */
export function createMainComponentCompileReuseBinding(request) {
  exactSourceAnchor(own(request, 'sourceExecutionHandoff'));
  const source = metadata(own(request, 'sourceTuplePath'));
  const target = metadata(own(request, 'targetTuplePath'));
  if (own(source, 'version') !== '1.3.0-pq.3.32-auth.26' || own(target, 'version') !== '1.3.0-pq.3.32-auth.28') fail('MAIN_COMPONENT_REUSE_VERSION');
  const descriptor = Object.getOwnPropertyDescriptor(request, 'targetMainProfileHandoff');
  if (!descriptor || (Object.hasOwn(descriptor, 'value') && descriptor.value == null)) fail('MAIN_COMPONENT_REUSE_TARGET_MAIN_PROFILE_REQUIRED');
  if (!Object.hasOwn(descriptor, 'value')) fail('MAIN_COMPONENT_REUSE_DATA');
  const ref = reference(descriptor.value), raw = regular(ref.path);
  if (raw.length !== ref.bytes || sha(raw) !== ref.sha256) fail('MAIN_COMPONENT_REUSE_INPUT_DIFFERS');
  if (Object.keys(TARGET_HANDOFF).some(key => ref[key] !== TARGET_HANDOFF[key])) fail('MAIN_COMPONENT_REUSE_TARGET_MAIN_PROFILE_UNSUPPORTED');
  if (!target.plansRef) fail('MAIN_COMPONENT_REUSE_TARGET_PLAN_REQUIRED');
  const targetH = parse(raw), observed = [];
  const read = r => { const b = pinned(r); observed.push([r, b]); return parse(b); };
  const sourceH = read(SOURCE_HANDOFF);
  if (sourceH.schema !== 'YNX_ORIGINAL_A_MAIN711_AUTH26_EXECUTED_COMPONENT_HANDOFF_V1' || targetH.schema !== 'YNX_WALLET_AUTH28_SUCCESSOR_PROFILE/v1') fail('MAIN_COMPONENT_REUSE_HANDOFF_SCHEMA');
  const supply = read({path: targetH.supply.handoff, bytes: targetH.supply.bytes, sha256: targetH.supply.sha256});
  if (supply.schema !== 'CANONICAL_SDK_AUTH28_COMPLETE_NORMAL_SUPPLY/v1' || supply.version !== target.version || supply.normalNativeInputCount !== 101 || supply.compileCPPHeaderInputs !== 81 || supply.runtime.AuthFiles !== 491 || supply.runtime.unionFiles !== 9351) fail('MAIN_COMPONENT_REUSE_TARGET_SUPPLY');
  const authRef = supply.runtime.manifests.find(r => r.sha256 === targetH.supply.authManifest.sha256);
  if (!authRef || authRef.bytes !== targetH.supply.authManifest.bytes) fail('MAIN_COMPONENT_REUSE_TARGET_AUTH_MANIFEST');
  const authManifest = read(authRef);
  if (authManifest.version !== 'YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1' || authManifest.files?.length !== 491) fail('MAIN_COMPONENT_REUSE_TARGET_AUTH_MANIFEST');
  if (sourceH.assembled.parent !== targetH.source.parent || targetH.source.commit !== '2c200b843de242903b59e7ea76066e7ba94c581b') fail('MAIN_COMPONENT_REUSE_LINEAGE');
  for (const key of ['helperExecuted', 'helperRegistered', 'NativeQualified', 'Source', 'App', 'GUI', 'installed', 'published', 'userKeysTouched']) if (sourceH.boundaries[key] !== false) fail('MAIN_COMPONENT_REUSE_BOUNDARY');
  const supplied = suffix => {
    const refs = sourceH.refs.filter(r => r.path.endsWith(suffix));
    if (refs.length !== 1) fail('MAIN_COMPONENT_REUSE_UNSUPPLIED_EVIDENCE');
    return {ref: refs[0], value: read(refs[0])};
  };
  same(own(request, 'executedRecord'), sourceH.executedRecord, 'MAIN_COMPONENT_REUSE_RECORD_REF');
  const record = read(sourceH.executedRecord);
  if (Object.hasOwn(record, 'schema') || record.schemaVersion !== 1 || record.kind !== 'YNX_WALLET_ORIGINAL_NATIVE_BUILD' || record.commandsKind !== 'executed-normal-build' || record.readbackOnly !== false || record.sourceRoot !== sourceH.assembled.source || record.napiVersion !== 8 || record.headerVersion !== '22.13.1' || record.minimumSystemVersion !== '13.0') fail('MAIN_COMPONENT_REUSE_RECORD');
  if (record.inputFiles?.length !== 104 || record.helperBuild?.inputFiles?.length !== 96 || record.helperBuild.executed !== true) fail('MAIN_COMPONENT_REUSE_RECORD_COUNT');
  same(record.architectures, ['arm64'], 'MAIN_COMPONENT_REUSE_ABI');
  same(record.exitCodes, [0], 'MAIN_COMPONENT_REUSE_EXIT');
  same(record.helperBuild.exitCodes, [0], 'MAIN_COMPONENT_REUSE_EXIT');
  const {value: result} = supplied('/BUILD_RESULT.json');
  same(result, sourceH.actual, 'MAIN_COMPONENT_REUSE_RESULT');
  if (result.noInflight !== true || !result.owned?.length || result.owned.some(p => p.present !== false || !Number.isSafeInteger(p.pid) || !/^[a-f0-9]{32}$/.test(p.start))) fail('MAIN_COMPONENT_REUSE_OWNED');
  const phases = ['FULL_MAIN711_AUTH26_EXACT_ASSEMBLY', 'SOURCE_HEADERS_RUNTIME_PRE', 'NORMAL_EXPLICIT_ROLE_PLAN_ONLY', 'NORMAL_AUTH26_COMBINED17_HELPER11_COMPONENT', 'NORMAL_COMPONENT_CANONICAL_POSTVERIFY', 'NODE_MACHO_ARM64', 'NODE_LINKED_LIBRARIES', 'NODE_RAW_UNDEFINED', 'HELPER_MACHO_ARM64', 'HELPER_LINKED_LIBRARIES', 'HELPER_RAW_UNDEFINED', 'PASSIVE_NODE_EXPORT_DESCRIPTORS', 'PASSIVE_ELECTRON_EXPORT_DESCRIPTORS', 'SOURCE_HEADERS_RUNTIME_POST'];
  same(result.terms.map(t => t.phase), phases, 'MAIN_COMPONENT_REUSE_PHASES');
  for (let i = 0; i < phases.length; i++) {
    const term = result.terms[i];
    if (term.actualExit !== 0 || term.guard !== null || !Number.isFinite(term.start) || !(term.end >= term.start) || (i && term.start < result.terms[i - 1].end)) fail('MAIN_COMPONENT_REUSE_PHASE_FAILED');
    same(supplied('/' + term.phase + '.terminal.json').value, term, 'MAIN_COMPONENT_REUSE_TERMINAL');
  }
  const {value: pre} = supplied('/SOURCE_HEADERS_RUNTIME_PRE.json'), {value: post} = supplied('/SOURCE_HEADERS_RUNTIME_POST.json');
  same(pre, post, 'MAIN_COMPONENT_REUSE_PRE_POST');
  if (pre.exactSupplier122 !== true || pre.MainEightExact !== true || pre.fullHeaderInputs !== 2368 || pre.runtimeDependencyFiles !== 9124 || pre.runtimeUnchanged !== true || pre.normalPrefixUnchanged !== true) fail('MAIN_COMPONENT_REUSE_PRE_POST');
  const {value: originalPlan} = supplied('/NORMAL_EXPLICIT_ROLE_PLAN_ONLY.stdout');
  const {value: children} = supplied('/ACTUAL_CHILD_TOOL_ARGV.json');
  const drivers = children.filter(c => c.ppid === result.terms[3].pid && c.argv?.[0] === '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++');
  if (drivers.length !== 2) fail('MAIN_COMPONENT_REUSE_COMPILER_MAPPING');
  for (const [i, role] of ['node', 'helper'].entries()) {
    const body = i ? record.helperBuild : record;
    same(body.commands, originalPlan[role].commands, 'MAIN_COMPONENT_REUSE_RECORDED_PLAN');
    same(drivers[i].argv.slice(1), body.commands[0].argv, 'MAIN_COMPONENT_REUSE_COMPILER_ARGV');
    if (!result.owned.some(p => p.pid === drivers[i].pid && p.start === drivers[i].start && p.present === false)) fail('MAIN_COMPONENT_REUSE_COMPILER_OWNERSHIP');
    inspectMainComponentPlanData(originalPlan[role], record.sourceRoot, role);
    if (body.ownedUndefinedScan?.exit !== 0 || body.ownedUndefinedScan?.ownedUndefined?.length !== 0) fail('MAIN_COMPONENT_REUSE_UNDEFINED');
  }
  // Explicit calls below perform all potentially large reads. No lazy import,
  // module initialization, test fixture or marker bypasses these comparisons.
  const a = tuple(request.sourceTuplePath, source.version, 101), b = tuple(request.targetTuplePath, target.version, 101);
  if (a.t.sourceRoot !== record.sourceRoot) fail('MAIN_COMPONENT_REUSE_SOURCE_ROOT');
  if (a.t.runtime.root !== record.runtimeUnion.sourceRoot) fail('MAIN_COMPONENT_REUSE_SOURCE_RUNTIME_ROOT');
  if (b.t.runtime.root !== supply.installedSourceRoot) fail('MAIN_COMPONENT_REUSE_TARGET_RUNTIME_ROOT');
  same(a.cpp, b.cpp, 'MAIN_COMPONENT_REUSE_CPP_CHANGED');
  same(a.identities, b.identities, 'MAIN_COMPONENT_REUSE_PLAN_CHANGED');
  for (const role of ['node', 'helper']) same(a.identities[role], inspectMainComponentPlanData(originalPlan[role], record.sourceRoot, role), 'MAIN_COMPONENT_REUSE_PLAN_CHANGED');
  same({bytes: b.inventory.bytes, sha256: b.inventory.sha256}, targetH.profile.inventory, 'MAIN_COMPONENT_REUSE_TARGET_INVENTORY');
  same({bytes: a.inventory.bytes, sha256: a.inventory.sha256}, {bytes: record.sourceInventory.bytes, sha256: record.sourceInventory.sha256}, 'MAIN_COMPONENT_REUSE_SOURCE_INVENTORY');
  const buildTool = b.rows.find(r => r.path === 'apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs');
  if (!buildTool || buildTool.bytes !== targetH.profile.tool.bytes || buildTool.sha256 !== targetH.profile.tool.sha256) fail('MAIN_COMPONENT_REUSE_TOOL');
  same(a.rows.find(r => r.path === buildTool.path), buildTool, 'MAIN_COMPONENT_REUSE_TOOL_CHANGED');
  if (targetH.walletInputs.length !== 13 || targetH.walletInputs.filter(r => /\.(h|mm)$/.test(r.path)).length !== 12) fail('MAIN_COMPONENT_REUSE_MAIN_COUNT');
  for (const row of targetH.walletInputs) {
    pinned(row, a.t.sourceRoot); pinned(row, b.t.sourceRoot);
    same(record.inputFiles.find(r => r.relative === row.path), {relative: row.path, bytes: row.bytes, sha256: row.sha256}, 'MAIN_COMPONENT_REUSE_MAIN_INPUT');
  }
  for (const row of targetH.files) pinned({path: row.path, bytes: row.bytes, sha256: row.sha256}, b.t.sourceRoot);
  same(record.inputFiles.slice(0, 91), a.rows.slice(0, 91).map(r => ({relative: r.path, bytes: r.bytes, sha256: r.sha256})), 'MAIN_COMPONENT_REUSE_NATIVE_INPUTS');
  for (const [body, count] of [[record, 104], [record.helperBuild, 96]]) {
    if (new Set(body.inputFiles.map(r => r.relative)).size !== count) fail('MAIN_COMPONENT_REUSE_RECORD_DUPLICATE');
    for (const row of body.inputFiles) pinned({path: row.relative, bytes: row.bytes, sha256: row.sha256}, a.t.sourceRoot);
  }
  if (record.headers.length !== 5 || new Set(record.headers.map(r => r.relative)).size !== 5) fail('MAIN_COMPONENT_REUSE_HEADERS');
  for (const row of record.headers) pinned({path: row.relative, bytes: row.bytes, sha256: row.sha256}, record.headerRoot);
  // This pre-existing A14 full inventory describes the SAME headerRoot used
  // by the actual A26 argv. It is historical evidence, not a new A26 witness.
  const historicalHeaders = read(HISTORICAL_HEADERS);
  if (historicalHeaders.headerRoot !== record.headerRoot || historicalHeaders.headerVersion !== record.headerVersion || historicalHeaders.sourceAndCopyExact !== true || historicalHeaders.allInputs?.length !== 2368 || new Set(historicalHeaders.allInputs.map(r => r.relative)).size !== 2368) fail('MAIN_COMPONENT_REUSE_FULL_HEADERS');
  const verifyFullHeaders = () => {
    for (const row of historicalHeaders.allInputs) pinned({path: row.relative, bytes: row.bytes, sha256: row.sha256}, record.headerRoot);
  };
  verifyFullHeaders();
  same(b.runtime.manifest.sha256, targetH.supply.unionManifest.sha256, 'MAIN_COMPONENT_REUSE_TARGET_RUNTIME');
  same(a.runtime.manifest.sha256, record.runtimeUnion.sha256, 'MAIN_COMPONENT_REUSE_SOURCE_RUNTIME');
  const artifacts = [record.output, record.helperBuild.output].map((row, index) => {
    const ref = {path: join(record.sourceRoot, relative(row.relative)), bytes: row.bytes, sha256: row.sha256};
    const bytes = pinned(ref);
    if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x0100000c || bytes.readUInt32LE(12) !== (index ? 2 : 6)) fail('MAIN_COMPONENT_REUSE_MACHO');
    return ref;
  });
  same(artifacts[0], sourceH.module, 'MAIN_COMPONENT_REUSE_ARTIFACT_REF');
  same(artifacts[1], sourceH.helper, 'MAIN_COMPONENT_REUSE_ARTIFACT_REF');
  const helperCopy = join(record.sourceRoot, relative(record.helperBuild.packagedOutput));
  pinned({...artifacts[1], path: helperCopy});
  // Final fences re-read metadata and selected source/runtime files; concurrent
  // mutation cannot silently turn a DATA comparison into a successful receipt.
  same(tuple(request.sourceTuplePath, source.version, 101).input, a.input, 'MAIN_COMPONENT_REUSE_CHANGED');
  same(tuple(request.targetTuplePath, target.version, 101).input, b.input, 'MAIN_COMPONENT_REUSE_CHANGED');
  if (!regular(ref.path).equals(raw)) fail('MAIN_COMPONENT_REUSE_CHANGED');
  for (const row of targetH.walletInputs) { pinned(row, a.t.sourceRoot); pinned(row, b.t.sourceRoot); }
  for (const row of record.headers) pinned({path: row.relative, bytes: row.bytes, sha256: row.sha256}, record.headerRoot);
  verifyFullHeaders();
  for (const ref of artifacts) pinned(ref);
  for (const [ref, bytes] of observed) if (!pinned(ref).equals(bytes)) fail('MAIN_COMPONENT_REUSE_CHANGED');
  return Object.freeze({kind: 'YNX_NORMAL_NATIVE_COMPILE_REUSE_BINDING/v1', executed: false,
    sourceExecutionHandoff: SOURCE_HANDOFF, targetMainProfileHandoff: TARGET_HANDOFF,
    originalExecutedRecord: sourceH.executedRecord, originalRecordKind: record.kind,
    originalExecutionIndependentlyProven: false, sourceTuple: a.input, targetTuple: b.input,
    compiledSourceVersion: source.version, targetRuntimeVersion: target.version,
    baseCompileInputCount: 81, mainCompileInputCount: 12, compileInputCount: 93,
    sourceRecordInputCount: 104, sourceSDKNativeInputCount: 91, mainRecordInputCount: 13,
    nodeTranslationUnits: 17, helperTranslationUnits: 11, archiveCount: 1,
    sourceNormalInputCount: 101, targetNormalInputCount: 101,
    compileInputs: [...a.cpp, ...targetH.walletInputs.filter(r => /\.(h|mm)$/.test(r.path))],
    sourceInventory: a.inventory, targetInventory: b.inventory, sourceRuntime: a.runtime, targetRuntime: b.runtime,
    targetAuthManifest: authRef, targetAuthFileCount: 491,
    capturedCompilerDriverMappings: drivers, canonicalHeaders: record.headers,
    compilerBinaryIndependentlyPinned: false, completeHeadersInventoryIndependentlyPinned: false,
    historicalCompleteHeadersInventory: HISTORICAL_HEADERS, historicalHeaderFileCount: 2368,
    completeOSSDKIndependentlyCaptured: false, selectedArtifactIdentity: artifacts,
    exactCompileInputCompatible: true, artifactsFromOriginalExecution: true,
    compileReuseAdmitted: false, targetRecompiled: false, sourcePathsInBinaryRetained: true,
    supplierMaterialization: sourceH.materialization, materializationIndependentlyQualified: false,
    priorFailure: sourceH.priorFailure, suffixReady: sourceH.ready,
    a26HeaderVerificationScriptHistoricalBytesBound: false,
    helperExecuted: false, helperRegistered: false,
    NativeQualified: false, SourceActivated: false, AppBuilt: false, installed: false});
}

export function verifyMainComponentCompileReuseBinding({request, receipt}) {
  same(createMainComponentCompileReuseBinding(request), receipt, 'MAIN_COMPONENT_REUSE_RECEIPT_CHANGED');
  return true;
}
