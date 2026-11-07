import {readFile, lstat, realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join, posix} from 'node:path';

// One physical SDK, fixed by the application layout. No env/provider override.
// Pins are package-integrity data, never Source, Root or Native authority.
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const prefix = join(root, 'vendor/identity-admission');
const publicNames = new Set(['original-ide-held-session-read', 'original-ide-admission', 'original-ide-deployment-v2', 'original-ide-contract-relay-guard']);
const contractImportEntries = Object.freeze({
  'walletconnect-dapp-connection': 'src/walletconnect-dapp-connection.js',
  'pq-contract-deployment-material': 'src/pq-contract-deployment-material.js',
  'pq-native-action': 'src/pq-native-action.js',
});
const allPublicNames = [...publicNames, ...Object.keys(contractImportEntries)];
const privateNames = new Set(['scripts/ynx-ide-service-admission-supplier.mjs', 'src/original-ide-service-admission-startup.js']);
const fail = () => Object.assign(Error('Bundled identity SDK integrity or Node export resolution differs.'), {code:'YNX_PRODUCT_SDK_RESOLUTION_MISMATCH'});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const projectionModule='scripts/ide-runtime-source-projection.mjs';
function publicNodeEntry(name,pkg){
  const exp=pkg.exports?.['./'+name];
  if(!exp||Object.keys(exp).some(k=>!['node','types','browser','default'].includes(k))||exp.browser!==null||exp.default!==null||typeof exp.node!=='string'||!/^\.\/(?:src|native)\/[A-Za-z0-9_-]+\.(?:mjs|js)$/.test(exp.node))throw fail();
  return exp.node.slice(2);
}
// These existing formal connection/DATA exports deliberately have a
// different schema. Keep identity/guard exports Node-only; never generalize
// this into an arbitrary import/default resolver.
function publicEntry(name,pkg){
  if(publicNames.has(name))return publicNodeEntry(name,pkg);
  const expected=Object.hasOwn(contractImportEntries,name)&&contractImportEntries[name],exp=pkg.exports?.['./'+name];
  if(!expected||!exp||Array.isArray(exp)||Object.keys(exp).sort().join()!=='default,import,types'
    ||exp.import!=='./'+expected||exp.default!==exp.import||exp.types!=='./'+expected.replace(/\.js$/,'.d.ts'))throw fail();
  return expected;
}
// Shared DATA preflight for the normal producer and the production loader.
// Inspecting this surface never imports SDK code or grants service authority.
export function assertBundledSDKPublicExports(pkg){
  if(pkg?.name!=='@ynx-chain/wallet-auth'||pkg.type!=='module')throw fail();
  for(const name of allPublicNames)publicEntry(name,pkg);
}
async function regular(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || await realpath(path) !== path) throw fail();
  return stat;
}
async function verify() {
  if (await realpath(prefix) !== prefix) throw fail();
  const manifestPath = join(root, 'identity-sdk-pins.json');
  await regular(manifestPath);
  const manifestRaw=await readFile(manifestPath),manifest = JSON.parse(manifestRaw);
  if (manifest.schema !== 'YNX_IDE_SDK_CODE_PINS/v1' || !Array.isArray(manifest.files) || !manifest.files.length) throw fail();
  const pins = new Map();
  for (const row of manifest.files) {
    if (typeof row.path !== 'string' || row.path.startsWith('/') || row.path.includes('\\') || posix.normalize(row.path) !== row.path || row.path.split('/').includes('..') || pins.has(row.path) || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !/^[a-f0-9]{64}$/.test(row.sha256)) throw fail();
    const path = join(prefix, row.path), stat = await regular(path), bytes = await readFile(path);
    if (stat.size !== row.bytes || bytes.length !== row.bytes || sha(bytes) !== row.sha256) throw fail();
    pins.set(row.path, row);
  }
  if (!pins.has('package.json')) throw fail();
  const pkg = JSON.parse(await readFile(join(prefix, 'package.json')));
  assertBundledSDKPublicExports(pkg);
  if(pins.has(projectionModule)){
    // The expected projection pin comes from an independent package binding,
    // never from the unverified projection's own claimed hash.
    const bindingPath=join(root,'identity-sdk-projection-binding.json');await regular(bindingPath);
    const bindingRaw=await readFile(bindingPath),binding=JSON.parse(bindingRaw);
    if(binding.schema!=='YNX_IDE_SDK_PROJECTION_BINDING/v1'||!['SDK49-IDE-R2-SOURCE-ARCHIVE-RUNTIME/v1','SDK49-IDE-ROOT63-SOURCE-ARCHIVE-RUNTIME/v1','SDK49-IDE-ROOT63-CURRENT-PRODUCTION-SOURCE-ARCHIVE-RUNTIME/v1','SDK49-IDE-C6-DIAGNOSTIC-PRODUCTION-SOURCE-ARCHIVE-RUNTIME/v1','SDK49-IDE-C6-SCOPE-PHASE-SOURCE-ARCHIVE-RUNTIME/v1'].includes(binding.sourceVariant)||binding.projection?.path!=='identity-sdk-source-projection.json'||binding.runtimeInventory?.path!=='identity-sdk-projected-runtime-inventory.json')throw fail();
    if(binding.sourceVariant==='SDK49-IDE-ROOT63-SOURCE-ARCHIVE-RUNTIME/v1'&&(bindingRaw.length!==424||sha(bindingRaw)!=='d62f48d794f7869a0a969289c5c299b8f17c80ad8e96d907a8ba47c4a6def13a'||manifestRaw.length!==645246||sha(manifestRaw)!=='ea6092f59d43ae8c84a25699789d3e906d9d6864978e07f9dbb76eaba8494def'))throw fail();
    if(binding.sourceVariant==='SDK49-IDE-ROOT63-CURRENT-PRODUCTION-SOURCE-ARCHIVE-RUNTIME/v1'&&(bindingRaw.length!==443||sha(bindingRaw)!=='f3700cf2656674384091c86ea0486a31e707bfb1813ac319e1600a5039583afe'||manifestRaw.length!==648772||sha(manifestRaw)!=='53c1bb3f4a06a1bc814db2c3a266b2f8f7897f74bdb27e273f814d34e9304403'))throw fail();
    if(binding.sourceVariant==='SDK49-IDE-C6-DIAGNOSTIC-PRODUCTION-SOURCE-ARCHIVE-RUNTIME/v1'&&(bindingRaw.length!==442||sha(bindingRaw)!=='1f3ecbcceb9a53f6e1d90ed938e0fb840ee15971e7bba55fc05085e46859316b'||manifestRaw.length!==663960||sha(manifestRaw)!=='ee36ff61d7c8b53ae65f8ca1d9ba1759d79bd88056597145fd45ca0514a8182a'))throw fail();
    if(binding.sourceVariant==='SDK49-IDE-C6-SCOPE-PHASE-SOURCE-ARCHIVE-RUNTIME/v1'&&(bindingRaw.length!==432||sha(bindingRaw)!=='db5b6b1427fcdc9b2205b55fc0ab32670f2be91fd13c4ede4c9e8c8f8ae3c6ed'||manifestRaw.length!==664251||sha(manifestRaw)!=='33fc0a2f165165480d5603bcd33f1b0f97f7d9ecc70a017b9166e54fa13eef31'))throw fail();
    for(const row of [binding.projection,binding.runtimeInventory]){
      if(!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>4*1024**2||!/^[a-f0-9]{64}$/.test(row.sha256))throw fail();
      const path=join(root,row.path);await regular(path);const bytes=await readFile(path);
      if(bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw fail();
    }
    const provenancePath=fileURLToPath(new URL('../../../build-provenance.json',pathToFileURL(root+'/')));await regular(provenancePath);
    const provenance=JSON.parse(await readFile(provenancePath)),bound=provenance.packagedSDKSourceProjection;
    if(bound?.path!=='Contents/Resources/code/apps/developer/identity-sdk-projection-binding.json'||bound.bytes!==bindingRaw.length||bound.sha256!==sha(bindingRaw))throw fail();
    // This exact Node IO verifier was itself pinned above with all other code.
    // It decodes bounded custody data in memory, without extraction/execution.
    const verifier=await import(pathToFileURL(join(prefix,projectionModule)).href);
    const outcome=verifier.verifyIDERuntimeSourceProjection(prefix,join(root,binding.projection.path),binding.projection);
    if(outcome?.sourceVariant!==binding.sourceVariant||outcome.archiveVerified!==true||outcome.archivedSources!==4||outcome.extracts!==false||outcome.executes!==false||outcome.RootAdmission!==false||outcome.SourceAdmission!==false||outcome.NativeAdmission!==false)throw fail();
  }else{
    try{await lstat(join(prefix,projectionModule));throw fail();}catch(error){if(error.code!=='ENOENT')throw error;}
    // A projected package cannot downgrade to the unprojected loader path by
    // removing its verifier from the caller-controlled code-pin table.
    try{await lstat(join(root,'identity-sdk-projection-binding.json'));throw fail();}catch(error){if(error.code!=='ENOENT')throw error;}
    const provenancePath=fileURLToPath(new URL('../../../build-provenance.json',pathToFileURL(root+'/')));
    try{await regular(provenancePath);if(JSON.parse(await readFile(provenancePath)).packagedSDKSourceProjection)throw fail();}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return {pins, pkg, artifactVerifierExecuted:pins.has(projectionModule)};
}
// Failure is sticky for this process. Installing a corrected package requires
// a normal restart; a callback cannot swap the SDK under a held owner.
let checked;
async function verified() {
  if (!checked) {
    const selected = verify(); checked = selected;
    // Share only an in-flight check; later imports recheck the graph. Keep a
    // rejected promise sticky so corruption cannot be retried in this launch.
    selected.then(() => { if (checked === selected) checked = undefined; }, () => {});
  }
  return checked;
}
async function resolveEntry(name, state) {
  const {pins, pkg} = state ?? await verified();
  let relative;
  if (privateNames.has(name)) relative = name;
  else if (allPublicNames.includes(name)) {
    relative = publicEntry(name,pkg);
    // Resolve the original public specifier using the SDK's own package scope.
    // Never resolve against caller node_modules or create a second SDK alias.
    const actual = createRequire(pathToFileURL(join(prefix, 'package.json'))).resolve('@ynx-chain/wallet-auth/' + name);
    if (actual !== join(prefix, relative) || await realpath(actual) !== actual) throw fail();
  } else throw fail();
  if (!pins.has(relative)) throw fail();
  return pathToFileURL(join(prefix, relative)).href;
}
export async function inspectBundledIdentitySDK() {
  const records = [], state = await verified();
  for (const name of [...allPublicNames, ...privateNames]) records.push({name, url:await resolveEntry(name, state)});
  return {schema:'YNX_PRODUCT_SDK_RESOLUTION/v2', records, modulesExecuted:state.artifactVerifierExecuted, SDKProtectedModulesExecuted:false, artifactVerificationIO:state.artifactVerifierExecuted, RootAdmission:false, SourceAdmission:false, NativeAdmission:false};
}
export async function loadBundledIdentitySDK(name) {
  return import(await resolveEntry(name));
}
