// Original LINK CI only. Immutable PUBLIC consumer inputs are test dependencies,
// not Root/Source/receiver issuance. Importing this file never runs Go or tools.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const dependencies = path.join(directory, 'p04-consumer-deps');
const moduleName = 'github.com/JiahaoAlbus/YNX-Chain';
const packageName = moduleName + '/internal/developerauthority';
const tags = 'securelink_openssl,securelink_reviewed_server_tls,securelink_public_server_tls_test';
export const P04_REQUIRED_TOPS = Object.freeze(['TestR5FiniteGETPrincipalFactory', 'TestR5FiniteGETUnknownAndLate',
  'TestR5ObservationAndV3', 'TestContextBoundRealServerSequentialRequests', 'TestR5DefaultV3ReleaseSchema']);
export const P04_REQUIRED_SUBTESTS = Object.freeze([
  ...['otherHost', 'query', 'rawAlias', 'contextSwap', 'headerChanged'].map(n => P04_REQUIRED_TOPS[0] + '/' + n),
  ...['unknownSQL', 'lateRevoke'].map(n => P04_REQUIRED_TOPS[1] + '/' + n),
]);
export const P04_GO_ARGUMENTS = Object.freeze(['test', '-mod=readonly', '-race', '-p', '1', '-count=1', '-timeout=150s', '-json',
  '-tags=' + tags, '-run', '^(' + P04_REQUIRED_TOPS.join('|') + ')$', './internal/developerauthority']);
const requestIdentityDependencies = path.join(directory, 'p04-request-identity-deps');
const cloudLiveReadDependencies = path.join(directory, 'p04-cloud-live-read-deps');
const requestIdentityHandoff = {file: 'HANDOFF.json', bytes: 2784, sha256: '981bb7c7b2bec7dca4c58fc2f828c6d939504ea66ab72eecf753976b14d65efa'};
const requestIdentityProducer = '9fefca05e731a7ddd19e63354522daaed07085ba';
const requestIdentitySuites = [
  {name: 'request-identity-link', package: 'internal/securelink', tests: ['TestOriginalServerTLSOriginalRequestIdentity']},
  {name: 'request-identity-auth', package: 'internal/developerauthority', tests: ['TestAuthReceiverUsesLiveLINKRequestIdentity', 'TestAuthReceiverRefusesUnboundLINKRequest']},
];
const requestIdentityArguments = [
  [...P04_GO_ARGUMENTS.slice(0, -2), '^TestOriginalServerTLSOriginalRequestIdentity$', './internal/securelink'],
  [...P04_GO_ARGUMENTS.slice(0, -2), '^TestAuthReceiver(UsesLiveLINKRequestIdentity|RefusesUnboundLINKRequest)$', './internal/developerauthority'],
];
const cloudReadPackage = 'apps/cloud/cmd/ynx-cloudd';
const cloudReadTest = 'TestIDERuntimeLINKOriginalRequestReachesCloudReadRoutesWithoutGrant';
const cloudReadTags = 'cloud_auth_v2,cloud_http_v5,cloud_auth_finite_get,cloud_link_finite_get,' + tags;
const cloudReadArguments = [...P04_GO_ARGUMENTS.slice(0, -4), '-tags=' + cloudReadTags, '-run', '^' + cloudReadTest + '$', './' + cloudReadPackage];
const cloudReadSuite = {name: 'cloud-live-read', package: cloudReadPackage, tests: [cloudReadTest, cloudReadTest + '/status', cloudReadTest + '/logs']};
const cloudReadExcludedPayLeaves = ['ide_runtime_pay_native.go', 'ide_runtime_pay_native_test.go'];
export const P04_COMET_ORIGINAL = Object.freeze({commit: '63ba175ec3725845536963daca5c8b79418187ad',
  repositoryTree: 'cfa69e0246f6cc87fb7d87a947f5f4de38650c8e', moduleTree: '47d7cfeee7cd178cb897eda57a4674677fac7e67',
  descriptors: Object.freeze([
    Object.freeze({relative: 'go.mod', bytes: 6552, sha256: '265396d8783ee13227b7dcded4787dfc169b86600388e028e3cecdb54a643d59'}),
    Object.freeze({relative: 'go.sum', bytes: 51533, sha256: 'daa9e68eab2c225e39a03b624169f17ad31dcf0b3f5c106c2b9df9ac3c9cdbfd'}),
  ])});
const singleConsumeHandoff = 'supplier-provenance/P04-SINGLE-CONSUME-TEST-HANDOFF.json';
const extraNames = ['SOURCE_MANIFEST.json', 'CLOUD_FINITE_GET_TLS_TEST_COMPOSITION.json',
  'supplier-provenance/CLOUD-CHILD-HANDOFF.json', 'supplier-provenance/LINK-TEST-HANDOFF.json',
  'supplier-provenance/LINK-TEST-R2-HANDOFF.json', 'supplier-provenance/P04-CHILD-TEST-HANDOFF.json',
  singleConsumeHandoff, 'apps/cloud/scripts/verify-finite-get-consumer-evidence.mjs', 'ORIGINAL_CI_REQUEST.json'];
const need = (ok, why) => {if (!ok) throw Error('P04 consumer CI: ' + why);};
const sha = b => createHash('sha256').update(b).digest('hex');
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const within = (a, b) => b === a || b.startsWith(a + path.sep);
function exact(actual, expected, label) {
  need(Array.isArray(actual) && actual.length === new Set(actual).size &&
    sameJSON([...actual].sort(), [...expected].sort()), 'closed unique ' + label + ' required');
}
export function safeP04Relative(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x1f\x7f\\:]/.test(value) &&
    !value.startsWith('/') && !value.endsWith('/') && value.split('/').every(x => x && x !== '.' && x !== '..'), 'canonical relative member required');
  return value;
}
function pin(raw, file) {return {path: file, bytes: raw.length, sha256: sha(raw)};}
function read(file, limit = 64 << 20, allowRoot = false) {
  need(path.isAbsolute(file) && path.resolve(file) === file && fs.realpathSync(file) === file, 'canonical input path required');
  const st = fs.lstatSync(file); need(st.isFile() && !st.isSymbolicLink() && (st.uid === process.getuid() || allowRoot && st.uid === 0) && st.size <= limit, 'owned bounded regular input required');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd); need(before.dev === st.dev && before.ino === st.ino, 'input changed before open');
    const raw = fs.readFileSync(fd), after = fs.fstatSync(fd);
    need(before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && raw.length === before.size, 'input changed while reading');
    return {raw, pin: pin(raw, file)};
  } finally {fs.closeSync(fd);}
}
function verifyBytes(raw, spec, label) {
  need(spec && Number.isSafeInteger(spec.bytes) && spec.bytes >= 0 && /^[a-f0-9]{64}$/.test(spec.sha256) &&
    raw.length === spec.bytes && sha(raw) === spec.sha256, 'exact bytes/SHA256 required: ' + label);
}
export function readP04PinnedAsset(root, spec) {
  need(spec && typeof spec.file === 'string', 'immutable relative dependency asset required');
  const file = path.join(root, safeP04Relative(spec.file)), input = read(file);
  verifyBytes(input.raw, spec, spec.file); return input;
}
const asset = readP04PinnedAsset;
function parseJSON(raw, label) {try {return JSON.parse(raw.toString('utf8'));} catch {throw Error('P04 consumer CI: malformed JSON ' + label);}}

// Parse rather than extract tar paths with a platform tool. No link, device,
// sparse/GNU alias, global PAX, size override or traversal is ever materialized.
export function parseP04SourceArchive(compressed, maximum = 128 << 20) {
  const raw = zlib.gunzipSync(compressed, {maxOutputLength: maximum});
  const files = new Map(), dirs = new Set(); let offset = 0, pax = null, ended = false, entries = 0;
  const utf8 = new TextDecoder('utf-8', {fatal: true});
  const text = b => utf8.decode(b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)));
  const octal = b => {const s = b.toString('ascii').replace(/\0.*$/s, '').trim(); need(/^[0-7]*$/.test(s), 'octal tar field required'); const n = parseInt(s || '0', 8); need(Number.isSafeInteger(n), 'bounded tar integer required'); return n;};
  while (offset + 512 <= raw.length) {
    const h = raw.subarray(offset, offset + 512);
    if (h.every(v => v === 0)) {need(raw.length - offset >= 1024 && raw.subarray(offset).every(v => v === 0) && pax === null, 'closed tar trailer required'); ended = true; break;}
    need(++entries <= 30000, 'bounded archive entry count required');
    const checksum = octal(h.subarray(148, 156)); let actual = 0;
    for (let i = 0; i < 512; i++) actual += i >= 148 && i < 156 ? 32 : h[i];
    need(actual === checksum && text(h.subarray(257, 263)) === 'ustar', 'original ustar checksum/magic required');
    const size = octal(h.subarray(124, 136)), type = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
    need(size <= (32 << 20) && offset + 512 + Math.ceil(size / 512) * 512 <= raw.length, 'bounded complete tar member required');
    const body = raw.subarray(offset + 512, offset + 512 + size); offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      need(pax === null && size <= 16384, 'one bounded per-file PAX required'); pax = {};
      let at = 0; while (at < body.length) {
        const space = body.indexOf(32, at); need(space > at, 'PAX length required'); const digits = body.subarray(at, space).toString('ascii');
        need(/^[1-9][0-9]*$/.test(digits), 'canonical PAX length required'); const length = Number(digits);
        need(Number.isSafeInteger(length) && length > space - at + 2 && at + length <= body.length && body[at + length - 1] === 10, 'complete PAX record required');
        const record = utf8.decode(body.subarray(space + 1, at + length - 1)), equals = record.indexOf('=');
        need(equals > 0, 'PAX key required'); const key = record.slice(0, equals), value = record.slice(equals + 1);
        need(['mtime', 'atime', 'ctime', 'path'].includes(key) && !Object.hasOwn(pax, key), 'closed unique PAX keys required');
        if (key !== 'path') need(/^-?[0-9]+(?:\.[0-9]+)?$/.test(value), 'PAX time only'); pax[key] = value; at += length;
      }
      continue;
    }
    need(type === '0' || type === '5', 'regular files/directories only; no symlink/hardlink/special tar entries');
    need(text(h.subarray(157, 257)) === '', 'tar link target forbidden');
    const prefix = text(h.subarray(345, 500)), headerName = (prefix ? prefix + '/' : '') + text(h.subarray(0, 100));
    const name = safeP04Relative((pax?.path ?? headerName).replace(type === '5' ? /\/$/ : /$^/, '')); pax = null;
    need(!files.has(name) && !dirs.has(name), 'duplicate resolved archive member');
    need((octal(h.subarray(100, 108)) & ~0o777) === 0, 'no special tar mode bits');
    if (type === '5') {need(size === 0, 'empty directory entry required'); dirs.add(name);}
    else {need(!/\.(?:key|p12|pfx)$/.test(name) && path.posix.basename(name) !== '.env', 'private credential input forbidden'); files.set(name, Buffer.from(body));}
  }
  need(ended && files.size > 0, 'complete nonempty source archive required');
  return {files, dirs, decodedBytes: raw.length};
}
export function verifyP04ArchiveMembers(archive, rows) {
  need(Array.isArray(rows) && rows.length > 0 && rows.length <= 15000, 'bounded complete manifest required');
  const names = rows.map(row => safeP04Relative(row.relative)); exact([...archive.files.keys()], names, 'archive member set');
  for (const name of names) {const parts = name.split('/'); for (let i = 1; i < parts.length; i++) need(!archive.files.has(parts.slice(0, i).join('/')), 'file/directory member conflict');}
  for (const row of rows) verifyBytes(archive.files.get(row.relative), row, row.relative);
  for (const dir of archive.dirs) need(names.some(name => name.startsWith(dir + '/')), 'unlisted empty archive directory refused');
  return true;
}

// Conservative static import superset, including test/platform leaves. This is
// not go list or a runtime dependency claim. Any new Comet import needs a new
// explicitly supplied source closure instead of a silent older-fork fallback.
export function p04GoImports(raw) {
  const s = raw.toString('utf8'), tokens = []; let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) {i++; continue;}
    if (s.startsWith('//', i)) {i = s.indexOf('\n', i); if (i < 0) break; continue;}
    if (s.startsWith('/*', i)) {const end = s.indexOf('*/', i + 2); need(end >= 0, 'closed Go comment'); i = end + 2; continue;}
    if (s[i] === '"' || s[i] === '`' || s[i] === "'") {
      const quote = s[i++], start = i; let closed = false;
      while (i < s.length) {if (s[i] === quote) {closed = true; break;} if (quote !== '`' && s[i] === '\\') i++; i++;}
      need(closed, 'closed Go literal'); const value = s.slice(start, i++); tokens.push({literal: quote !== "'", value}); continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (word) {tokens.push({word: word[0]}); i += word[0].length;} else tokens.push({word: s[i++]});
  }
  const imports = [];
  for (let n = 0; n < tokens.length; n++) if (tokens[n].word === 'import') {
    if (tokens[n + 1]?.word === '(') {for (n += 2; n < tokens.length && tokens[n].word !== ')'; n++) if (tokens[n].literal) imports.push(tokens[n].value);}
    else {for (n++; n < tokens.length && !tokens[n].literal; n++) {} if (tokens[n]?.literal) imports.push(tokens[n].value);}
  }
  for (const name of imports) need(!name.includes('\\'), 'escaped Go imports require explicit parser update');
  return imports;
}
export function inspectP04TypeGraph(files, cloudLiveRead = false) {
  const pending = [cloudLiveRead ? cloudReadPackage : 'internal/developerauthority'], visited = new Set(), imports = new Set();
  const excluded = new Set();
  if (cloudLiveRead) for (const name of cloudReadExcludedPayLeaves) {
    const file = cloudReadPackage + '/' + name;
    need(files.get(file)?.toString('utf8').startsWith('//go:build pay_pq && pay_cloud\n'), 'frozen Pay-only build constraint required: ' + file);
    excluded.add(file);
  }
  while (pending.length) {
    const folder = pending.pop(); if (visited.has(folder)) continue; visited.add(folder);
    const leaves = [...files.keys()].filter(name => path.posix.dirname(name) === folder && name.endsWith('.go') && !excluded.has(name));
    need(leaves.length > 0, 'complete local package source required: ' + folder);
    for (const leaf of leaves) for (const name of p04GoImports(files.get(leaf))) {
      imports.add(name); need(name !== 'github.com/cometbft/cometbft' && !name.startsWith('github.com/cometbft/cometbft/'), 'Comet import requires explicitly expanded original source graph');
      if (name.startsWith(moduleName + '/')) pending.push(name.slice(moduleName.length + 1));
      if (name === 'ynx.local/auth/binary-http-source') pending.push('binary-source');
      else if (name.startsWith('ynx.local/auth/binary-http-source/')) pending.push('binary-source/' + name.slice('ynx.local/auth/binary-http-source/'.length));
    }
  }
  return {kind: cloudLiveRead ? 'STATIC_IMPORT_SUPERSET_EXCLUDING_FIXED_PAY_TAG_LEAVES_NOT_GO_LIST' : 'STATIC_ALL_TAG_AND_TEST_IMPORT_SUPERSET_NOT_GO_LIST',
    ...(cloudLiveRead ? {excluded: [...excluded]} : {}), packages: [...visited].sort(), imports: [...imports].sort(), cometGoSourceRequired: false};
}

export function qualifyP04ProtectedAncestors(rows, uid = process.getuid()) {
  need(Array.isArray(rows) && rows.length > 0 && rows.at(-1).path === '/', 'full ancestor chain required');
  for (const row of rows) need(row.directory && !row.symlink && (row.uid === 0 || row.uid === uid) && (row.mode & 0o022) === 0, 'original verifierDirectory owner/mode/ancestor guard');
  return true;
}
function ancestors(root) {
  need(path.isAbsolute(root) && path.resolve(root) === root && fs.realpathSync(root) === root, 'canonical protected test root required');
  const rows = []; for (let p = root; ; p = path.dirname(p)) {const st = fs.lstatSync(p); rows.push({path: p, directory: st.isDirectory(), symlink: st.isSymbolicLink(), uid: st.uid, mode: st.mode & 0o777}); if (p === '/') break;}
  qualifyP04ProtectedAncestors(rows); return rows;
}
function freshRoot(root, protectedRoot = false) {
  need(typeof root === 'string' && path.isAbsolute(root) && path.resolve(root) === root, 'explicit absolute fresh root required');
  const parent = path.dirname(root); need(fs.realpathSync(parent) === parent, 'existing canonical root parent required');
  if (protectedRoot) ancestors(parent);
  need(!fs.existsSync(root), 'retain prior outputs; new root must not exist'); fs.mkdirSync(root, {mode: 0o700});
  return protectedRoot ? ancestors(root) : [];
}
function write(root, name, raw) {safeP04Relative(name); const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700}); fs.writeFileSync(file, raw, {flag: 'wx', mode: 0o600}); return file;}

export function verifyP04ConsumerDependencies(root = dependencies) {
  const original = read(path.join(root, 'ORIGINAL.json'), 2 << 20), m = parseJSON(original.raw, 'ORIGINAL.json');
  need(m.schema === 'YNX-LINK-P04-FINITE-GET-CONSUMER-DEPS/v1', 'fixed dependency manifest schema required');
  need(m.state === 'READY_EXACT_SUPPLIER_CAS', 'dependencies NOT_SUPPLIED: ' + (m.missing ?? []).join(','));
  const inputs = [original], load = spec => {const v = asset(root, spec); inputs.push(v); return v;};
  const candidateHandoff = load(m.candidate.handoff), h = parseJSON(candidateHandoff.raw, 'candidate handoff');
  const sourceManifest = load(m.candidate.sourceManifest), composition = load(m.candidate.composition), request = load(m.candidate.request), candidateTar = load(m.candidate.archive);
  const sources = parseJSON(sourceManifest.raw, 'candidate source manifest'), c = parseJSON(composition.raw, 'candidate composition'), r = parseJSON(request.raw, 'original request');
  need(sources.schema === 'YNX-P04-finite-get-native-test-inputs/1' && Array.isArray(sources.inputs), 'original complete candidate manifest required');
  need(c.schema === 'ynx-cloud-finite-get-native-test-composition/1' && c.testOnly === true && c.productionBytesUnchanged === true, 'original test-only composition required');
  exact(c.requiredTops, P04_REQUIRED_TOPS, 'original candidate test tops'); exact(c.testTags, tags.split(','), 'test-only tags');
  need(sameJSON(r.command, ['go', ...P04_GO_ARGUMENTS]), 'original complete-package test argv required');
  need(h.schema === 'YNX-P04-single-consume-native-consumer-handoff/1', 'P04 single-consume delivery handoff required');
  for (const [field, spec] of [['sourceArchive', m.candidate.archive], ['sourceManifest', m.candidate.sourceManifest], ['originalCIRequest', m.candidate.request]])
    need(h[field]?.bytes === spec.bytes && h[field]?.sha256 === spec.sha256, 'supplier handoff asset binding differs: ' + field);
  exact(m.candidate.extraMembers.map(row => row.relative), extraNames, 'candidate archive metadata extras');
  const candidate = parseP04SourceArchive(candidateTar.raw); verifyP04ArchiveMembers(candidate, [...sources.inputs, ...m.candidate.extraMembers]);
  for (const [name, input] of [['SOURCE_MANIFEST.json', sourceManifest], ['CLOUD_FINITE_GET_TLS_TEST_COMPOSITION.json', composition], ['ORIGINAL_CI_REQUEST.json', request]])
    need(candidate.files.get(name)?.equals(input.raw), 'original embedded metadata differs: ' + name);
  const testHandoff = candidate.files.get(singleConsumeHandoff);
  for (const spec of [h.testCAS, c.singleConsumeContract, r.singleConsumeTestCAS])
    verifyBytes(testHandoff, spec, 'original P04 single-consume test handoff');
  const testCAS = parseJSON(testHandoff, 'single-consume test handoff');
  const principalTest = 'internal/developerauthority/original_finite_get_principal_test.go';
  need(testCAS.schema === 'YNX-P04-native-consumer-single-consume-test-CAS/1' && testCAS.productionChanged === false &&
    h.onlyChangedSourceLeaf === principalTest && testCAS.logical === principalTest &&
    Number.isSafeInteger(r.supersedesRun) && r.supersedesRun > 0 &&
    r.supersedesRun === h.actual793Failure?.run && r.supersedesRun === testCAS.actualFailure?.run, 'same P04 test-only successor and original failure required');
  for (const spec of [r.principalTestExpected, testCAS.after])
    verifyBytes(candidate.files.get(principalTest), spec, 'actual P04 single-consume test');
  for (const header of ['private_client_v1.h', 'private_client_startup_v1.h'])
    need(candidate.files.has('cmd/ynx-secure-link-caller/' + header), 'actual native CGO header dependency required: ' + header);
  const mod = candidate.files.get('go.mod')?.toString('utf8') ?? '';
  need(/^module github\.com\/JiahaoAlbus\/YNX-Chain$/m.test(mod) && /^go 1\.26\.10$/m.test(mod) &&
    /^replace github\.com\/cometbft\/cometbft => \.\/third_party\/cometbft$/m.test(mod) &&
    /^replace ynx\.local\/auth\/binary-http-source => \.\/binary-source$/m.test(mod), 'original candidate module descriptors and local replacements retained');
  const graph = inspectP04TypeGraph(candidate.files);
  need(m.comet.commit === P04_COMET_ORIGINAL.commit && m.comet.repositoryTree === P04_COMET_ORIGINAL.repositoryTree && m.comet.moduleTree === P04_COMET_ORIGINAL.moduleTree, 'exact original Comet provenance required');
  exact(m.comet.descriptors.map(row => row.relative), ['go.mod', 'go.sum'], 'descriptor-only original Comet restore');
  const comet = m.comet.descriptors.map(spec => {const value = load(spec); verifyBytes(value.raw, P04_COMET_ORIGINAL.descriptors.find(row => row.relative === spec.relative), spec.relative); return {relative: spec.relative, ...value};});
  const sdkHandoff = load(m.sdk.handoff), sdkH = parseJSON(sdkHandoff.raw, 'PUBLIC input handoff');
  const sdkManifest = load(m.sdk.manifest), sdkTar = load(m.sdk.archive), vector = load(m.sdk.vector);
  const sdkRows = parseJSON(sdkManifest.raw, 'portable PUBLIC SDK manifest');
  need(sdkH.schema === 'YNX-P04-original-PUBLIC-R5-inputs-portable-freeze/1' && sdkH.PUBLICSourceNotProductionSDK462 === true &&
    Array.isArray(sdkRows) && sdkRows.length === sdkH.sdkFiles, 'original Auth portable PUBLIC SDK manifest required');
  for (const [field, spec] of [['sdkWholeFiles', m.sdk.manifest], ['portablePublicInputs', m.sdk.archive], ['vector', m.sdk.vector]])
    need(sdkH[field]?.bytes === spec.bytes && sdkH[field]?.sha256 === spec.sha256, 'PUBLIC input handoff binding differs: ' + field);
  for (const spec of [h.originalPUBLICSDK280AndVector, r.publicEnvironmentInputs])
    verifyBytes(sdkHandoff.raw, spec, 'same candidate/public input cohort');
  const bundle = parseP04SourceArchive(sdkTar.raw);
  verifyP04ArchiveMembers(bundle, [...sdkRows.map(row => ({...row, relative: 'PUBLIC-R5-SDK/' + row.relative})),
    {relative: 'PUBLIC_SDK_FILES.json', ...m.sdk.manifest}, {relative: 'PUBLIC_IDE_FINITE_GET_V4_VECTOR.json', ...m.sdk.vector}]);
  need(bundle.files.get('PUBLIC_SDK_FILES.json').equals(sdkManifest.raw) && bundle.files.get('PUBLIC_IDE_FINITE_GET_V4_VECTOR.json').equals(vector.raw), 'same original bundled metadata/vector required');
  const sdk = {files: new Map(sdkRows.map(row => [row.relative, bundle.files.get('PUBLIC-R5-SDK/' + row.relative)]))};
  need(sdk.files.has('native/original-auth-identity-source-verifier.mjs'), 'actual original Source verifier entry required');
  const vectorData = parseJSON(vector.raw, 'PUBLIC R5 vector');
  need(vectorData.PUBLIC === true && vectorData.RootAdmission === false && vectorData.SourceAdmission === false &&
    vectorData.deviceUnsigned && vector.raw.length <= (2 << 20), 'original PUBLIC R5 vector required');
  return {inputs, manifest: m, candidate, sdk, vector, comet, graph, sourceManifest: sources, composition: c};
}
export function verifyP04RequestIdentityDependencies(base = verifyP04ConsumerDependencies(), root = requestIdentityDependencies) {
  const h = asset(root, requestIdentityHandoff);
  const handoff = parseJSON(h.raw, 'P04 request identity handoff');
  need(handoff.schema === 'YNX-P04-original-request-Auth-LINK-composition/1' && handoff.files === 448 &&
    handoff.link?.commit === requestIdentityProducer && handoff.link.tree === '2e5f627175e51fc7ab5158e98abcf023331ceee0' &&
    handoff.link.producerRun === 43425561496 && handoff.firstFailure?.run === 43424589950 &&
    handoff.SourceAdmission === false && handoff.deployed === false &&
    sameJSON(handoff.commandsAfterLINKSuccessor, requestIdentityArguments.map(args => ['go', ...args])),
  'exact P04 Auth/LINK handoff and commands required');
  const archive = asset(root, {...handoff.archive, file: 'source.tar.gz'});
  const candidate = parseP04SourceArchive(archive.raw);
  const manifestRaw = candidate.files.get('SOURCE_MANIFEST.json');
  need(manifestRaw, 'embedded request identity source inventory required');
  const sourceManifest = parseJSON(manifestRaw, 'request identity source manifest');
  need(sourceManifest.schema === 'YNX-P04-finite-get-native-test-inputs/1' && sourceManifest.inputs?.length === handoff.files,
    'complete request identity source inventory required');
  verifyP04ArchiveMembers(candidate, [...sourceManifest.inputs, {relative: 'SOURCE_MANIFEST.json', ...pin(manifestRaw)}]);
  const linkSource = 'internal/securelink/original_server_tls.go';
  const changed = [linkSource, 'internal/developerauthority/original_finite_get_principal.go'];
  const added = [handoff.link.changedTest.relative, 'internal/developerauthority/original_finite_get_live_link_test.go'];
  const old = new Map(base.sourceManifest.inputs.map(row => [row.relative, row]));
  exact(sourceManifest.inputs.filter(row => !old.has(row.relative)).map(row => row.relative), added, 'two original new test leaves');
  exact(sourceManifest.inputs.filter(row => old.has(row.relative) && row.sha256 !== old.get(row.relative).sha256).map(row => row.relative),
    changed, 'two original request identity source changes');
  verifyBytes(candidate.files.get(linkSource), {bytes: 26493, sha256: '759324da51baf32779077c9dc06615f23c144b34cb7ec9ee0addce9b4f1e390c'}, linkSource);
  verifyBytes(candidate.files.get(handoff.link.changedTest.relative), handoff.link.changedTest, 'exact fixed original LINK test');
  const graph = inspectP04TypeGraph(candidate.files);
  return {...base, candidate, sourceManifest, graph, inputs: [...base.inputs, h, archive], requestIdentityHandoff: h.pin};
}

export function verifyP04CloudLiveReadDependencies(base = verifyP04RequestIdentityDependencies(), root = cloudLiveReadDependencies) {
  const h = asset(root, {file: 'HANDOFF.json', bytes: 1724, sha256: '74d0cbd89e8d0ed258df2da595f2fc09a85080fa6eef6321bd4aae8bc0e81bc1'});
  const handoff = parseJSON(h.raw, 'P04 Cloud live read handoff');
  need(handoff.schema === 'YNX-P04-normal-cloud-live-link-read/1' && handoff.files === 449 &&
    handoff.base?.bytes === base.requestIdentityHandoff.bytes && handoff.base.sha256 === base.requestIdentityHandoff.sha256 &&
    handoff.productionChanges === 0 && handoff.SourceAdmission === false && handoff.deployed === false &&
    sameJSON(handoff.command, ['go', ...cloudReadArguments]), 'exact Cloud live read handoff and command required');
  const archive = asset(root, {...handoff.archive, file: 'source.tar.gz'});
  const candidate = parseP04SourceArchive(archive.raw), manifestRaw = candidate.files.get('SOURCE_MANIFEST.json');
  need(manifestRaw, 'embedded Cloud live read source inventory required');
  const sourceManifest = parseJSON(manifestRaw, 'Cloud live read source manifest');
  need(sourceManifest.schema === base.sourceManifest.schema && sourceManifest.inputs?.length === handoff.files, 'complete Cloud live read source inventory required');
  verifyP04ArchiveMembers(candidate, [...sourceManifest.inputs, {relative: 'SOURCE_MANIFEST.json', ...pin(manifestRaw)}]);
  const test = cloudReadPackage + '/ide_runtime_live_link_read_test.go';
  exact(sourceManifest.inputs.map(row => row.relative), [...base.sourceManifest.inputs.map(row => row.relative), test], 'original R2 leaves plus one Cloud test');
  for (const row of base.sourceManifest.inputs) verifyBytes(candidate.files.get(row.relative), row, row.relative);
  verifyBytes(candidate.files.get(test), handoff.test, test);
  const graph = inspectP04TypeGraph(candidate.files, true);
  return {...base, candidate, sourceManifest, graph, inputs: [...base.inputs, h, archive], cloudLiveReadHandoff: h.pin};
}

export function prepareP04ConsumerComposite({dependencyRoot = dependencies, privateRoot, publicRoot, requestIdentity = false, cloudLiveRead = false}) {
  const original = verifyP04ConsumerDependencies(dependencyRoot);
  let verified = requestIdentity || cloudLiveRead ? verifyP04RequestIdentityDependencies(original) : original;
  if (cloudLiveRead) verified = verifyP04CloudLiveReadDependencies(verified);
  need(!within(privateRoot, publicRoot) && !within(publicRoot, privateRoot), 'disjoint private and evidence roots required');
  const source = path.join(privateRoot, 'source'), sdk = path.join(privateRoot, 'public-sdk'), staged = [];
  function materialize(root, name, raw, owner) {const file = write(root, name, raw); staged.push({...pin(raw, file), relative: path.relative(privateRoot, file), owner});}
  for (const [name, raw] of verified.candidate.files) materialize(source, name, raw, 'P04_EXACT_CANDIDATE');
  for (const row of verified.comet) materialize(source, 'third_party/cometbft/' + row.relative, row.raw, 'ORIGINAL_COMET_DESCRIPTOR_ONLY');
  for (const [name, raw] of verified.sdk.files) materialize(sdk, name, raw, 'AUTH_ORIGINAL_PUBLIC_SDK');
  const vector = write(privateRoot, 'public-inputs/vector.json', verified.vector.raw); staged.push({...pin(verified.vector.raw, vector), relative: 'public-inputs/vector.json', owner: 'AUTH_ORIGINAL_PUBLIC_VECTOR'});
  const ownedRoot = path.join(privateRoot, 'owned-r5'); fs.mkdirSync(ownedRoot, {mode: 0o700}); const protectedRows = ancestors(ownedRoot);
  return {source, sdk, vector, ownedRoot, protectedRows, staged, inputs: verified.inputs.map(v => v.pin), graph: verified.graph,
    ...(verified.requestIdentityHandoff ? {requestIdentityHandoff: verified.requestIdentityHandoff} : {}),
    ...(cloudLiveRead ? {cloudLiveReadHandoff: verified.cloudLiveReadHandoff} : {}),
    originalCandidateBytesUnchanged: true, wholePackageNotGoFilesSubset: true, sourceFiles: verified.sourceManifest.inputs.length,
    RootAdmission: false, SourceAdmission: false, normalRuntimePackageBuilt: false};
}
export function verifyP04CompositeUnchanged(composite) {
  for (const row of [...composite.inputs, ...composite.staged]) {
    need(row.bytes <= (256 << 20), 'bounded final source readback required');
    verifyBytes(read(row.path, Math.max(64 << 20, row.bytes)).raw, row, row.path);
  }
  ancestors(composite.ownedRoot); return true;
}
export function qualifyP04ConsumerEvents(raw, status, signal, error) {
  qualifyPackageEvents(raw, status, signal, error, packageName, [...P04_REQUIRED_TOPS, ...P04_REQUIRED_SUBTESTS]);
  return {tops: 5, negatives: 7, skipped: 0, failed: 0, actualRUNPASS: true, completePackageCompiled: true, PUBLICSeams: true, RootAdmission: false, SourceAdmission: false};
}

export function qualifyP04RequestIdentityEvents(suite, raw, status, signal, error) {
  const selected = requestIdentitySuites.find(item => item.name === suite);
  need(selected, 'only the fixed LINK and Auth request identity suites are accepted');
  const packagePath = moduleName + '/' + selected.package;
  return {package: packagePath, passed: qualifyPackageEvents(raw, status, signal, error, packagePath, selected.tests)};
}

export function qualifyP04CloudLiveReadEvents(raw, status, signal, error) {
  const packagePath = moduleName + '/' + cloudReadSuite.package;
  return {package: packagePath, passed: qualifyPackageEvents(raw, status, signal, error, packagePath, cloudReadSuite.tests)};
}

function qualifyPackageEvents(raw, status, signal, error, expectedPackage, expected) {
  need(status === 0 && signal === null && error === null, 'actual Go exit0/no signal/timeout required');
  const ran = [], passed = []; let packages = 0;
  for (const line of raw.split('\n').filter(Boolean)) {
    const row = parseJSON(Buffer.from(line), 'Go JSON event'); need(row.Package === expectedPackage, 'one actual consumer package required');
    need(row.Action !== 'fail' && row.Action !== 'skip', 'any package/top/subtest fail or skip is a failure');
    if (!row.Test) {if (row.Action === 'pass') {exact(passed, expected, 'all selected tests complete'); packages++;} continue;}
    need(expected.includes(row.Test), 'unexpected selected test/subtest');
    if (row.Action === 'run') ran.push(row.Test);
    if (row.Action === 'pass') {need(ran.filter(t => t === row.Test).length === 1, 'one actual RUN before PASS required'); passed.push(row.Test);}
  }
  exact(ran, expected, 'selected test RUNs'); exact(passed, expected, 'selected test PASSes'); need(packages === 1, 'one actual package PASS required');
  return passed;
}
export function runP04FiniteGETConsumerCI(env = process.env, requestIdentity = false, cloudLiveRead = false) {
  need(!(requestIdentity && cloudLiveRead), 'only one original CI suite per evidence root');
  need(env.CI === 'true' && env.GITHUB_ACTIONS === 'true' && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? ''), 'only original GitHub Actions execution; no local CI impersonation');
  need(['linux', 'darwin'].includes(process.platform) && /^v24\./.test(process.version), 'actual supported CI Node24 process required');
  const publicRoot = env.YNX_LINK_P04_CONSUMER_EVIDENCE, privateRoot = env.YNX_LINK_P04_CONSUMER_PRIVATE;
  need(typeof publicRoot === 'string' && typeof privateRoot === 'string' && !within(publicRoot, privateRoot) && !within(privateRoot, publicRoot), 'explicit disjoint roots required');
  freshRoot(publicRoot); freshRoot(privateRoot, true);
  const commands = []; let composite, qualification, failure;
  const json = (name, v) => write(publicRoot, name, Buffer.from(JSON.stringify(v, null, 2) + '\n'));
  function run(executable, args, name, cwd, variables, timeout) {
    const stdout = write(publicRoot, name + '.stdout', Buffer.alloc(0)), stderr = write(publicRoot, name + '.stderr', Buffer.alloc(0));
    const outFD = fs.openSync(stdout, 'w'), errFD = fs.openSync(stderr, 'w'); let r;
    try {r = spawnSync(executable, args, {cwd, env: variables, stdio: ['ignore', outFD, errFD], timeout});} finally {fs.closeSync(outFD); fs.closeSync(errFD);}
    const command = {command: executable, args, cwd, timeoutMS: timeout, pid: r.pid ?? null, status: r.status, signal: r.signal, error: r.error ? {code: r.error.code ?? null, message: r.error.message} : null,
      stdout: read(stdout).pin, stderr: read(stderr).pin}; commands.push(command); json(name + '.command.json', command);
    need(command.status === 0 && command.signal === null && command.error === null, 'actual command failed: ' + name); return {command, text: fs.readFileSync(stdout, 'utf8')};
  }
  try {
    composite = prepareP04ConsumerComposite({privateRoot, publicRoot, requestIdentity, cloudLiveRead});
    const prefix = env.OPENSSL_PREFIX; need(typeof prefix === 'string' && path.isAbsolute(prefix) && fs.realpathSync(prefix) === prefix &&
      env.PKG_CONFIG_PATH === path.join(prefix, 'lib/pkgconfig') && env.PKG_CONFIG_LIBDIR === env.PKG_CONFIG_PATH, 'same original private OpenSSL pkg-config context required');
    const variables = {...env, CGO_ENABLED: '1', GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB', GOTOOLCHAIN: 'local', GOWORK: 'off', GOFLAGS: '',
      PATH: path.join(prefix, 'bin') + path.delimiter + env.PATH, TMPDIR: path.join(privateRoot, 'test-tmp'), GOTMPDIR: path.join(privateRoot, 'go-tmp'),
      YNX_IDE_TEST_OWNED_ROOT: composite.ownedRoot, YNX_PUBLIC_R5_FACTORY_SDK: composite.sdk, YNX_PUBLIC_R5_VECTOR: composite.vector};
    for (const p of [variables.TMPDIR, variables.GOTMPDIR]) fs.mkdirSync(p, {mode: 0o700});
    // Copy ONLY this actual running CI Node, not the supplier's Mac executable.
    const nodeInput = read(fs.realpathSync(process.execPath), 256 << 20, true);
    variables.YNX_IDE_TEST_NODE = write(privateRoot, 'runtime/node', nodeInput.raw); fs.chmodSync(variables.YNX_IDE_TEST_NODE, 0o700);
    const nodeCopy = read(variables.YNX_IDE_TEST_NODE, 256 << 20); verifyBytes(nodeCopy.raw, nodeInput.pin, 'actual running Node copy');
    composite.staged.push({...nodeCopy.pin, relative: 'runtime/node', owner: 'ACTUAL_CI_NODE24_PRIVATE_COPY'});
    ancestors(path.dirname(variables.YNX_IDE_TEST_NODE));
    json('ACTUAL-NODE.json', {original: nodeInput.pin, privateCopy: nodeCopy.pin, version: process.version, platform: process.platform, arch: process.arch, suppliedMacBinaryUsed: false});
    json('SOURCE-BEFORE.json', composite);
    need(run('pkg-config', ['--modversion', 'openssl'], 'openssl-version', privateRoot, variables, 10000).text.trim() === '3.6.4', 'exact linked OpenSSL3.6.4 required');
    need(run('pkg-config', ['--variable=prefix', 'openssl'], 'openssl-prefix', privateRoot, variables, 10000).text.trim() === prefix, 'same original linked OpenSSL prefix required');
    need(/^OpenSSL 3\.6\.4 /.test(run('openssl', ['version'], 'openssl-cli', privateRoot, variables, 10000).text), 'actual selected CLI OpenSSL3.6.4 required');
    const go = parseJSON(Buffer.from(run('go', ['env', '-json', 'GOVERSION', 'GOCACHE', 'CGO_ENABLED', 'GOWORK'], 'go-environment', composite.source, variables, 30000).text), 'Go environment');
    need(go.GOVERSION === 'go1.26.10' && go.CGO_ENABLED === '1' && go.GOWORK === 'off' && go.GOCACHE === env.GOCACHE && path.isAbsolute(go.GOCACHE) && !within(publicRoot, go.GOCACHE), 'original pinned Go/cache/resource context required');
    if (cloudLiveRead) {
      const result = run('go', cloudReadArguments, cloudReadSuite.name, composite.source, variables, 210000);
      const verified = qualifyP04CloudLiveReadEvents(result.text, result.command.status, result.command.signal, result.command.error);
      qualification = {...verified, skipped: 0, failed: 0, actualRUNPASS: true, PUBLICSeams: true, responseRecorder: true, RootAdmission: false, SourceAdmission: false};
    } else if (requestIdentity) {
      const packages = requestIdentitySuites.map((suite, index) => {
        const result = run('go', requestIdentityArguments[index], suite.name, composite.source, variables, 210000);
        return qualifyP04RequestIdentityEvents(suite.name, result.text, result.command.status, result.command.signal, result.command.error);
      });
      qualification = {packages, skipped: 0, failed: 0, actualRUNPASS: true, PUBLICSeams: true, RootAdmission: false, SourceAdmission: false};
    } else {
      const result = run('go', P04_GO_ARGUMENTS, 'consumer-go', composite.source, variables, 210000);
      qualification = qualifyP04ConsumerEvents(result.text, result.command.status, result.command.signal, result.command.error);
    }
    verifyP04CompositeUnchanged(composite); json('SOURCE-AFTER.json', {unchanged: true, staged: composite.staged, inputs: composite.inputs});
  } catch (error) {failure = error;}
  let schema = 'YNX-LINK-P04-FINITE-GET-CONSUMER-CI/v1', state = 'PASS_COMPLETE_PACKAGE_PUBLIC_NATIVE_CONSUMER';
  if (requestIdentity) {schema = 'YNX-LINK-P04-REQUEST-IDENTITY-CI/v1'; state = 'PASS_ORIGINAL_REQUEST_IDENTITY_PUBLIC_NATIVE';}
  if (cloudLiveRead) {schema = 'YNX-LINK-P04-CLOUD-LIVE-READ-CI/v1'; state = 'PASS_CLOUD_LIVE_NATIVE_REQUEST_WITHOUT_GRANT';}
  const receipt = {schema, state: failure ? 'FAIL_FIRSTCAUSE_PRESERVED' : state, composite: composite ?? null,
    commands, qualification: qualification ?? null, failure: failure ? {message: failure.message, stack: failure.stack} : null,
    publicEvidenceRoot: publicRoot, privateWorkRoot: privateRoot, keysPublished: false, normalRuntimeArchiveBuilt: false, installed: false, deployed: false, RootAdmission: false, SourceAdmission: false};
  json('RESULT.json', receipt); if (failure) throw failure; return {result: path.join(publicRoot, 'RESULT.json'), qualification};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const requestIdentity = sameJSON(args, ['--original-request-identity']);
  const cloudLiveRead = sameJSON(args, ['--cloud-live-read']);
  need(args.length === 0 || requestIdentity || cloudLiveRead, 'only the fixed original CI modes are accepted');
  console.log(JSON.stringify(runP04FiniteGETConsumerCI(process.env, requestIdentity, cloudLiveRead)));
}
