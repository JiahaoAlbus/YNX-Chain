import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, lstatSync, mkdtempSync, renameSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { Readable } from "node:stream";
import {canonicalArchivePlan,canonicalPackedPath,canonicalSourcePath,CANONICAL_MAIN,CANONICAL_APP_METADATA,NATIVE_CANONICAL,NATIVE_RECEIPT,SDK_ALIAS,verifyCanonicalNativeReceipt} from './canonical-package.mjs';
import {walletAuthDependencyPlan,verifyPackagedWalletAuthDependencies} from './wallet-auth-dependencies.mjs';

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const RUNTIME_PACKAGE_FIELDS=Object.freeze(["name","main","type","imports","exports","dependencies","optionalDependencies","engines","os","cpu"]);
export const PACKAGED_RELOCATION_RECEIPT = "ynx-wallet-packaged-relocation.json";
const RELOCATION_VERSION = "wallet-canonical-normal-paths-v2";
const sdkPrefix = "../../../packages/wallet-auth/src/";
const sdkPackedPrefix = sdkPrefix;
const joint = "original-auth-identity-private-joint-registration.js";
// Closed source-owned recipe. These are operands, not arbitrary source text,
// entrypoint overrides, runtime providers or alternate copies of the SDK.
const desktopRules = [
  ["main.mjs", [joint]],
  ["original-auth-identity-startup.mjs", [joint]],
  ["password-wallet-vault.mjs", ["canonical.js", "original-operation-recovery-state.js", "original-wallet-service-role-enrollment-state.js", "original-wallet-service-admission.js", "original-wallet-service-runtime-observer.js", "original-wallet-service-runtime-publication.js", "original-wallet-service-admission-publication-state.js", "original-wallet-service-admission-installer.js"]],
  ["password-vault-crypto.mjs", ["original-wallet-service-role-enrollment-state.js", "original-wallet-service-admission-publication-state.js", "original-wallet-service-runtime-publication.js"]],
  ["original-admission-custodian.mjs", [joint,"original-ide-parent-host.js"]]
];
export const PACKAGED_RELOCATION_RULES = Object.freeze([
  ...desktopRules.map(([file, suffixes]) => ({sourcePath:`apps/wallet-desktop/src/${file}`, packedPath:`code/apps/wallet-desktop/src/${file}`, operands:suffixes.map(suffix=>({kind:"from",from:sdkPrefix+suffix,to:sdkPackedPrefix+suffix,count:1}))})),
  {sourcePath:`packages/wallet-auth/src/${joint}`,packedPath:`code/packages/wallet-auth/src/${joint}`,operands:[
    {kind:"from",from:"../../../apps/wallet-desktop/src/password-wallet-vault.mjs",to:"../../../apps/wallet-desktop/src/password-wallet-vault.mjs",count:1},
    {kind:"url",from:"../../../apps/wallet-desktop/native/original-auth-identity.node",to:"../../../apps/wallet-desktop/native/original-auth-identity.node",count:1}]},
  {sourcePath:"packages/wallet-auth/src/original-wallet-service-private-dispatch.js",packedPath:"code/packages/wallet-auth/src/original-wallet-service-private-dispatch.js",operands:[
    {kind:"url",from:"../../../apps/wallet-desktop/native/original-auth-identity.node",to:"../../../apps/wallet-desktop/native/original-auth-identity.node",count:1}]},
  ...['original-host-terminal-journal.js','original-ide-admission-parent-delivery.js'].map(file=>({sourcePath:`packages/wallet-auth/src/${file}`,packedPath:`code/packages/wallet-auth/src/${file}`,operands:[
    {kind:'url',from:'../../../apps/wallet-desktop/native/original-auth-identity.node',to:'../../../apps/wallet-desktop/native/original-auth-identity.node',count:1}]})),
  // This existing SDK daemon is explicitly unconfigured. Its separate optional
  // IO module is NOT the Wallet authority module; preserve its URL unchanged,
  // do not synthesize a substitute or claim that the service is supplied.
  {sourcePath:'packages/wallet-auth/src/original-auth-identity-source-current.js',packedPath:'code/packages/wallet-auth/src/original-auth-identity-source-current.js',unavailableNativeAsset:'code/apps/wallet-desktop/native/original-source-current-dirfd.node',operands:[
    {kind:'url',from:'../../../apps/wallet-desktop/native/original-source-current-dirfd.node',to:'../../../apps/wallet-desktop/native/original-source-current-dirfd.node',count:1}]}
].map(rule=>Object.freeze({...rule,operands:Object.freeze(rule.operands.map(Object.freeze))})));
const escapeRE = text => text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const repositoryOperand = /(?:from\s*|new\s+URL\s*\(\s*)["']\.\.\/\.\.\/\.\.\/(?:packages\/wallet-auth|apps\/wallet-desktop)\//;
const packedRuntimePath = canonicalSourcePath;

export function relocateDesktopRuntimeSource(name, source) {
  const rule = PACKAGED_RELOCATION_RULES.find(item=>item.sourcePath===name);
  let text = source.toString("utf8");
  if (!rule) {
    if (repositoryOperand.test(text)) throw new Error(`Unlisted repository operand: ${name}`);
    return {bytes:source,operands:[]};
  }
  const operands=[];
  for (const operand of rule.operands) {
    const prefix=operand.kind==="from"?"\\bfrom\\s*":"\\bnew\\s+URL\\s*\\(\\s*";
    const pattern=new RegExp(`(${prefix})(["'])${escapeRE(operand.from)}\\2`,"g");
    let count=0;
    text=text.replace(pattern,()=>{count++;return '';});
    if(count!==operand.count) throw new Error(`Relocation operand count differs: ${name} ${operand.from}`);
    operands.push({...operand,count});
  }
  if(repositoryOperand.test(text)) throw new Error(`Unlisted repository operand: ${name}`);
  return {bytes:source,operands};
}

function relocationPlan(cwd, expected) {
  const root=git(cwd,"rev-parse","--show-toplevel");
  return PACKAGED_RELOCATION_RULES.map(rule=>{
    const source=execFileSync("git",["show",`${expected.sourceCommit}:${rule.sourcePath}`],{cwd:root,maxBuffer:16*1024*1024});
    const output=relocateDesktopRuntimeSource(rule.sourcePath,source);
    return {...rule,gitBlob:git(root,"rev-parse",`${expected.sourceCommit}:${rule.sourcePath}`),inputBytes:source.length,inputSHA256:digest(source),emittedBytes:output.bytes.length,emittedSHA256:digest(output.bytes),operands:output.operands,source,output:output.bytes};
  });
}
const publicRelocationRows = plan => plan.map(({source,output,...row})=>row);

export function desktopAsarHeaderIntegrity(resources,cwd=projectDir) {
  const asar=createRequire(path.join(cwd,"package.json"))("@electron/asar"),archive=path.join(resources,"app.asar");
  return {algorithm:"SHA256",hash:digest(Buffer.from(asar.getRawHeader(archive).headerString,"utf8"))};
}

function archiveInventory(asar, archive) {
  asar.uncache(archive);
  return asar.listPackage(archive).map(item=>{
    const name=item.replace(/^\//,""), info=asar.statFile(archive,path.normalize(name),false);
    if("files" in info) return {path:name,type:"directory",unpacked:!!info.unpacked};
    if("link" in info) return {path:name,type:"link",link:info.link,unpacked:!!info.unpacked};
    const b=asar.extractFile(archive,path.normalize(name),false);
    const physicalMode=info.unpacked?lstatSync(path.join(archive+".unpacked",name)).mode&0o777:null;
    return {path:name,type:"file",unpacked:!!info.unpacked,executable:!!info.executable,physicalMode,bytes:b.length,sha256:digest(b)};
  }).sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
function ensureUnchangedMembers(before, after, plan, metadataInput,dependencies) {
  const expected=canonicalArchivePlan(before,metadataInput,dependencies.rows).after;
  if(!isDeepStrictEqual(after,expected))throw new Error('Canonical packaging changed unexpected archive members');
  for(const row of plan){const found=after.find(item=>item.path===row.packedPath);if(!found||found.type!=='file'||found.bytes!==row.emittedBytes||found.sha256!==row.emittedSHA256)throw new Error('Canonical source input differs: '+row.sourcePath);}
}

// Run only in a short-lived packaging data child. The parent waits for its exit
// before reading output: this ASAR version resolves before the final stream flush.
export async function writeRelocatedArchive(resources, cwd, output) {
  const asar=createRequire(path.join(cwd,"package.json"))("@electron/asar");
  const archive=path.join(resources,"app.asar");
  asar.uncache(archive);
  const metadata=JSON.parse(asar.extractFile(archive,"package.json").toString("utf8"));
  const expected=desktopReleaseIdentity(cwd,metadata.version),plan=relocationPlan(cwd,expected);
  const before=archiveInventory(asar,archive),metadataInput=asar.extractFile(archive,'package.json'),dependencies=walletAuthDependencyPlan(cwd,expected.sourceCommit),canonical=canonicalArchivePlan(before,metadataInput,dependencies.rows);
  for(const row of plan){
    const rawPath=row.sourcePath.startsWith('apps/wallet-desktop/')?row.sourcePath.slice('apps/wallet-desktop/'.length):SDK_ALIAS+'/'+row.sourcePath.slice('packages/wallet-auth/'.length);
    const info=asar.statFile(archive,path.normalize(rawPath),false);
    if(info.unpacked||info.link||info.files||!asar.extractFile(archive,path.normalize(rawPath),false).equals(row.source)) throw new Error(`Relocation input differs: ${row.sourcePath}`);
  }
  const originals=new Map(before.map(row=>[canonicalPackedPath(row.path),row.path]));
  const streams=canonical.after.map(row=>{
    if(row.type==="directory") return {path:row.path,type:row.type,unpacked:row.unpacked};
    if(row.type==="link") return {path:row.path,type:row.type,unpacked:row.unpacked,symlink:path.posix.relative(path.posix.dirname(row.path),row.link),stat:{mode:0o777}};
    const canonicalAlias=row.path.startsWith(SDK_ALIAS+'/')?'code/packages/wallet-auth'+row.path.slice(SDK_ALIAS.length):null;
    const input=canonicalAlias??row.path;
    const bytes=row.path==='package.json'?canonical.metadata:row.path===CANONICAL_APP_METADATA?canonical.appMetadata:dependencies.contents.get(input)??asar.extractFile(archive,path.normalize(originals.get(input)),false);
    return {path:row.path,type:"file",unpacked:row.unpacked,stat:{mode:row.physicalMode??(row.executable?0o755:0o644),size:bytes.length},streamGenerator:()=>Readable.from([bytes])};
  });
  await asar.createPackageFromStreams(output,streams);
}

export function relocateDesktopPackage(resources, cwd=projectDir) {
  const asar=createRequire(path.join(cwd,"package.json"))("@electron/asar");
  const archive=path.join(resources,"app.asar");
  asar.uncache(archive);
  const metadata=JSON.parse(asar.extractFile(archive,"package.json").toString("utf8"));
  const expected=desktopReleaseIdentity(cwd,metadata.version),plan=relocationPlan(cwd,expected);
  const before=archiveInventory(asar,archive);
  const metadataInput=asar.extractFile(archive,'package.json');
  const dependencies=walletAuthDependencyPlan(cwd,expected.sourceCommit);
  const temporary=mkdtempSync(path.join(resources,".ynx-relocation-")),output=path.join(temporary,"app.asar");
  const nativeBefore=path.join(archive+'.unpacked','native/original-auth-identity.node'),nativeAfter=path.join(archive+'.unpacked',NATIVE_CANONICAL),backup=path.join(temporary,'original.asar');
  let nativeMoved=false,archiveMoved=false,replacement=false;
  try{
    execFileSync(process.execPath,[fileURLToPath(import.meta.url),"--relocate-data-child",resources,cwd,output],{maxBuffer:16*1024*1024,stdio:"pipe"});
    const after=archiveInventory(asar,output);
    ensureUnchangedMembers(before,after,plan,metadataInput,dependencies);
    // Only packed operands change; retain the original unpacked tree, not a
    // newly copied native artifact. Verify again against that retained tree.
    mkdirSync(path.dirname(nativeAfter),{recursive:true});renameSync(nativeBefore,nativeAfter);nativeMoved=true;
    renameSync(archive,backup);archiveMoved=true;renameSync(output,archive);replacement=true;asar.uncache(archive);
    if(!isDeepStrictEqual(archiveInventory(asar,archive),after)) throw new Error("Retained unpacked tree differs");
    const receipt={schemaVersion:2,recipe:RELOCATION_VERSION,sourceCommit:expected.sourceCommit,files:publicRelocationRows(plan),sdkDependencies:dependencies.public,metadataInputBase64:metadataInput.toString('base64'),before,after,asarHeaderIntegrity:desktopAsarHeaderIntegrity(resources,cwd)};
    writeFileSync(path.join(resources,PACKAGED_RELOCATION_RECEIPT),JSON.stringify(receipt,null,2)+"\n");
    return receipt;
  }catch(cause){
    // Packaging is offline. A failed transaction restores its original archive
    // and sole unpacked native file; no half-canonical package is accepted.
    if(archiveMoved){if(replacement)renameSync(archive,output);renameSync(backup,archive);asar.uncache(archive);}
    if(nativeMoved)renameSync(nativeAfter,nativeBefore);
    throw cause;
  }finally{rmSync(temporary,{recursive:true,force:true});}
}

export function desktopReleaseIdentity(cwd = projectDir, version) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const sourceCommit = git(root, "rev-parse", "HEAD");
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("An exact source commit is required");
  if (process.env.GITHUB_SHA && sourceCommit !== process.env.GITHUB_SHA) throw new Error("CI source and checkout differ");
  // A package identity must never describe a tracked dirty source as a commit.
  git(root, "diff", "--exit-code", "HEAD", "--", "apps/wallet-desktop", "packages/wallet-auth");
  const metadata = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Package version is invalid");
  return Object.freeze({ schemaVersion: 1, product: "YNX Wallet", version, sourceVersion: metadata.version, sourceCommit,
    walletTree: git(root, "rev-parse", `${sourceCommit}:apps/wallet-desktop`),
    walletAuthTree: git(root, "rev-parse", `${sourceCommit}:packages/wallet-auth`),
    distribution: "testnet-preview", productionSigned: false, storeReleased: false,
    installedRuntimeVerified: false, publicDownloadVerified: false });
}

export function verifyDesktopPackage(resources, cwd = projectDir) {
  const require = createRequire(path.join(cwd, "package.json"));
  const asar = require("@electron/asar");
  const archive = path.join(resources, "app.asar");
  // Verification must read the current archive, including after an in-process rebuild.
  asar.uncache(archive);
  const metadata = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
  const expected = desktopReleaseIdentity(cwd, metadata.version);
  const actual = JSON.parse(readFileSync(path.join(resources, "ynx-wallet-build-identity.json"), "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Embedded build identity does not match the checkout");
  const plan=relocationPlan(cwd,expected);
  const dependencies=walletAuthDependencyPlan(cwd,expected.sourceCommit);
  const receipt=JSON.parse(readFileSync(path.join(resources,PACKAGED_RELOCATION_RECEIPT),"utf8"));
  if(receipt.schemaVersion!==2||receipt.recipe!==RELOCATION_VERSION||receipt.sourceCommit!==expected.sourceCommit||!isDeepStrictEqual(receipt.files,publicRelocationRows(plan))||typeof receipt.metadataInputBase64!=='string') throw new Error("Packaged relocation receipt differs from source recipe");
  if(!isDeepStrictEqual(receipt.sdkDependencies,dependencies.public))throw Error('Packaged SDK dependency receipt differs from fixed source inputs');
  ensureUnchangedMembers(receipt.before,receipt.after,plan,Buffer.from(receipt.metadataInputBase64,'base64'),dependencies);
  if(!isDeepStrictEqual(archiveInventory(asar,archive),receipt.after)) throw new Error("Packaged archive differs from relocation receipt");
  const unavailableOptionalRuntimeAssets=PACKAGED_RELOCATION_RULES.filter(row=>row.unavailableNativeAsset).map(row=>{
    if(receipt.after.some(member=>member.path===row.unavailableNativeAsset))throw Error('Unreviewed optional source-current Native module');
    return {declaredBy:row.sourcePath,path:row.unavailableNativeAsset,packaged:false,capability:'NOT_SUPPLIED'};
  });
  if(!isDeepStrictEqual(desktopAsarHeaderIntegrity(resources,cwd),receipt.asarHeaderIntegrity)) throw new Error("Relocated ASAR header integrity differs");
  let macAsarIntegrityVerified=false;
  if(path.basename(resources)==="Resources"&&path.basename(path.dirname(resources))==="Contents"){
    const plist=path.join(path.dirname(resources),"Info.plist");
    const entry=JSON.parse(execFileSync("plutil",["-extract","ElectronAsarIntegrity","json","-o","-",plist],{encoding:"utf8"}))["Resources/app.asar"];
    if(!isDeepStrictEqual(entry,receipt.asarHeaderIntegrity)) throw new Error("Mac ASAR integrity metadata differs from relocated header");
    macAsarIntegrityVerified=true;
  }
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const sourceMetadata=JSON.parse(execFileSync("git",["show",`${expected.sourceCommit}:apps/wallet-desktop/package.json`],{cwd:root,encoding:"utf8",maxBuffer:16*1024*1024}));
  const sdkMetadata=JSON.parse(execFileSync('git',['show',`${expected.sourceCommit}:packages/wallet-auth/package.json`],{cwd:root,maxBuffer:16*1024*1024}));
  const sdkRuntimeDependencies=verifyPackagedWalletAuthDependencies(asar,archive,dependencies,sdkMetadata);
  const nativeInputs=git(root,'ls-tree','-r','--name-only',expected.sourceCommit,'apps/wallet-desktop/native','packages/wallet-auth/native').split('\n').filter(name=>/\/native\/[^/]+\.(?:h|mm|mjs)$/.test(name));
  const nativeReceiptBytes=asar.extractFile(archive,NATIVE_RECEIPT),nativeReceipt=JSON.parse(nativeReceiptBytes.toString('utf8'));
  const localNative=path.join(cwd,'native/original-auth-identity.node'),localReceipt=path.join(cwd,'native/original-auth-identity-build.json'),nativeBytes=asar.extractFile(archive,NATIVE_CANONICAL);
  if(!lstatSync(localNative).isFile()||!lstatSync(localReceipt).isFile()||!nativeBytes.equals(readFileSync(localNative))||!nativeReceiptBytes.equals(readFileSync(localReceipt)))throw Error('Packaged native module or receipt differs from frozen build input');
  const nativeModuleBuild={...verifyCanonicalNativeReceipt(nativeReceipt,nativeBytes,nativeInputs,name=>execFileSync('git',['show',`${expected.sourceCommit}:${name}`],{cwd:root,maxBuffer:16*1024*1024})),receipt:{path:NATIVE_RECEIPT,bytes:nativeReceiptBytes.length,sha256:digest(nativeReceiptBytes)}};
  // Matching src bytes are insufficient if package.json can select another
  // entrypoint or alter resolution. Release version remains separately bound
  // by the existing identity; these runtime fields must match source exactly.
  for(const field of RUNTIME_PACKAGE_FIELDS){
    // Node selects conditional imports/exports in insertion order, recursively.
    // Both values come from JSON.parse: serialized equality preserves that
    // order, including nested conditions and fallback arrays, without running
    // any packaged entrypoint. Other metadata maps remain order-insensitive.
    const same=field==='main' ? sourceMetadata.main==='src/main.mjs'&&metadata.main===CANONICAL_MAIN : field==="imports"||field==="exports"
      ?JSON.stringify(metadata[field])===JSON.stringify(sourceMetadata[field])
      :isDeepStrictEqual(metadata[field],sourceMetadata[field]);
    if(Object.hasOwn(metadata,field)!==Object.hasOwn(sourceMetadata,field)||!same)throw new Error(`Packaged runtime metadata differs: ${field}`);
  }
  // wallet-auth-contract.mjs reads this registry from the SDK root at runtime.
  // Require it in the commit as well as the archive: ls-tree alone can silently
  // omit a named path that no longer exists in the selected commit.
  const requiredRuntimeAssets = ["packages/wallet-auth/package.json", "packages/wallet-auth/product-session-registry.json"];
  const names = git(root, "ls-tree", "-r", "--name-only", expected.sourceCommit, "apps/wallet-desktop/src", "packages/wallet-auth/src", ...requiredRuntimeAssets).split("\n");
  names.push(...nativeInputs.filter(name=>name.startsWith('packages/wallet-auth/')&&name.endsWith('.mjs')&&!name.endsWith('.test.mjs')));
  for (const name of requiredRuntimeAssets) {
    if (!names.includes(name)) throw new Error(`Required runtime asset is missing from the selected commit: ${name}`);
  }
  // electron-builder excludes TypeScript declarations from an executable package.
  // Keep that exclusion explicit; all runtime logic binds to the selected
  // checkout. Canonical packaging validates the seven closed operand inventories
  // but never rewrites any source operand or executes the packaged entrypoint.
  const excludedTypeDeclarations = names.filter(name => name.endsWith(".d.ts"));
  const verified = [];
  for (const name of names) {
    if (name.endsWith(".d.ts")) continue;
    const packedName = packedRuntimePath(name);
    const source = execFileSync("git", ["show", `${expected.sourceCommit}:${name}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    // @electron/asar traverses its header with the host path separator.
    const packed = asar.extractFile(archive, path.normalize(packedName));
    const emitted=relocateDesktopRuntimeSource(name,source).bytes;
    if (!emitted.equals(packed)) throw new Error(`Packaged source differs: ${name}`);
    verified.push({ path: packedName, bytes: packed.length, sha256: digest(packed) });
  }
  const allowed=new Set(names.filter(name=>!name.endsWith(".d.ts")).map(packedRuntimePath));
  for(const row of receipt.after){
    if(row.type!=="directory"&&(row.path.startsWith("code/apps/wallet-desktop/src/")||row.path.startsWith("code/packages/wallet-auth/src/"))&&!allowed.has(row.path)) throw new Error(`Unlisted packaged runtime member: ${row.path}`);
  }
  return { ...expected, packagedSourceVerified: true, sourceVerificationScope: "every runtime Wallet and SDK source", runtimePackageMetadataVerified:true,verifiedRuntimePackageFields:[...RUNTIME_PACKAGE_FIELDS], excludedTypeDeclarations,
    canonicalLayoutVerified:true,sourceOperandsUnchanged:true,nativeModuleBuild,
    unavailableOptionalRuntimeAssets,
    sdkRuntimeDependenciesVerified:true,sdkRuntimeDependencies,
    staticPathRelocationVerified:true,staticPathRelocation:receipt.files,macAsarIntegrityVerified,
    typeDeclarationExclusionReason: "TypeScript declarations are compile-time files excluded by electron-builder; they are not claimed to be packaged runtime bytes.",
    asarSHA256: digest(readFileSync(archive)), files: verified };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2]==="--relocate-data-child") {
  const [,resources,cwd,output]=process.argv.slice(2);
  if(!resources||!cwd||!output) throw new Error("Relocation data child requires exact resources, project and output");
  await writeRelocatedArchive(path.resolve(resources),path.resolve(cwd),path.resolve(output));
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [resources, outputDirectory] = process.argv.slice(2);
  if (!resources || !outputDirectory) throw new Error("Usage: release-provenance.mjs <resources-directory> <artifact-directory>");
  const verification = verifyDesktopPackage(path.resolve(resources));
  const artifacts = readdirSync(outputDirectory, { withFileTypes: true })
    .filter(item => item.isFile() && /\.(?:exe|deb|AppImage|dmg)$/.test(item.name))
    .map(item => { const bytes = readFileSync(path.join(outputDirectory, item.name)); return { filename: item.name, bytes: bytes.length, sha256: digest(bytes) }; });
  if (!artifacts.length) throw new Error("No distributable installer was produced");
  const manifest = { ...verification, buildPlatform: process.platform, buildArchitecture: process.arch, artifacts };
  writeFileSync(path.join(outputDirectory, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ sourceCommit: manifest.sourceCommit, version: manifest.version, verifiedFiles: manifest.files.length, artifacts }));
}
