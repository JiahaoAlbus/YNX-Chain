import { readFile, lstat, mkdir, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {identityAppCustodyPins,verifyIdentityAppCustodySource} from './identity-app-custody-source.mjs';

const developer = dirname(dirname(fileURLToPath(import.meta.url)));
const owned = join(developer, 'vendor/identity-admission');
// Source custody only. This public pin grants no root, role, session or service.
export const SUPPLIER_MANIFEST_SHA256 = '5afb7749381449a406be8fadf25f91ad4be8d54102334c68b5796c1c86070d0a';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const entry = 'scripts/ynx-ide-service-admission-supplier.mjs';
const nullSelection = 'scripts/original-ide-service-admission-native-selection.mjs';
const bare = ['@noble/curves/nist.js', '@noble/curves/secp256k1.js', '@noble/hashes/sha2.js', '@noble/hashes/sha3.js', '@noble/hashes/utils.js'];

export async function verifyIdentityAdmissionSource(root = owned) {
  for (const path of [root, join(root, 'scripts'), join(root, 'src')]) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Regular admission source directories required.');
  }
  for (const name of ['SUPPLIER_MANIFEST.json', 'receipt.json']) {
    const stat = await lstat(join(root, name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Regular admission source metadata required.');
  }
  const top = (await readdir(root)).sort();
  if (top.join('\n') !== ['SUPPLIER_MANIFEST.json', 'receipt.json', 'scripts', 'src'].join('\n')) throw Error('Unexpected admission source metadata.');
  const raw = await readFile(join(root, 'SUPPLIER_MANIFEST.json'));
  if (sha256(raw) !== SUPPLIER_MANIFEST_SHA256) throw Error('Admission source manifest differs from reviewed supplier.');
  const manifest = JSON.parse(raw), receipt = JSON.parse(await readFile(join(root, 'receipt.json')));
  if (receipt.schemaVersion !== 1 || receipt.sourceManifestSha256 !== SUPPLIER_MANIFEST_SHA256
    || receipt.sourceVersion !== manifest.version || receipt.sourceContentRoot !== manifest.contentRoot
    || receipt.sourceOnly !== true || receipt.runtimeTested !== false || receipt.selection !== 'not-configured'
    || !Array.isArray(receipt.files) || receipt.files.length !== 36) throw Error('Invalid admission source receipt.');
  const pins = new Map(manifest.files.map(pin => [pin.path, pin]));
  const paths = receipt.files.map(pin => pin.path);
  if (new Set(paths).size !== 36 || paths.some(path => !/^(scripts|src)\/[^/]+\.(mjs|js)$/.test(path))) throw Error('Invalid admission source paths.');
  for (const file of receipt.files) {
    const pin = pins.get('source/packages/wallet-auth/' + file.path);
    const stat = await lstat(join(root, file.path)), bytes = await readFile(join(root, file.path));
    if (!pin || !stat.isFile() || stat.isSymbolicLink() || file.bytes !== pin.bytes || file.sha256 !== pin.sha256
      || bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256
      || file.nullPath !== [entry, nullSelection].includes(file.path)) throw Error('Admission source leaf differs from reviewed supplier.');
  }
  const retained = (await Promise.all(['scripts', 'src'].map(async folder => (await readdir(join(root, folder))).map(name => folder + '/' + name)))).flat();
  if (retained.length !== 36 || retained.some(path => !paths.includes(path))) throw Error('Unexpected admission source leaf.');
  // Parse/bundle without executing any supplier, protected or crypto module.
  const graph = await build({ entryPoints: [join(root, entry)], absWorkingDir: root, bundle: true, write: false,
    platform: 'node', format: 'esm', packages: 'external', metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(graph.metafile.inputs);
  if (inputs.length !== 36 || inputs.some(path => !paths.includes(path))) throw Error('Admission source import closure differs.');
  return receipt;
}

export async function copyIdentityAdmissionSource(destination) {
  if (resolve(destination) !== destination || !destination.endsWith('/vendor/identity-admission')) throw Error('Exact packaged admission source path required.');
  const receipt = await verifyIdentityAdmissionSource();
  // Existing reviewed dependency bytes are packaged with Developer. Resolve
  // metadata only; do not import the crypto/runtime graph to qualify copying.
  const require = createRequire(join(owned, entry));
  for (const specifier of bare) {
    const path = require.resolve(specifier);
    if (!path.startsWith(join(developer, 'node_modules/@noble') + '/')) throw Error('Admission dependency escaped Developer.');
  }
  for (const name of ['curves', 'hashes']) {
    const metadata = JSON.parse(await readFile(join(developer, 'node_modules/@noble', name, 'package.json')));
    if (metadata.version !== '2.2.0' || metadata.license !== 'MIT') throw Error('Reviewed admission dependency version/license required.');
  }
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination); // Never replace an existing candidate.
  for (const file of [...receipt.files, { path: 'SUPPLIER_MANIFEST.json' }, { path: 'receipt.json' }]) {
    const target = join(destination, file.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(owned, file.path), target, 1);
  }
  await verifyIdentityAdmissionSource(destination);
  return { sourceLeaves: 36, manifestSha256: SUPPLIER_MANIFEST_SHA256, sharedModulesExecuted: false };
}
// Canonical source custody is independent of runtime service admission. Keep the
// original SDK loader relative to its unique apps/wallet-desktop Native module.
export const CANONICAL_IDENTITY_INPUTS_SHA256 = '5d2b6a0854e8234221f6c3deb32c6ed8e33d5b84b6b1a82e5b2e50aff8f62f4b';
// These select source custody, never runtime authority. Every selected byte is
// still checked against the immutable manifest; there is no fallback on error.
const canonicalOwned = resolve(process.env.YNX_DEVELOPER_CANONICAL_SDK_ROOT || resolve(developer, '../../packages/wallet-auth'));
const canonicalDependencies = resolve(process.env.YNX_DEVELOPER_CANONICAL_DEPENDENCY_ROOT || join(developer,'node_modules'));
// The build parser is not part of the held SDK runtime. Keep its existing
// reviewed tool installation separate from the new runtime-only dependency root.
const canonicalBuildDependencies = resolve(process.env.YNX_DEVELOPER_CANONICAL_BUILD_DEPENDENCY_ROOT || canonicalDependencies);
async function build(options) {
  // Parse with the already-installed, declared SDK tool. Never resolve an
  // ancestor's unrelated esbuild when a source-only stage has no node_modules.
  const tool=join(canonicalBuildDependencies,'esbuild');
  const stat=await lstat(tool), metadata=JSON.parse(await readFile(join(tool,'package.json')));
  if(!stat.isDirectory() || stat.isSymbolicLink() || metadata.name!=='esbuild' || metadata.version!=='0.25.9') throw Error('Declared canonical esbuild 0.25.9 required.');
  return createRequire(import.meta.url)(tool).build(options);
}
async function canonicalInputs() {
  const bytes = await readFile(new URL('./canonical-identity-inputs.json', import.meta.url));
  if (sha256(bytes) !== CANONICAL_IDENTITY_INPUTS_SHA256) throw Error('Canonical identity source manifest differs.');
  const record = JSON.parse(bytes);
  if (record.schemaVersion !== 1 || record.sourceOnly !== true || record.sdkCommit !== '95cf7484dd3d4503b4a1e13c9ba47b7900132322' || record.sdkTree !== '67ac87938c18c987e50524efa0ee634b151a5abd') throw Error('Canonical identity source selection differs.');
  for (const rows of [record.files, record.dependencies, record.nativeSources, record.nativeBuildInputs]) {
    if (!Array.isArray(rows) || !rows.length || new Set(rows.map(x => x.path)).size !== rows.length) throw Error('Canonical identity source inventory differs.');
    for (const row of rows) if (!/^[A-Za-z0-9_@./-]+$/.test(row.path) || row.path.startsWith('/') || row.path.split('/').some(p => !p || p === '.' || p === '..') || !Number.isSafeInteger(row.bytes) || !/^[a-f0-9]{64}$/.test(row.sha256)) throw Error('Canonical identity source pin differs.');
  }
  return record;
}
async function verifyRows(root, rows) {
  const rootStat=await lstat(root);
  if(!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Regular canonical source root required.');
  const expected = new Set(rows.map(row => row.path));
  for (const row of rows) {
    let parent = root;
    for (const name of row.path.split('/').slice(0, -1)) {
      parent = join(parent, name); const st = await lstat(parent);
      if (!st.isDirectory() || st.isSymbolicLink()) throw Error('Canonical identity directory differs.');
    }
    const file = join(root, row.path), st = await lstat(file), bytes = await readFile(file);
    if (!st.isFile() || st.isSymbolicLink() || bytes.length !== row.bytes || sha256(bytes) !== row.sha256) throw Error('Canonical identity source leaf differs: ' + row.path);
  }
  return expected;
}
export async function verifyCanonicalIdentityAdmissionSource(root = canonicalOwned, dependencies = root === canonicalOwned ? canonicalDependencies : join(root, 'node_modules')) {
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Regular canonical identity directory required.');
  const record = await canonicalInputs();
  await verifyRows(root, record.files);
  await verifyRows(dependencies, record.dependencies);
  const closure=record.runtimeClosure;
  if(closure?.version!==1||closure.files!==454||closure.edges!==123||closure.nativeQualified!==false||closure.registrationAccepted!==false
    ||closure.manifest?.path!=='native/original-ide-auth-runtime-manifest.json')throw Error('Canonical SDK329 runtime closure selection differs.');
  const held=record.files.find(row=>row.path===closure.manifest.path);
  if(!held||held.bytes!==closure.manifest.bytes||held.sha256!==closure.manifest.sha256)throw Error('Canonical runtime manifest is not held by the SDK selection.');
  const runtime=JSON.parse(await readFile(join(root,held.path)));
  if(runtime.version!=='YNX-ORIGINAL-AUTH-RUNTIME-CLOSURE/v1'||runtime.files?.length!==454||new Set(runtime.files.map(row=>row.path)).size!==454)throw Error('Canonical runtime manifest inventory differs.');
  const rows=new Map([...record.files,...record.dependencies.map(row=>({...row,path:'node_modules/'+row.path}))].map(row=>[row.path,row]));
  for(const row of runtime.files){const selected=rows.get(row.path);if(!selected||selected.bytes!==row.bytes||selected.sha256!==row.sha256)throw Error('Canonical runtime manifest leaf differs: '+row.path);}
  if (root !== canonicalOwned) {
    const expected = new Set([...record.files.map(row => row.path), ...(dependencies===join(root,'node_modules') ? record.dependencies.map(row => 'node_modules/' + row.path) : [])]);
    const expectedDirectories = new Set();
    for (const file of expected) {
      const parts = file.split('/');
      for (let i = 1; i < parts.length; i++) expectedDirectories.add(parts.slice(0, i).join('/'));
    }
    const seen = [];
    async function inventory(folder, prefix = '') {
      for (const name of await readdir(folder)) {
        const relative = prefix + name, stat = await lstat(join(folder, name));
        if (stat.isDirectory() && !stat.isSymbolicLink() && expectedDirectories.has(relative)) await inventory(join(folder, name), relative + '/');
        else if (stat.isFile() && !stat.isSymbolicLink() && expected.has(relative)) seen.push(relative);
        else throw Error('Canonical identity inventory differs: ' + relative);
      }
    }
    await inventory(root);
    if (seen.length !== expected.size) throw Error('Canonical identity inventory differs.');
  }
  // Parse the actual configured/lazy import graph without executing imports or
  // Native code. Every relative SDK input must belong to the pinned inventory.
  const graph = await build({entryPoints:[join(root, entry)], absWorkingDir:root,
    bundle:true,write:false,platform:'node',format:'esm',packages:'external',metafile:true,logLevel:'silent'});
  const paths = new Set(record.files.map(row => row.path));
  if (Object.keys(graph.metafile.inputs).some(path => !paths.has(path))) throw Error('Canonical identity import closure differs.');
  return record;
}
export async function copyCanonicalIdentityAdmissionSource(codeRoot) {
  if (typeof codeRoot !== 'string' || resolve(codeRoot) !== codeRoot || !codeRoot.endsWith('/Contents/Resources/code')) throw Error('Exact canonical code root required.');
  const codeStat = await lstat(codeRoot);
  if (!codeStat.isDirectory() || codeStat.isSymbolicLink()) throw Error('Regular canonical code root required.');
  const record = await verifyCanonicalIdentityAdmissionSource(canonicalOwned, canonicalDependencies);
  const destination = join(codeRoot, 'packages/wallet-auth');
  await mkdir(dirname(destination), {recursive:true});
  const packageStat = await lstat(dirname(destination));
  if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) throw Error('Regular canonical packages directory required.');
  await mkdir(destination); // No merging or replacement of an existing payload.
  for (const [source, targetRoot, rows] of [[canonicalOwned,destination,record.files],
    [canonicalDependencies,join(destination,'node_modules'),record.dependencies]]) {
    for (const row of rows) {
      const target = join(targetRoot,row.path); await mkdir(dirname(target),{recursive:true});
      await copyFile(join(source,row.path),target,1);
    }
  }
  await verifyCanonicalIdentityAdmissionSource(destination);
  return {sourceLeaves:record.files.length,dependencyLeaves:record.dependencies.length,
    manifestSha256:CANONICAL_IDENTITY_INPUTS_SHA256,sharedModulesExecuted:false,nativeModuleCopied:false};
}

const nativeRelative = 'apps/wallet-desktop/native/original-auth-identity.node';
const nativeReceiptRelative = 'apps/wallet-desktop/native/original-auth-identity-build.json';
const nativeEvidenceRelative = 'apps/wallet-desktop/native/original-auth-identity-component-evidence.json';
const repository = resolve(developer, '../..');
const canonicalNativeRoot = resolve(process.env.YNX_DEVELOPER_CANONICAL_NATIVE_ROOT || repository);
const safeRelative = value => typeof value === 'string' && /^[A-Za-z0-9_@./-]+$/.test(value) && !value.startsWith('/') && !value.split('/').some(p => !p || p === '.' || p === '..');

// The App holder is an exact original Auth input, not a Node NAPI TU. A former
// SDK/Native selection cannot silently compile the new caller with a loose or
// SDK-tar-only header. Keep source custody separate from any runtime grant.
const identityAppSources = Object.freeze([
  Object.freeze({path:'packages/wallet-auth/native/original-ide-identity-launch-holder.h',bytes:1897,sha256:'a788b5290c58d8140eef80cf7176653b0019e0a9922cc90d017b30f845d38ce2'}),
  Object.freeze({path:'packages/wallet-auth/native/original-ide-identity-launch-holder.mm',bytes:14709,sha256:'6db6ea2f3cc63a2a95cd0557754f035f51549ac6fa5d8f1373a0072a98467fa1'}),
]);
export function validateOriginalIdentityAppSources(inputs, receipt) {
  for(const pin of identityAppSources){
    const found=inputs?.nativeSources?.filter(row=>row.path===pin.path);
    if(found?.length!==1||found[0].bytes!==pin.bytes||found[0].sha256!==pin.sha256)
      throw Error('Original identity App holder source selection differs: '+pin.path);
    // The original builder inventories all materialized source inputs, including
    // App-only files. That is not its translation-unit list. Inspect actual
    // recorded compiler argv, rather than rejecting a complete source inventory.
    if(pin.path.endsWith('.mm')&&receipt?.commands?.some(command=>command.argv?.includes(join(receipt.sourceRoot,pin.path))))
      throw Error('Original identity App holder must not be a Node NAPI translation unit.');
  }
  return identityAppSources;
}

// A build receipt records compilation, never registration or service rights.
export function validateCanonicalNativeBuildReceipt(record, inputs, targetArchitecture = process.arch) {
  if (record?.schemaVersion !== 1 || record.kind !== 'YNX_WALLET_ORIGINAL_NATIVE_BUILD'
    || record.napiVersion !== 8 || record.headerVersion !== '22.13.1'
    || record.minimumSystemVersion !== '13.0'
    || (record.readbackOnly !== true && record.readbackOnly !== false)
    || record.commandsKind !== (record.readbackOnly ? 'normal-build-plan' : 'executed-normal-build')
    || record.appSigned !== false
    || record.nativeQualified !== false || record.registrationAccepted !== false
    || !Array.isArray(record.architectures) || !record.architectures.length
    || record.architectures.some(a => !['arm64', 'x64', 'x86_64'].includes(a))
    || !record.architectures.map(a => a === 'x86_64' ? 'x64' : a).includes(targetArchitecture === 'x86_64' ? 'x64' : targetArchitecture)
    || record.relativeBases?.inputFiles !== 'repository-root'
    || record.relativeBases?.output !== 'repository-root'
    || record.relativeBases?.headers !== 'pinned-header-root'
    || record.output?.relative !== nativeRelative
    || !Number.isSafeInteger(record.output.bytes) || record.output.bytes <= 0
    || !/^[a-f0-9]{64}$/.test(record.output.sha256)
    || !Array.isArray(record.commands) || !record.commands.length
    || !Array.isArray(record.inputFiles) || !Array.isArray(record.headers)
    || record.headers.length < 4 || !safeRelative(record.headers[0]?.relative)
    || typeof record.headerRoot !== 'string' || resolve(record.headerRoot) !== record.headerRoot) throw Error('Canonical Native build receipt differs.');
  if (typeof record.sourceRoot !== 'string' || resolve(record.sourceRoot) !== record.sourceRoot) throw Error('Canonical Native source root differs.');
  // Keep historical receipt validation available to the original derivation
  // controls. The active SDK329 selection itself always requires the new App
  // holder; an older receipt cannot select or activate the current candidate.
  if(inputs.runtimeClosure)validateOriginalIdentityAppSources(inputs,record);
  if (record.readbackOnly && (typeof record.existingComponentEvidence?.path !== 'string'
    || resolve(record.existingComponentEvidence.path) !== record.existingComponentEvidence.path
    || !Number.isSafeInteger(record.existingComponentEvidence.bytes)
    || !/^[a-f0-9]{64}$/.test(record.existingComponentEvidence.sha256))) throw Error('Canonical Native actual compilation evidence required.');
  const pins = new Map(inputs.nativeBuildInputs.map(row => [row.path, row]));
  const seen = new Set();
  for (const row of record.inputFiles) {
    const pin = pins.get(row.relative);
    if (!safeRelative(row.relative) || seen.has(row.relative) || !pin || pin.bytes !== row.bytes || pin.sha256 !== row.sha256) throw Error('Canonical Native source pin differs.');
    seen.add(row.relative);
  }
  // The original builder records the Native source closure, including headers
  // and textual includes. Six translation units alone cannot bind the module
  // to a changed transport header. Keep the IDE-only supplier and standalone
  // C++ controls outside the Node component's existing build inventory.
  for (const pin of inputs.nativeBuildInputs) if (!seen.has(pin.path)) throw Error('Canonical Native build input closure differs.');
  if (seen.size !== inputs.nativeBuildInputs.length || record.output.bytes !== inputs.nativeComponent.module.bytes || record.output.sha256 !== inputs.nativeComponent.module.sha256) throw Error('Canonical Native component selection differs.');
  const units = ['apps/wallet-desktop/native/original-auth-identity-node.mm',
    'packages/wallet-auth/native/original-auth-identity-joint-owner.mm',
    'packages/wallet-auth/native/original-auth-identity-source-authority.mm',
    'packages/wallet-auth/native/original-ide-parent-source-binding.mm',
    'packages/wallet-auth/native/original-ide-parent-kernel.mm',
    'packages/wallet-auth/native/original-ide-parent-node.mm'];
  for (const required of units) if (!seen.has(required)) throw Error('Canonical Native build closure differs.');
  const headers = new Map(inputs.node22HeaderPins.map(pin => [pin.path, pin]));
  const selectedHeaders = new Set();
  for (const row of record.headers) {
    const pin = headers.get(row.relative);
    if (!pin || selectedHeaders.has(row.relative) || pin.bytes !== row.bytes || pin.sha256 !== row.sha256) throw Error('Canonical Native Node22 header pin differs.');
    selectedHeaders.add(row.relative);
  }
  for (const name of ['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h', 'node_version.h']) if (!selectedHeaders.has(name)) throw Error('Canonical Native Node22 header closure differs.');
  const compilers = record.commands.filter(command => command.tool === '/usr/bin/clang++');
  if (!compilers.length || compilers.some(command => !Array.isArray(command.argv)
    || ['-std=c++17', '-fobjc-arc', '-dynamiclib', '-DNAPI_VERSION=8', '-mmacosx-version-min=13.0', '-lbsm', 'Foundation', 'Security'].some(flag => !command.argv.includes(flag))
    || units.some(unit => !command.argv.includes(join(record.sourceRoot, unit))))) throw Error('Canonical Native compile command differs.');
  return record;
}

async function verifyComponentEvidence(record, packagedCodeRoot) {
  if (!record.readbackOnly) return undefined;
  const pin=record.existingComponentEvidence;
  const path=packagedCodeRoot ? join(packagedCodeRoot,nativeEvidenceRelative) : pin.path;
  const st=await lstat(path), raw=await readFile(path);
  if (!st.isFile() || st.isSymbolicLink() || raw.length!==pin.bytes || sha256(raw)!==pin.sha256) throw Error('Canonical Native compilation evidence differs.');
  const evidence=JSON.parse(raw);
  if (evidence.module?.sha256!==record.output.sha256 || evidence.module?.bytes!==record.output.bytes || !Array.isArray(evidence.terms)
    || ['NATIVE_V2_COMPILE_LINK','ACTUAL_PASSIVE_NAPI_LOAD'].some(phase => !evidence.terms.some(term => term.phase===phase && term.actualExit===0 && !term.guardFailure))) throw Error('Canonical Native actual compile/load evidence differs.');
  return raw;
}

// Validate the COMPLETE independent Native source before either copying the
// original component or compiling the IDE's own shell. SDK tar Native files
// are not a substitute for this closure.
export async function verifyCanonicalNativeSourceSelection(root = canonicalNativeRoot, ideRoot = repository) {
  const stat=await lstat(root);
  if (resolve(root)!==root || !stat.isDirectory() || stat.isSymbolicLink()) throw Error('Regular canonical Native source root required.');
  const inputs=await canonicalInputs();
  validateOriginalIdentityAppSources(inputs);
  await verifyRows(ideRoot,inputs.nativeSources.filter(row=>row.path.startsWith('apps/developer/')));
  await verifyRows(root,inputs.nativeSources.filter(row=>!row.path.startsWith('apps/developer/')));
  const receiptBytes=await readFile(join(root,nativeReceiptRelative));
  if(receiptBytes.length!==inputs.nativeComponent.receipt.bytes || sha256(receiptBytes)!==inputs.nativeComponent.receipt.sha256) throw Error('Canonical Native receipt bytes differ.');
  const record=validateCanonicalNativeBuildReceipt(JSON.parse(receiptBytes),inputs);
  await verifyRows(root,[inputs.nativeComponent.module]);
  return {root,sourceLeaves:inputs.nativeSources.length,buildInputLeaves:inputs.nativeBuildInputs.length,nativeQualified:false,registrationAccepted:false};
}

export async function copyCanonicalNativeModule(codeRoot) {
  if (resolve(codeRoot) !== codeRoot || !codeRoot.endsWith('/Contents/Resources/code')) throw Error('Exact canonical code root required.');
  const codeStat = await lstat(codeRoot);
  if (!codeStat.isDirectory() || codeStat.isSymbolicLink()) throw Error('Regular canonical code root required.');
  const inputs = await canonicalInputs();
  await verifyCanonicalNativeSourceSelection();
  const receiptPath = join(canonicalNativeRoot, nativeReceiptRelative), receiptBytes = await readFile(receiptPath);
  if (receiptBytes.length!==inputs.nativeComponent.receipt.bytes || sha256(receiptBytes)!==inputs.nativeComponent.receipt.sha256) throw Error('Canonical Native receipt bytes differ.');
  const record = validateCanonicalNativeBuildReceipt(JSON.parse(receiptBytes), inputs);
  const evidenceBytes = await verifyComponentEvidence(record);
  await verifyRows(canonicalNativeRoot, inputs.nativeSources.filter(row=>!row.path.startsWith('apps/developer/')));
  const headerRows = record.headers.map(row => ({...row, path:row.relative}));
  if (new Set(headerRows.map(row => row.path)).size !== headerRows.length || headerRows.some(row => !safeRelative(row.path) || !Number.isSafeInteger(row.bytes) || !/^[a-f0-9]{64}$/.test(row.sha256))) throw Error('Canonical Native header pin differs.');
  await verifyRows(record.headerRoot, headerRows);
  await verifyRows(canonicalNativeRoot, [{...record.output,path:nativeRelative}]);
  const destination = join(codeRoot, dirname(nativeRelative));
  await mkdir(dirname(destination),{recursive:true});
  await mkdir(destination); // A second module/copy may not be merged silently.
  await copyFile(join(canonicalNativeRoot,nativeRelative),join(codeRoot,nativeRelative),1);
  await copyFile(receiptPath,join(codeRoot,nativeReceiptRelative),1);
  if (evidenceBytes) {
    const {writeFile}=await import('node:fs/promises');
    await writeFile(join(codeRoot,nativeEvidenceRelative),evidenceBytes,{flag:'wx'});
  }
  await verifyRows(codeRoot,[{...record.output,path:nativeRelative},
    {path:nativeReceiptRelative,bytes:receiptBytes.length,sha256:sha256(receiptBytes)}]);
  await verifyComponentEvidence(record,codeRoot);
  return {path:'code/'+nativeRelative,sourceSha256:record.output.sha256,
    buildReceipt:{path:'code/'+nativeReceiptRelative,sha256:sha256(receiptBytes),readbackOnly:record.readbackOnly,commandsKind:record.commandsKind},
    sourcePinsVerified:true,registrationAccepted:false};
}

export async function sealCanonicalNativeModule(resources) {
  await verifyIdentityAppCustodySource();
  await verifyCanonicalIdentityAdmissionSource(join(resources,'code/packages/wallet-auth'));
  const modulePath=join(resources,'code',nativeRelative), receiptPath=join(resources,'code',nativeReceiptRelative);
  const bytes=await readFile(modulePath), raw=await readFile(receiptPath), inputs=await canonicalInputs();
  if(raw.length!==inputs.nativeComponent.receipt.bytes || sha256(raw)!==inputs.nativeComponent.receipt.sha256) throw Error('Canonical Native receipt bytes differ.');
  const receipt=validateCanonicalNativeBuildReceipt(JSON.parse(raw),inputs);
  await verifyComponentEvidence(receipt,join(resources,'code'));
  const signature=spawnSync('/usr/bin/codesign',['-dv','--verbose=4',modulePath],{encoding:'utf8'});
  if (signature.status!==0 || !signature.stderr.includes('Signature=adhoc') || !signature.stderr.includes('TeamIdentifier=not set')) throw Error('Canonical Native preview signing class differs.');
  execFileSync('/usr/bin/codesign',['--verify','--strict',modulePath],{stdio:'pipe'});
  const path=join(resources,'build-provenance.json'), provenance=JSON.parse(await readFile(path,'utf8'));
  provenance.identityAdmissionDistribution={schemaVersion:1,canonicalLayoutVerified:true,
    identityAppCustodySource:identityAppCustodyPins,
    sdkManifestSha256:CANONICAL_IDENTITY_INPUTS_SHA256,
    nativeModule:{path:'Contents/Resources/code/'+nativeRelative,sourceSha256:receipt.output.sha256,
      packagedSha256:sha256(bytes),packagedBytes:bytes.length},
    nativeBuildReceipt:{path:'Contents/Resources/code/'+nativeReceiptRelative,sha256:sha256(raw),readbackOnly:receipt.readbackOnly,commandsKind:receipt.commandsKind},
    ...(receipt.readbackOnly ? {nativeComponentEvidence:{path:'Contents/Resources/code/'+nativeEvidenceRelative,
      bytes:receipt.existingComponentEvidence.bytes,sha256:receipt.existingComponentEvidence.sha256}} : {}),
    nativeQualified:false,registrationAccepted:false};
  await import('node:fs/promises').then(({writeFile})=>writeFile(path,JSON.stringify(provenance,null,2)+'\n'));
}

export async function verifySealedCanonicalNativeModule(resources) {
  const provenance=JSON.parse(await readFile(join(resources,'build-provenance.json'),'utf8'));
  const record=provenance.identityAdmissionDistribution;
  if (record?.schemaVersion!==1 || record.canonicalLayoutVerified!==true
    || JSON.stringify(record.identityAppCustodySource)!==JSON.stringify(identityAppCustodyPins)
    || record.sdkManifestSha256!==CANONICAL_IDENTITY_INPUTS_SHA256
    || record.nativeQualified!==false || record.registrationAccepted!==false
    || record.nativeModule?.path!=='Contents/Resources/code/'+nativeRelative
    || record.nativeBuildReceipt?.path!=='Contents/Resources/code/'+nativeReceiptRelative) throw Error('Canonical Native distribution differs.');
  await verifyCanonicalIdentityAdmissionSource(join(resources,'code/packages/wallet-auth'));
  const raw=await readFile(join(resources,'code',nativeReceiptRelative)), inputs=await canonicalInputs();
  if(raw.length!==inputs.nativeComponent.receipt.bytes || sha256(raw)!==inputs.nativeComponent.receipt.sha256) throw Error('Canonical Native receipt bytes differ.');
  const receipt=validateCanonicalNativeBuildReceipt(JSON.parse(raw),inputs);
  await verifyComponentEvidence(receipt,join(resources,'code'));
  if (receipt.readbackOnly && (record.nativeComponentEvidence?.path!=='Contents/Resources/code/'+nativeEvidenceRelative
    || record.nativeComponentEvidence?.bytes!==receipt.existingComponentEvidence.bytes
    || record.nativeComponentEvidence?.sha256!==receipt.existingComponentEvidence.sha256)) throw Error('Canonical Native compilation evidence ledger differs.');
  if (sha256(raw)!==record.nativeBuildReceipt.sha256 || receipt.output.sha256!==record.nativeModule.sourceSha256 || receipt.readbackOnly!==record.nativeBuildReceipt.readbackOnly || receipt.commandsKind!==record.nativeBuildReceipt.commandsKind) throw Error('Canonical Native receipt differs after signing.');
  await verifyRows(resources,[{path:'code/'+nativeRelative,bytes:record.nativeModule.packagedBytes,sha256:record.nativeModule.packagedSha256}]);
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--native-source-root') console.log((await verifyCanonicalNativeSourceSelection()).root);
  else if (process.argv[2] === '--seal-native') await sealCanonicalNativeModule(process.argv[3]);
  else if (process.argv[2] === '--verify-native') console.log(JSON.stringify(await verifySealedCanonicalNativeModule(process.argv[3])));
  else if (process.argv[2] === '--copy-native') console.log(JSON.stringify(await copyCanonicalNativeModule(process.argv[3])));
  else if (process.argv[2]?.endsWith('/Contents/Resources/code')) {
    console.log(JSON.stringify(await copyCanonicalIdentityAdmissionSource(process.argv[2])));
  } else console.log(JSON.stringify(await copyIdentityAdmissionSource(process.argv[2])));
}
